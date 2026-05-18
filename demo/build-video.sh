#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

AUDIO_DIR="audio"
OUTPUT_DIR="output"
SCRIPT="script.json"

# 1. Concatenate all narration MP3s in script.json beat order into one track.
echo "Concatenating audio..."
CONCAT_LIST="$(mktemp)"
trap 'rm -f "$CONCAT_LIST" "$OUTPUT_DIR/narration.mp3"' EXIT

node -e "
  const s = JSON.parse(require('fs').readFileSync('$SCRIPT','utf8'));
  for (const b of s.beats) console.log(\`file '\${process.cwd()}/$AUDIO_DIR/\${b.id}.mp3'\`);
" > "$CONCAT_LIST"

ffmpeg -y -hide_banner -loglevel error \
  -f concat -safe 0 -i "$CONCAT_LIST" \
  -c copy "$OUTPUT_DIR/narration.mp3"

# 2. Find the most recent webm produced by Playwright.
WEBM="$(ls -t "$OUTPUT_DIR"/*.webm 2>/dev/null | head -n 1 || true)"
if [ -z "$WEBM" ]; then
  echo "No .webm found in $OUTPUT_DIR. Run 'npm run record' first."
  exit 1
fi
echo "Video source: $WEBM"

# 3. Mux: re-encode video to H.264, audio to AAC, into MP4.
OUT="$OUTPUT_DIR/thermocycles-demo.mp4"
echo "Muxing -> $OUT"
ffmpeg -y -hide_banner -loglevel error \
  -i "$WEBM" -i "$OUTPUT_DIR/narration.mp3" \
  -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p \
  -c:a aac -b:a 192k \
  -shortest \
  "$OUT"

echo "Done: $OUT"
