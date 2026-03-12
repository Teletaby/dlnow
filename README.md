# DLNow — Video & Audio Downloader

A professional, self-hosted web app to download videos and audio from **YouTube**, **Instagram**, **X (Twitter)**, and **TikTok**.

![Node.js](https://img.shields.io/badge/Node.js-18+-green) ![License](https://img.shields.io/badge/license-MIT-blue) ![Docker](https://img.shields.io/badge/Docker-ready-blue)

## Features

- **Multi-platform** — YouTube, Instagram, X (Twitter), TikTok
- **Video downloads** — 1080p, 720p, 480p, or best quality (MP4)
- **Audio extraction** — MP3 (320kbps / 128kbps) or M4A
- **Professional UI** — Clean, responsive design with dark mode support
- **Rate limiting** — Built-in protection against abuse
- **Auto-cleanup** — Downloaded files are automatically deleted after 15 minutes
- **Docker ready** — One-command deployment

## Prerequisites

You need **one** of the following setups:

### Option A: Local (Node.js)
- [Node.js](https://nodejs.org/) 18+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) installed and in PATH
- [FFmpeg](https://ffmpeg.org/download.html) installed and in PATH

### Option B: Docker (recommended for deployment)
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose

## Quick Start

### Local Development

```bash
# 1. Install dependencies
npm install

# 2. Make sure yt-dlp and ffmpeg are installed
yt-dlp --version
ffmpeg -version

# 3. Start the server
npm start
```

Open **http://localhost:3000** in your browser.

### Docker Deployment

```bash
# Build and start with Docker Compose
docker compose up -d

# Or build manually
docker build -t dlnow .
docker run -p 3000:3000 dlnow
```

## Deploying Online

### Option 1: Vercel (Serverless — easiest)

DLNow supports Vercel deployment using Python serverless functions + yt-dlp.

1. Push the code to a GitHub repository
2. Import the repo on [vercel.com](https://vercel.com)
3. Set the environment variable `CAPTCHA_SECRET` to a random string
4. Deploy!

**Vercel notes:**
- Uses Python API routes in `api/` with yt-dlp installed via `requirements.txt`
- No ffmpeg — only pre-merged formats and audio-only streams are available
- Downloads redirect to the source CDN URL instead of proxying through the server
- **Pro plan recommended** for 60s function timeout (Hobby = 10s, which may be too short)

### Option 2: Railway / Render / Fly.io (Docker)

1. Push the code to a GitHub repository
2. Connect the repo to your platform of choice
3. The Dockerfile will be auto-detected
4. Set the port to `3000` if needed
5. Deploy!

### Option 3: VPS (Ubuntu/Debian)

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Clone and deploy
git clone <your-repo-url> dlnow
cd dlnow
docker compose up -d
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `3000`  | Server port (Express/Docker only) |
| `CAPTCHA_SECRET` | `dlnow-captcha-secret-2026-change-me` | HMAC secret for captcha tokens (Vercel only) |

## Project Structure

```
dlnow/
├── server.js              # Express backend (Docker/VPS deployment)
├── package.json           # Node.js dependencies
├── Dockerfile             # Docker image definition
├── docker-compose.yml     # Docker Compose config
├── vercel.json            # Vercel configuration
├── requirements.txt       # Python dependencies (Vercel)
├── api/                   # Vercel serverless functions
│   ├── captcha.py         # CAPTCHA generation (stateless HMAC)
│   ├── info.py            # Video info extraction via yt-dlp
│   └── download.py        # Direct URL extraction via yt-dlp
├── .gitignore
├── .dockerignore
├── .env.example
└── public/                # Frontend static files
    ├── index.html         # Main page
    ├── css/
    │   └── style.css      # Stylesheet
    └── js/
        └── app.js         # Frontend logic (auto-detects backend)
```

## How It Works

1. User pastes a video URL
2. Backend calls `yt-dlp --dump-json` to fetch video metadata
3. User selects a format (video quality or audio)
4. Backend downloads the file using `yt-dlp` with the selected format
5. File is served to the user and auto-deleted after download

## Tech Stack

- **Backend**: Node.js, Express
- **Frontend**: Vanilla HTML/CSS/JS (no framework, fast loading)
- **Download Engine**: yt-dlp + FFmpeg
- **Security**: Helmet, CORS, rate limiting
- **Deployment**: Docker

## Legal Notice

This tool is intended for downloading content you have the right to download. Always respect copyright laws and content creators' rights. The developers are not responsible for misuse.

## License

MIT
