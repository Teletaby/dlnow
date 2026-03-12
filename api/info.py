from http.server import BaseHTTPRequestHandler
import json
import os
import hmac
import hashlib
import time
import base64
from urllib.parse import urlparse, quote
import urllib.request

import tempfile

import yt_dlp

SECRET = os.environ.get('CAPTCHA_SECRET', 'dlnow-captcha-secret-2026-change-me')
COBALT_API_URL = os.environ.get('COBALT_API_URL', 'https://api.cobalt.tools')


def get_cookies_file():
    """Write YT_COOKIES env var to a temp file for yt-dlp.
    Auto-detects Netscape format vs browser header format (name=value; name=value)."""
    cookies_str = os.environ.get('YT_COOKIES', '').strip()
    if not cookies_str:
        return None

    # Auto-detect format
    if cookies_str.startswith('#') or '\t' in cookies_str:
        content = cookies_str
    else:
        lines = ['# Netscape HTTP Cookie File', '']
        for part in cookies_str.split('; '):
            eq = part.find('=')
            if eq == -1:
                continue
            name = part[:eq].strip()
            value = part[eq + 1:]
            secure = 'TRUE' if name.startswith('__Secure') else 'FALSE'
            lines.append(f'.youtube.com\tTRUE\t/\t{secure}\t0\t{name}\t{value}')
        content = '\n'.join(lines) + '\n'

    tmp = tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False)
    tmp.write(content)
    tmp.close()
    return tmp.name

ALLOWED_HOSTS = {
    'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be',
    'instagram.com', 'www.instagram.com',
    'twitter.com', 'www.twitter.com', 'x.com', 'www.x.com',
    'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com',
}


def validate_captcha(token, user_answer):
    """Verify HMAC-signed captcha token against user's answer (stateless)."""
    try:
        data = json.loads(base64.b64decode(token))
        timestamp = data['t']
        nonce = data['n']
        signature = data['s']

        if time.time() - timestamp > 300:
            return False

        answer = int(user_answer)
        message = f'{answer}:{timestamp}:{nonce}'
        expected = hmac.new(
            SECRET.encode(), message.encode(), hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(signature, expected)
    except Exception:
        return False


def is_allowed(url):
    try:
        host = urlparse(url).hostname or ''
        return host in ALLOWED_HOSTS
    except Exception:
        return False


def detect_platform(url):
    u = url.lower()
    if 'youtube.com' in u or 'youtu.be' in u:
        return 'YouTube'
    if 'instagram.com' in u:
        return 'Instagram'
    if 'twitter.com' in u or 'x.com' in u:
        return 'X (Twitter)'
    if 'tiktok.com' in u:
        return 'TikTok'
    return 'Other'


def process_formats(info):
    """Extract available formats including high-res video-only (up to 4K) and audio."""
    formats = []
    seen = set()

    for f in info.get('formats', []):
        if not f.get('url'):
            continue

        vcodec = f.get('vcodec') or 'none'
        acodec = f.get('acodec') or 'none'
        has_video = vcodec != 'none'
        has_audio = acodec != 'none'
        height = f.get('height') or 0
        abr = f.get('abr') or 0
        ext = f.get('ext') or 'mp4'
        fid = f.get('format_id', '')

        if has_video and has_audio:
            label = f'Video - {height}p ({ext.upper()})' if height else f'Video ({ext.upper()})'
            key = f'v-merged-{height}-{ext}'
            if key not in seen:
                seen.add(key)
                formats.append({'id': fid, 'label': label, 'type': 'video', '_sort': height})

        elif has_video and not has_audio and height >= 1080:
            label = f'Video - {height}p ({ext.upper()}, no audio)'
            key = f'v-only-{height}-{ext}'
            if key not in seen:
                seen.add(key)
                formats.append({'id': fid, 'label': label, 'type': 'video', '_sort': height})

        elif has_audio and not has_video:
            abr_int = int(abr) if abr else 0
            label = f'Audio - {ext.upper()} ({abr_int}kbps)' if abr_int else f'Audio ({ext.upper()})'
            key = f'a-{abr_int}-{ext}'
            if key not in seen:
                seen.add(key)
                formats.append({'id': fid, 'label': label, 'type': 'audio', '_sort': abr_int})

    video_fmts = sorted([f for f in formats if f['type'] == 'video'], key=lambda x: x['_sort'], reverse=True)
    audio_fmts = sorted([f for f in formats if f['type'] == 'audio'], key=lambda x: x['_sort'], reverse=True)

    return [{'id': f['id'], 'label': f['label'], 'type': f['type']} for f in video_fmts + audio_fmts]


# ──── YouTube oEmbed + Cobalt fallback ────

def get_youtube_info_cobalt(url):
    """Fallback: use YouTube oEmbed for metadata + preset cobalt format options."""
    oembed_url = f'https://www.youtube.com/oembed?url={quote(url, safe="")}&format=json'
    req = urllib.request.Request(oembed_url, headers={'User-Agent': 'Mozilla/5.0'})

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        title = data.get('title', 'Unknown')
        thumbnail = data.get('thumbnail_url', '')
        uploader = data.get('author_name', 'Unknown')
    except Exception:
        title = 'YouTube Video'
        thumbnail = ''
        uploader = 'Unknown'

    return {
        'title': title,
        'thumbnail': thumbnail,
        'duration': 0,
        'uploader': uploader,
        'cobalt': True,
        'formats': [
            {'id': 'cobalt-2160', 'label': 'Video - 2160p (4K)', 'type': 'video'},
            {'id': 'cobalt-1440', 'label': 'Video - 1440p (2K)', 'type': 'video'},
            {'id': 'cobalt-1080', 'label': 'Video - 1080p', 'type': 'video'},
            {'id': 'cobalt-720', 'label': 'Video - 720p', 'type': 'video'},
            {'id': 'cobalt-480', 'label': 'Video - 480p', 'type': 'video'},
            {'id': 'cobalt-360', 'label': 'Video - 360p', 'type': 'video'},
            {'id': 'cobalt-audio-mp3', 'label': 'Audio - MP3 (128kbps)', 'type': 'audio'},
            {'id': 'cobalt-audio-best', 'label': 'Audio - Best Quality', 'type': 'audio'},
        ],
    }


# ──── Main get_video_info ────

def get_video_info(url, platform):
    base_opts = {
        'quiet': True,
        'no_warnings': True,
        'no_color': True,
        'no_playlist': True,
    }

    proxy = os.environ.get('PROXY_URL', '').strip()
    if proxy:
        base_opts['proxy'] = proxy

    if platform != 'YouTube':
        cookies_file = get_cookies_file()
        if cookies_file:
            base_opts['cookiefile'] = cookies_file
        try:
            with yt_dlp.YoutubeDL(base_opts) as ydl:
                info = ydl.extract_info(url, download=False)
        finally:
            if cookies_file:
                try:
                    os.unlink(cookies_file)
                except OSError:
                    pass
    else:
        # YouTube: try yt-dlp strategies first, then cobalt fallback
        strategies = [
            {
                'name': 'mediaconnect + cookies',
                'extractor_args': {'youtube': {
                    'player_client': ['mediaconnect'],
                    'player_skip': ['webpage'],
                }},
                'use_cookies': True,
            },
            {
                'name': 'web_creator + cookies',
                'extractor_args': {'youtube': {
                    'player_client': ['web_creator'],
                }},
                'use_cookies': True,
            },
            {
                'name': 'mediaconnect (no cookies)',
                'extractor_args': {'youtube': {
                    'player_client': ['mediaconnect'],
                    'player_skip': ['webpage'],
                }},
                'use_cookies': False,
            },
        ]

        info = None
        for strat in strategies:
            opts = {**base_opts, 'extractor_args': strat['extractor_args']}
            cookies_file = None
            if strat['use_cookies']:
                cookies_file = get_cookies_file()
                if cookies_file:
                    opts['cookiefile'] = cookies_file
            try:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    info = ydl.extract_info(url, download=False)
                break
            except Exception:
                pass
            finally:
                if cookies_file:
                    try:
                        os.unlink(cookies_file)
                    except OSError:
                        pass

        # All yt-dlp strategies failed → use cobalt fallback
        if info is None:
            return get_youtube_info_cobalt(url)

    return {
        'title': info.get('title') or 'Unknown',
        'thumbnail': info.get('thumbnail') or '',
        'duration': info.get('duration') or 0,
        'uploader': info.get('uploader') or info.get('channel') or 'Unknown',
        'formats': process_formats(info),
    }


def _json_response(self, code, obj):
    body = json.dumps(obj).encode()
    self.send_response(code)
    self.send_header('Content-Type', 'application/json')
    self.end_headers()
    self.wfile.write(body)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length)) if length else {}

            url = (body.get('url') or '').strip()
            token = body.get('captchaToken', '')
            answer = body.get('captchaAnswer', '')

            if not validate_captcha(token, answer):
                return _json_response(self, 400, {
                    'error': 'Invalid or expired captcha. Please try again.',
                    'captchaFailed': True,
                })

            if not url:
                return _json_response(self, 400, {'error': 'Please provide a URL.'})

            if not is_allowed(url):
                return _json_response(self, 400, {
                    'error': 'Unsupported platform. We support YouTube, Instagram, X, and TikTok.',
                })

            platform = detect_platform(url)
            info = get_video_info(url, platform)
            info['platform'] = platform
            _json_response(self, 200, info)

        except Exception as e:
            _json_response(self, 500, {
                'error': f'Failed to fetch video info: {str(e)}',
            })

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        pass
