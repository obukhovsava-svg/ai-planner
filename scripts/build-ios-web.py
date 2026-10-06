#!/usr/bin/env python3
"""Builds the web UI for the iOS app: one self-contained ios/Planner/Web/index.html.

The app serves it from its bundle (planner://app/), so it works offline and opens instantly.
The Telegram bridge script is left out — inside the app there is no Telegram.

usage (from the repo root): python3 scripts/build-ios-web.py
"""
import re
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent.parent
out = root / 'dist-ios'
subprocess.run(['npx', 'vite', 'build', '--outDir', str(out), '--emptyOutDir'], cwd=root, check=True)

html = (out / 'index.html').read_text()
html = re.sub(r'\s*<!--[^>]*Telegram WebApp bridge[^>]*-->', '', html)
html = re.sub(r'\s*<script src="https://telegram\.org/[^"]*"></script>', '', html)


def inline_css(m: re.Match) -> str:
    css = (out / m.group(1).lstrip('./')).read_text()
    return f'<style>{css}</style>'


def inline_js(m: re.Match) -> str:
    js = (out / m.group(1).lstrip('./')).read_text().replace('</script', '<\\/script')
    return f'<script type="module">{js}</script>'


html = re.sub(r'<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>', inline_css, html)
html = re.sub(r'<script type="module"[^>]*src="([^"]+)"[^>]*></script>', inline_js, html)
assert 'telegram.org' not in html and './assets/' not in html, 'something was not inlined'

dest = root / 'ios' / 'Planner' / 'Web' / 'index.html'
dest.write_text(html)
print(f'{dest.relative_to(root)}: {len(html) // 1024} KB')
