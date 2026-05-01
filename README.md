# Auto Bulk Video Uploader Pro - 24/7 Cloud

A high-performance video automation suite designed for 24/7 production environments.

## Features
- **5-Platform Sync**: YouTube, Facebook Reels, Instagram Reels, TikTok, and Pinterest.
- **Gemini 1.5 Flash Engine**: Automated viral title and caption generation by analyzing content.
- **24/7 Scheduler**: Built-in background job that uploads one video every 30 minutes from the queue.
- **Command Center Dashboard**: Real-time monitoring of upload success, queue status, and performance metrics.

## Deployment on Render.com (Beginner Friendly)

1. **GitHub Setup**: 
   - Create a private repository on GitHub.
   - Push this entire codebase to your repository.

2. **Render App Creation**:
   - Go to [dashboard.render.com](https://dashboard.render.com).
   - Click **New** -> **Web Service**.
   - Connect your GitHub repository.

3. **Runtime Configuration**:
   - **Language**: Node.js (Version 22+)
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run start`

4. **Environment Variables**:
   In Render Dashboard, go to **Environment** and add:
   - `GEMINI_API_KEY`: Your Google AI Studio key.
   - `ADMIN_PASSWORD`: Your access key (Default: 7860).
   - `JWT_SECRET`: A random string for security.
   - `YOUTUBE_CLIENT_ID`: From Google Cloud Console.
   - `YOUTUBE_CLIENT_SECRET`: From Google Cloud Console.
   - `APP_URL`: Your Render App URL (e.g. `https://my-uploader.onrender.com`).
   - `META_GRAPH_API_TOKEN`: Optional (add later in app settings).
   - `TIKTOK_CLIENT_KEY`: Optional.
   - `TIKTOK_CLIENT_SECRET`: Optional.
   - `PINTEREST_ACCESS_TOKEN`: Optional.

5. **Final Step**:
   - Open your app.
   - Login with `7860`.
   - Go to **Settings** -> **Authorize Cloud Uploads** for YouTube.
   - Go to **Upload** and drop your batch.
   - Click **Start 24/7 Scheduler**.

## Troubleshooting
- **OAuth Error**: Ensure `APP_URL` in Render matches exactly what you put in Google Cloud Console callback.
- **Wait while starting**: Render's free tier spins down if not used. The background scheduler will keep it alive if active.
