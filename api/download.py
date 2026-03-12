from http.server import BaseHTTPRequestHandler
import json
import os
import re

import tempfile

import yt_dlp


def get_cookies_file():
    """Write YT_COOKIES env var to a temp file for yt-dlp.
    Auto-detects Netscape format vs browser header format (name=value; name=value)."""
    cookies_str = os.environ.get('YT_COOKIES', '').strip()
    if not cookies_str:
        return None

    # Auto-detect format
    if cookies_str.startswith('#') or '\t' in cookies_str:
        # Already in Netscape format
        content = cookies_str
    else:
        # Header format: name=value; name2=value2 (from Network tab)
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


def sanitize_filename(name):
    """Remove characters invalid in filenames."""
    name = re.sub(r'[<>:"/\\|?*]', '', name)
    name = name.strip('. ')
    return name[:200] if name else 'download'


def get_download_url(url, format_id):
    platform = detect_platform(url)

    base_opts = {
        'quiet': True,
        'no_warnings': True,
        'no_color': True,
        'no_playlist': True,
        'format': format_id,
    }

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
        # YouTube: try multiple strategies
        strategies = [
            {
                'extractor_args': {'youtube': {
                    'player_client': ['mediaconnect'],
                    'player_skip': ['webpage', 'configs'],
                }},
                'use_cookies': True,
            },
            {
                'extractor_args': {'youtube': {
                    'player_client': ['web_creator'],
                    'player_skip': ['webpage'],
                }},
                'use_cookies': True,
            },
            {
                'extractor_args': {'youtube': {
                    'player_client': ['mediaconnect'],
                    'player_skip': ['webpage', 'configs'],
                }},
                'use_cookies': False,
            },
            {
                'extractor_args': {'youtube': {
                    'player_client': ['web_creator'],
                }},
                'use_cookies': False,
            },
        ]

        last_err = None
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
                break  # success
            except Exception as e:
                last_err = e
            finally:
                if cookies_file:
                    try:
                        os.unlink(cookies_file)
                    except OSError:
                        pass

        if info is None:
            raise last_err or Exception('All YouTube strategies failed')

    # Direct URL from top-level info
    direct_url = info.get('url')

    # Some formats come via requested_formats (merged streams)
    if not direct_url and 'requested_formats' in info:
        for rf in info['requested_formats']:
            if rf.get('url'):
                direct_url = rf['url']
                break

    # Fallback: search the formats list
    if not direct_url:
        for f in info.get('formats', []):
            if f.get('format_id') == format_id and f.get('url'):
                direct_url = f['url']
                break

    if not direct_url:
        raise Exception('Could not extract download URL for this format')

    title = sanitize_filename(info.get('title') or 'download')
    ext = info.get('ext') or 'mp4'

    return {
        'url': direct_url,
        'filename': f'{title}.{ext}',
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
            format_id = body.get('format') or body.get('formatId') or ''

            if not url or not format_id:
                return _json_response(self, 400, {
                    'error': 'URL and format are required.',
                })

            result = get_download_url(url, format_id)
            _json_response(self, 200, result)

        except Exception as e:
            _json_response(self, 500, {
                'error': f'Download failed: {str(e)}',
            })

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        pass
