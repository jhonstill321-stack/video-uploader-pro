import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs-extra";
import multer from "multer";
import cron from "node-cron";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { google } from "googleapis";
import axios from "axios";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, "database.json");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const TOKEN_PATH = path.join(__dirname, "token.json");

// Ensure directories and files exist
fs.ensureDirSync(UPLOADS_DIR);
if (!fs.existsSync(DB_PATH)) fs.writeJsonSync(DB_PATH, { videos: [], settings: {}, stats: { totalToday: 0, lastReset: new Date().toISOString() } });

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(cookieParser());

// --- Security Middleware ---
const authenticate = (req, res, next) => {
  const token = req.cookies.auth_token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    jwt.verify(token, process.env.JWT_SECRET || "default_secret");
    next();
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
};

// --- Storage Setup ---
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// --- API Routes ---

// Auth
app.post("/api/login", (req, res) => {
  const { password } = req.body;
  const adminPass = process.env.ADMIN_PASSWORD || "7860";
  if (password === adminPass) {
    const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET || "default_secret", { expiresIn: "7d" });
    res.cookie("auth_token", token, { httpOnly: true, secure: true, sameSite: "none" });
    return res.json({ success: true });
  }
  res.status(401).json({ error: "Invalid password" });
});

app.get("/api/me", authenticate, (req, res) => {
  res.json({ authenticated: true });
});

// Settings
app.get("/api/settings", authenticate, async (req, res) => {
  const db = await fs.readJson(DB_PATH);
  res.json(db.settings || {});
});

app.post("/api/settings", authenticate, async (req, res) => {
  const db = await fs.readJson(DB_PATH);
  db.settings = { ...db.settings, ...req.body };
  await fs.writeJson(DB_PATH, db);
  res.json({ success: true });
});

// Upload Queue
app.get("/api/videos", authenticate, async (req, res) => {
  const db = await fs.readJson(DB_PATH);
  res.json(db.videos || []);
});

app.get("/api/stats", authenticate, async (req, res) => {
  const db = await fs.readJson(DB_PATH);
  res.json(db.stats || { totalToday: 0, lastReset: new Date().toISOString() });
});

app.post("/api/upload", authenticate, upload.array("files"), async (req, res) => {
  try {
    const db = await fs.readJson(DB_PATH);
    const metadata = JSON.parse(req.body.metadata || "[]");
    
    // req.files is an array of Express.Multer.File
    const files = req.files as Express.Multer.File[];
    
    const newVideos = files.map((file, i) => ({
      id: `${Date.now()}-${i}`,
      filename: file.filename,
      originalName: file.originalname,
      title: metadata[i]?.title || "Dr.Melaxin Eye Care",
      caption: metadata[i]?.caption || "Get rid of dark circles #DrMelaxin #EyeCare #BeautyHack",
      status: "pending",
      platforms: {
        youtube: { status: "pending" },
        facebook: { status: "pending" },
        instagram: { status: "pending" },
        tiktok: { status: "pending" },
        pinterest: { status: "pending" }
      },
      createdAt: new Date().toISOString()
    }));

    db.videos = [...(db.videos || []), ...newVideos];
    await fs.writeJson(DB_PATH, db);
    res.json({ success: true, videos: newVideos });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Failed to process upload" });
  }
});

// --- YouTube OAuth Flow ---
app.get("/api/auth/youtube/url", authenticate, (req, res) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    `${process.env.APP_URL}/api/auth/youtube/callback`
  );

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/youtube.upload"]
  });

  res.json({ url });
});

app.get("/api/auth/youtube/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      `${process.env.APP_URL}/api/auth/youtube/callback`
    );

    const { tokens } = await oauth2Client.getToken(code as string);
    await fs.writeJson(TOKEN_PATH, tokens);

    res.send(`
      <html>
        <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #000; color: #fff;">
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'YOUTUBE_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <div style="text-align: center;">
            <h1 style="color: #00ff00;">YouTube Connected!</h1>
            <p>You can close this window now.</p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("YouTube OAuth callback error:", error);
    res.status(500).send("Auth failed");
  }
});

// --- Scheduler & Multi-Platform Uploaders ---

async function uploadToYouTube(video, settings) {
  try {
    if (!fs.existsSync(TOKEN_PATH)) throw new Error("YouTube token missing");
    const tokens = await fs.readJson(TOKEN_PATH);
    const oauth2Client = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET
    );
    oauth2Client.setCredentials(tokens);

    const youtube = google.youtube({ version: "v3", auth: oauth2Client });
    const videoPath = path.join(UPLOADS_DIR, video.filename);

    const res = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: video.title,
          description: video.caption,
          categoryId: "22", // People & Blogs
        },
        status: {
          privacyStatus: "public",
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        body: fs.createReadStream(videoPath),
      },
    });

    // Check for token refresh
    if (oauth2Client.credentials.refresh_token) {
        // tokens updated automatically by client, save them
        await fs.writeJson(TOKEN_PATH, oauth2Client.credentials);
    }

    return { success: true, link: `https://youtu.be/${res.data.id}` };
  } catch (error) {
    console.error("YouTube Upload Error:", error);
    return { success: false, error: (error as Error).message };
  }
}

// Stubs for other platforms (logic following Meta/TikTok/Pinterest APIs)
async function uploadToMeta(video: any, settings: any, type: 'fb' | 'ig') {
  // Logic for Meta Graph API /reels
  return { success: false, error: "Meta API integration pending credentials", link: undefined };
}

async function uploadToTikTok(video: any, settings: any) {
  // Logic for TikTok Content Posting API
  return { success: false, error: "TikTok API integration pending credentials", link: undefined };
}

async function uploadToPinterest(video: any, settings: any) {
  // Logic for Pinterest v5 API /media
  return { success: false, error: "Pinterest API integration pending credentials", link: undefined };
}

const processNextVideo = async () => {
    console.log(`[Scheduler] Checking for pending videos at ${new Date().toISOString()}`);
    const db = await fs.readJson(DB_PATH);
    const nextVideo = db.videos.find(v => v.status === "pending");

    if (!nextVideo) {
        console.log("[Scheduler] No pending videos in queue.");
        return;
    }

    nextVideo.status = "processing";
    await fs.writeJson(DB_PATH, db);

    const settings = db.settings || {};

    // Upload to all platforms
    // 1. YouTube
    const ytResult = await uploadToYouTube(nextVideo, settings);
    nextVideo.platforms.youtube = { status: ytResult.success ? "success" : "failed", link: ytResult.link, error: ytResult.error };

    // 2. Meta FB
    const fbResult = await uploadToMeta(nextVideo, settings, 'fb');
    nextVideo.platforms.facebook = { status: fbResult.success ? "success" : "failed", link: fbResult.link, error: fbResult.error };
    
    // 3. Meta IG
    const igResult = await uploadToMeta(nextVideo, settings, 'ig');
    nextVideo.platforms.instagram = { status: igResult.success ? "success" : "failed", link: igResult.link, error: igResult.error };

    // 4. TikTok
    const ttResult = await uploadToTikTok(nextVideo, settings);
    nextVideo.platforms.tiktok = { status: ttResult.success ? "success" : "failed", link: ttResult.link, error: ttResult.error };

    // 5. Pinterest
    const pinResult = await uploadToPinterest(nextVideo, settings);
    nextVideo.platforms.pinterest = { status: pinResult.success ? "success" : "failed", link: pinResult.link, error: pinResult.error };

    nextVideo.status = "completed";
    nextVideo.uploadedAt = new Date().toISOString();
    
    // Update stats
    const today = new Date().toISOString().split('T')[0];
    if (db.stats.lastReset.split('T')[0] !== today) {
        db.stats.totalToday = 0;
        db.stats.lastReset = new Date().toISOString();
    }
    db.stats.totalToday += 1;

    await fs.writeJson(DB_PATH, db);
    console.log(`[Scheduler] Completed processing video: ${nextVideo.id}`);
};

// Scheduler: Every 30 minutes
// "*/30 * * * *" means at minute 0 and 30
cron.schedule("*/30 * * * *", () => {
    processNextVideo();
});

// --- Vite Middleware ---
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
