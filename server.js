const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

// Cleanup old files every 10 minutes (files older than 15 min)
setInterval(() => {
  cleanupDownloads(15 * 60 * 1000);
}, 10 * 60 * 1000);

function cleanupDownloads(maxAge) {
  try {
    const files = fs.readdirSync(DOWNLOAD_DIR);
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(DOWNLOAD_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (err) {
    console.error('Cleanup error:', err.message);
  }
}

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Supported platforms
const SUPPORTED_PLATFORMS = [
  { name: 'YouTube', patterns: [/youtube\.com/, /youtu\.be/] },
  { name: 'Instagram', patterns: [/instagram\.com/] },
  { name: 'X (Twitter)', patterns: [/twitter\.com/, /x\.com/] },
  { name: 'TikTok', patterns: [/tiktok\.com/] },
];

function detectPlatform(url) {
  for (const platform of SUPPORTED_PLATFORMS) {
    for (const pattern of platform.patterns) {
      if (pattern.test(url)) return platform.name;
    }
  }
  return null;
}

function isValidUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Store active jobs
const jobs = new Map();

// ========================================
// CAPTCHA System
// ========================================
const captchaStore = new Map();
const CAPTCHA_TTL = 5 * 60 * 1000; // 5 minutes

// Cleanup expired captchas every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of captchaStore) {
    if (now - data.created > CAPTCHA_TTL) captchaStore.delete(token);
  }
}, 2 * 60 * 1000);

function generateCaptcha() {
  // Generate a random 5-6 digit number
  const digits = Math.floor(Math.random() * 2) + 5; // 5 or 6 digits
  const min = Math.pow(10, digits - 1);
  const max = Math.pow(10, digits) - 1;
  const answer = Math.floor(Math.random() * (max - min + 1)) + min;
  const text = String(answer);
  const token = uuidv4();

  // Generate distorted SVG captcha image
  const svg = generateCaptchaSVG(text);

  captchaStore.set(token, { answer, created: Date.now(), attempts: 0 });

  return { token, svg };
}

function generateCaptchaSVG(text) {
  const width = 220;
  const height = 70;

  // Random noise lines
  let noiseLines = '';
  for (let i = 0; i < 6; i++) {
    const x1 = Math.random() * width;
    const y1 = Math.random() * height;
    const x2 = Math.random() * width;
    const y2 = Math.random() * height;
    const color = `hsl(${Math.random() * 360}, 40%, 65%)`;
    noiseLines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.5" opacity="0.5"/>`;
  }

  // Random dots
  let dots = '';
  for (let i = 0; i < 30; i++) {
    const cx = Math.random() * width;
    const cy = Math.random() * height;
    const r = Math.random() * 2 + 0.5;
    const color = `hsl(${Math.random() * 360}, 30%, 60%)`;
    dots += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="0.4"/>`;
  }

  // Render each character with individual transforms
  let chars = '';
  const totalWidth = text.length * 28;
  const startX = (width - totalWidth) / 2 + 14;
  const charSpacing = 28;
  for (let i = 0; i < text.length; i++) {
    const x = startX + i * charSpacing;
    const y = 42 + (Math.random() * 12 - 6);
    const rotation = Math.random() * 20 - 10;
    const fontSize = 26 + Math.random() * 6;
    const hue = 220 + Math.random() * 40;
    chars += `<text x="${x}" y="${y}" font-family="monospace, 'Courier New'" font-size="${fontSize}" font-weight="bold" fill="hsl(${hue}, 60%, 40%)" transform="rotate(${rotation}, ${x}, ${y})">${text[i]}</text>`;
  }

  // Wavy path overlay
  const wavePath = `M0,${35 + Math.random()*10} Q${width*0.25},${20+Math.random()*30} ${width*0.5},${35+Math.random()*10} T${width},${35+Math.random()*10}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#f0f1f5" rx="8"/>
    ${noiseLines}
    ${dots}
    ${chars}
    <path d="${wavePath}" stroke="rgba(99,102,241,0.15)" stroke-width="2" fill="none"/>
  </svg>`;
}

function validateCaptcha(token, userAnswer) {
  const captcha = captchaStore.get(token);
  if (!captcha) return { valid: false, error: 'Captcha expired. Please get a new one.' };
  if (Date.now() - captcha.created > CAPTCHA_TTL) {
    captchaStore.delete(token);
    return { valid: false, error: 'Captcha expired. Please get a new one.' };
  }
  captcha.attempts++;
  if (captcha.attempts > 5) {
    captchaStore.delete(token);
    return { valid: false, error: 'Too many attempts. Please get a new captcha.' };
  }
  const parsed = parseInt(userAnswer, 10);
  if (isNaN(parsed) || parsed !== captcha.answer) {
    return { valid: false, error: 'Wrong answer. Try again.' };
  }
  captchaStore.delete(token);
  return { valid: true };
}

// GET /api/captcha - Generate a new captcha
app.get('/api/captcha', (req, res) => {
  const { token, svg } = generateCaptcha();
  res.json({ token, svg });
});

// POST /api/info - Get video info (captcha required)
app.post('/api/info', apiLimiter, async (req, res) => {
  const { url, captchaToken, captchaAnswer } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Please provide a valid URL.' });
  }

  // Validate captcha
  if (!captchaToken || captchaAnswer === undefined || captchaAnswer === '') {
    return res.status(400).json({ error: 'Please complete the captcha verification.' });
  }
  const captchaResult = validateCaptcha(captchaToken, captchaAnswer);
  if (!captchaResult.valid) {
    return res.status(400).json({ error: captchaResult.error, captchaFailed: true });
  }

  const platform = detectPlatform(url);
  if (!platform) {
    return res.status(400).json({ error: 'Unsupported platform. We support YouTube, Instagram, X, and TikTok.' });
  }

  try {
    const info = await getVideoInfo(url);
    res.json({ ...info, platform });
  } catch (err) {
    console.error('Info error:', err.message);
    res.status(500).json({ error: 'Failed to fetch video information. Please check the URL and try again.' });
  }
});

// POST /api/download - Start download
app.post('/api/download', apiLimiter, async (req, res) => {
  const { url, format } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Please provide a valid URL.' });
  }

  const platform = detectPlatform(url);
  if (!platform) {
    return res.status(400).json({ error: 'Unsupported platform.' });
  }

  const jobId = uuidv4();
  jobs.set(jobId, { status: 'processing', progress: 0 });

  res.json({ jobId });

  // Process download in background
  try {
    const result = await downloadMedia(url, format, jobId);
    jobs.set(jobId, { status: 'complete', ...result });
  } catch (err) {
    console.error('Download error:', err.message);
    jobs.set(jobId, { status: 'error', error: err.message });
  }
});

// GET /api/status/:jobId - Check download status
app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }
  res.json(job);
});

// GET /api/download/:jobId - Serve the downloaded file
app.get('/api/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'complete') {
    return res.status(404).json({ error: 'File not ready or not found.' });
  }

  const filePath = job.filePath;
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File no longer available.' });
  }

  res.download(filePath, job.filename, (err) => {
    if (err) {
      console.error('Send file error:', err.message);
    }
    // Clean up after download
    setTimeout(() => {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        jobs.delete(req.params.jobId);
      } catch (e) { /* ignore */ }
    }, 60000);
  });
});

// Common yt-dlp args to avoid 403 errors
function getCommonArgs() {
  const args = [
    '--no-warnings',
    '--no-playlist',
    '--force-ipv4',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    '--no-check-certificates',
    '--extractor-args', 'youtube:player_client=mediaconnect',
  ];

  // Use a cookies.txt file if present (needed for age-restricted or region-locked content)
  const cookiesFile = path.join(__dirname, 'cookies.txt');
  if (fs.existsSync(cookiesFile)) {
    args.push('--cookies', cookiesFile);
  }

  return args;
}

// Get video info using yt-dlp
function getVideoInfo(url) {
  return new Promise((resolve, reject) => {
    const args = [
      ...getCommonArgs(),
      '--dump-json',
      url,
    ];

    const proc = spawn('yt-dlp', args, { timeout: 30000 });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || 'yt-dlp failed'));
      }
      try {
        const data = JSON.parse(stdout);
        resolve({
          title: data.title || 'Unknown',
          thumbnail: data.thumbnail || null,
          duration: data.duration || 0,
          uploader: data.uploader || data.channel || 'Unknown',
          formats: getAvailableFormats(data),
        });
      } catch (e) {
        reject(new Error('Failed to parse video info'));
      }
    });

    proc.on('error', (err) => {
      reject(new Error('yt-dlp is not installed. Please install it first.'));
    });
  });
}

function getAvailableFormats(data) {
  const formats = [];

  // Collect all available video heights
  const heights = new Set();
  if (data.formats) {
    for (const f of data.formats) {
      if (f.height && f.vcodec && f.vcodec !== 'none') heights.add(f.height);
    }
  }

  // Standard tiers mapped to the actual available resolutions
  const tiers = [
    { min: 2160, id: 'best-video-2160', label: '4K' },
    { min: 1440, id: 'best-video-1440', label: '1440p' },
    { min: 1080, id: 'best-video-1080', label: '1080p' },
    { min: 720,  id: 'best-video-720',  label: '720p' },
    { min: 480,  id: 'best-video-480',  label: '480p' },
    { min: 360,  id: 'best-video-360',  label: '360p' },
  ];

  const maxHeight = heights.size ? Math.max(...heights) : 720;

  // Only show tiers up to the video's max resolution
  for (const tier of tiers) {
    if (maxHeight >= tier.min) {
      formats.push({ id: tier.id, label: `Video - ${tier.label} (MP4)`, type: 'video' });
    }
  }

  // Audio formats
  formats.push({ id: 'audio-mp3', label: 'Audio - MP3 (320kbps)', type: 'audio' });
  formats.push({ id: 'audio-mp3-128', label: 'Audio - MP3 (128kbps)', type: 'audio' });
  formats.push({ id: 'audio-m4a', label: 'Audio - M4A (Best)', type: 'audio' });

  return formats;
}

// Download media using yt-dlp
function downloadMedia(url, format, jobId) {
  return new Promise((resolve, reject) => {
    const fileId = jobId.substring(0, 8);
    let args = [...getCommonArgs()];

    let ext = 'mp4';

    // Handle dynamic video format ids like best-video-2160, best-video-720, etc.
    const videoMatch = format.match(/^best-video-(\d+)$/);
    if (videoMatch) {
      const h = videoMatch[1];
      args.push('-f', `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`);
      args.push('--merge-output-format', 'mp4');
    } else switch (format) {
      case 'best-video':
        args.push('-f', 'bestvideo+bestaudio/best');
        args.push('--merge-output-format', 'mp4');
        break;
      case 'audio-mp3':
        args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
        ext = 'mp3';
        break;
      case 'audio-mp3-128':
        args.push('-x', '--audio-format', 'mp3', '--audio-quality', '5');
        ext = 'mp3';
        break;
      case 'audio-m4a':
        args.push('-x', '--audio-format', 'm4a', '--audio-quality', '0');
        ext = 'm4a';
        break;
      default:
        args.push('-f', 'bestvideo+bestaudio/best');
        args.push('--merge-output-format', 'mp4');
    }

    const outputTemplate = path.join(DOWNLOAD_DIR, `${fileId}.%(ext)s`);
    args.push('-o', outputTemplate);
    args.push('--progress');
    args.push(url);

    const proc = spawn('yt-dlp', args);
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      // Parse progress
      const match = text.match(/(\d+\.?\d*)%/);
      if (match) {
        const job = jobs.get(jobId);
        if (job) {
          job.progress = parseFloat(match[1]);
          jobs.set(jobId, job);
        }
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      // yt-dlp sometimes outputs progress to stderr
      const text = data.toString();
      const match = text.match(/(\d+\.?\d*)%/);
      if (match) {
        const job = jobs.get(jobId);
        if (job) {
          job.progress = parseFloat(match[1]);
          jobs.set(jobId, job);
        }
      }
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || 'Download failed'));
      }

      // Find the downloaded file
      const files = fs.readdirSync(DOWNLOAD_DIR);
      const downloadedFile = files.find(f => f.startsWith(fileId));

      if (!downloadedFile) {
        return reject(new Error('Downloaded file not found'));
      }

      const filePath = path.join(DOWNLOAD_DIR, downloadedFile);
      const actualExt = path.extname(downloadedFile).slice(1);

      resolve({
        filePath,
        filename: `dlnow_${Date.now()}.${actualExt}`,
        size: fs.statSync(filePath).size,
      });
    });

    proc.on('error', () => {
      reject(new Error('yt-dlp is not installed or not found in PATH'));
    });
  });
}

// Update yt-dlp to latest version
function updateYtDlp() {
  return new Promise((resolve) => {
    console.log('  Checking for yt-dlp updates...');
    const proc = spawn('yt-dlp', ['-U'], { timeout: 60000 });
    let output = '';
    proc.stdout.on('data', (d) => { output += d.toString(); });
    proc.stderr.on('data', (d) => { output += d.toString(); });
    proc.on('close', (code) => {
      if (output.includes('up to date') || output.includes('Updated')) {
        console.log('  yt-dlp is up to date.');
      } else if (code !== 0) {
        console.log('  Could not auto-update yt-dlp. Run "yt-dlp -U" manually if downloads fail.');
      }
      resolve();
    });
    proc.on('error', () => {
      console.log('  yt-dlp not found. Please install it: pip install yt-dlp');
      resolve();
    });
  });
}

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server and auto-update yt-dlp
(async () => {
  await updateYtDlp();
  app.listen(PORT, () => {
    console.log(`\n  🚀 DLNow is running at http://localhost:${PORT}\n`);
  });
})();
