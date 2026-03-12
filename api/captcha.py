from http.server import BaseHTTPRequestHandler
import json
import os
import hmac
import hashlib
import time
import random
import base64

SECRET = os.environ.get('CAPTCHA_SECRET', 'dlnow-captcha-secret-2026-change-me')


def generate_captcha_svg(text):
    """Generate a distorted SVG captcha image matching the Node.js version style."""
    width = 220
    height = 70
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">',
        f'<rect width="{width}" height="{height}" fill="#f0f1f5" rx="8"/>',
    ]

    # Noise lines
    for _ in range(6):
        x1 = random.random() * width
        y1 = random.random() * height
        x2 = random.random() * width
        y2 = random.random() * height
        hue = random.random() * 360
        parts.append(
            f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
            f'stroke="hsl({hue:.0f},40%,65%)" stroke-width="1.5" opacity="0.5"/>'
        )

    # Noise dots
    for _ in range(30):
        cx = random.random() * width
        cy = random.random() * height
        r = random.random() * 2 + 0.5
        hue = random.random() * 360
        parts.append(
            f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" '
            f'fill="hsl({hue:.0f},30%,60%)" opacity="0.4"/>'
        )

    # Characters with individual distortion
    total_width = len(text) * 28
    start_x = (width - total_width) / 2 + 14
    char_spacing = 28
    for i, ch in enumerate(text):
        x = start_x + i * char_spacing
        y = 42 + random.random() * 12 - 6
        rotation = random.random() * 20 - 10
        font_size = 26 + random.random() * 6
        hue = 220 + random.random() * 40
        # Escape XML-sensitive characters
        if ch == '&':
            ch = '&amp;'
        elif ch == '<':
            ch = '&lt;'
        elif ch == '>':
            ch = '&gt;'
        parts.append(
            f'<text x="{x}" y="{y:.1f}" '
            f'font-family="monospace,\'Courier New\'" '
            f'font-size="{font_size:.0f}" font-weight="bold" '
            f'fill="hsl({hue:.0f},60%,40%)" '
            f'transform="rotate({rotation:.1f},{x},{y:.1f})">{ch}</text>'
        )

    # Wavy path overlay
    wy = [35 + random.random() * 10 for _ in range(3)]
    wave_path = (
        f'M0,{wy[0]:.0f} Q{width * 0.25:.0f},{20 + random.random() * 30:.0f} '
        f'{width * 0.5:.0f},{wy[1]:.0f} T{width},{wy[2]:.0f}'
    )
    parts.append(
        f'<path d="{wave_path}" stroke="rgba(99,102,241,0.15)" '
        f'stroke-width="2" fill="none"/>'
    )

    parts.append('</svg>')
    return ''.join(parts)


def generate_captcha():
    """Generate a number CAPTCHA with HMAC-signed stateless token."""
    digits = random.randint(5, 6)
    answer = random.randint(10 ** (digits - 1), 10 ** digits - 1)
    text = str(answer)
    svg = generate_captcha_svg(text)

    # Stateless HMAC token (no server-side storage needed for serverless)
    timestamp = int(time.time())
    nonce = random.randint(10000, 99999)
    message = f'{answer}:{timestamp}:{nonce}'
    signature = hmac.new(
        SECRET.encode(), message.encode(), hashlib.sha256
    ).hexdigest()

    token = base64.b64encode(json.dumps({
        't': timestamp,
        'n': nonce,
        's': signature,
    }).encode()).decode()

    return {'token': token, 'svg': svg}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        result = generate_captcha()
        body = json.dumps(result).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        pass
