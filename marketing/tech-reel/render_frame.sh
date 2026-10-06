#!/bin/sh
# render_frame.sh <frame index> — screenshots tech.html at t = index / 30 into $OUT/raw
t=$(echo "scale=4; $1/30" | bc)
n=$(printf "%04d" "$1")
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1080,2300 --virtual-time-budget=600 --screenshot="$OUT/raw/f$n.png" "file://$HTML?t=$t" >/dev/null 2>&1
