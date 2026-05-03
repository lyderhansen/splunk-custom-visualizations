#!/bin/bash
# Download Google Fonts as woff2 (latin subset) for local embedding.
#
# Usage:  ./download-fonts.sh              # download all default fonts
#         ./download-fonts.sh "Fira Code"  # download one extra font
#
# Tries variable font range (wght@100..900) first for real bold/light,
# falls back to static weight 400 for fonts without a variable axis.
# The LATIN subset is always the LAST block in Google's CSS response.

set -euo pipefail
cd "$(dirname "$0")"

UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

FONTS=(
  # ── Sans-serif ──
  "Inter"
  "Roboto"
  "Montserrat"
  "Oswald"
  "Lato"
  "Nunito"
  "Raleway"
  "IBM Plex Sans"
  # ── Serif ──
  "Playfair Display"
  "Merriweather"
  "Lora"
  "PT Serif"
  "EB Garamond"
  "Noto Serif"
  # ── Monospace / Typewriter ──
  "Roboto Mono"
  "Source Code Pro"
  "JetBrains Mono"
  "Courier Prime"
  "Anonymous Pro"
  "Cutive Mono"
  # ── Display / Decorative ──
  "Orbitron"
  "Bebas Neue"
  "Bangers"
  "Press Start 2P"
  "Special Elite"
)

if [ $# -gt 0 ]; then
  FONTS=("$@")
fi

CSS_OUT="fonts.css"
> "$CSS_OUT"

for FONT in "${FONTS[@]}"; do
  SLUG=$(echo "$FONT" | tr ' ' '+')
  SAFE=$(echo "$FONT" | tr ' ' '_' | tr '[:upper:]' '[:lower:]')
  FILE="${SAFE}.woff2"

  echo "Downloading: $FONT"

  # Try variable font first (wght@100..900) for real bold/light weights
  CSS_URL="https://fonts.googleapis.com/css2?family=${SLUG}:wght@100..900&display=swap"
  CSS=$(curl -sS -H "User-Agent: $UA" "$CSS_URL" 2>/dev/null || true)
  WOFF2_URL=$(echo "$CSS" | grep -oE 'url\([^)]+\.woff2' | sed 's/url(//' | tail -1 || true)
  IS_VARIABLE="yes"

  if [ -z "$WOFF2_URL" ]; then
    # Fallback: try explicit 400+700
    CSS_URL="https://fonts.googleapis.com/css2?family=${SLUG}:wght@400;700&display=swap"
    CSS=$(curl -sS -H "User-Agent: $UA" "$CSS_URL" 2>/dev/null || true)
    WOFF2_URL=$(echo "$CSS" | grep -oE 'url\([^)]+\.woff2' | sed 's/url(//' | tail -1 || true)
    IS_VARIABLE="no"
  fi

  if [ -z "$WOFF2_URL" ]; then
    # Final fallback: weight 400 only
    CSS_URL="https://fonts.googleapis.com/css2?family=${SLUG}:wght@400&display=swap"
    CSS=$(curl -sS -H "User-Agent: $UA" "$CSS_URL" 2>/dev/null || true)
    WOFF2_URL=$(echo "$CSS" | grep -oE 'url\([^)]+\.woff2' | sed 's/url(//' | tail -1 || true)
    IS_VARIABLE="no"
  fi

  if [ -z "$WOFF2_URL" ]; then
    echo "  SKIP — could not resolve woff2 URL for '$FONT'"
    continue
  fi

  curl -sS -o "$FILE" "$WOFF2_URL"
  SIZE=$(wc -c < "$FILE" | tr -d ' ')
  echo "  Saved: $FILE ($SIZE bytes, variable=$IS_VARIABLE)"

  cat >> "$CSS_OUT" <<CSSBLOCK
@font-face {
  font-family: '$FONT';
  src: url('fonts/${FILE}') format('woff2');
  font-weight: 100 900;
  font-display: swap;
}

CSSBLOCK
done

echo ""
echo "Done. Generated $CSS_OUT with $(grep -c '@font-face' "$CSS_OUT") @font-face rules."
echo ""
echo "Next steps:"
echo "  1. Run: fonts/embed-fonts.sh    (generate base64 visualization.css)"
echo "  2. Run: npx webpack --mode production"
