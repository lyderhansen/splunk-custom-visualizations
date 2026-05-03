#!/bin/bash
# Generate visualization.css with base64-embedded woff2 fonts.
# This avoids CORS issues in Dashboard Studio's srcdoc iframe.
set -euo pipefail
cd "$(dirname "$0")"

OUTFILE="../visualization.css"

# Font definitions: "FontFamily|filename.woff2|category"
FONTS=(
  "Inter|inter.woff2|Sans-serif"
  "Roboto|roboto.woff2|Sans-serif"
  "Montserrat|montserrat.woff2|Sans-serif"
  "Oswald|oswald.woff2|Sans-serif"
  "Lato|lato.woff2|Sans-serif"
  "Nunito|nunito.woff2|Sans-serif"
  "Raleway|raleway.woff2|Sans-serif"
  "IBM Plex Sans|ibm_plex_sans.woff2|Sans-serif"
  "Playfair Display|playfair_display.woff2|Serif"
  "Merriweather|merriweather.woff2|Serif"
  "Lora|lora.woff2|Serif"
  "PT Serif|pt_serif.woff2|Serif"
  "EB Garamond|eb_garamond.woff2|Serif"
  "Noto Serif|noto_serif.woff2|Serif"
  "Roboto Mono|roboto_mono.woff2|Monospace"
  "Source Code Pro|source_code_pro.woff2|Monospace"
  "JetBrains Mono|jetbrains_mono.woff2|Monospace"
  "Courier Prime|courier_prime.woff2|Monospace"
  "Anonymous Pro|anonymous_pro.woff2|Monospace"
  "Cutive Mono|cutive_mono.woff2|Monospace"
  "Orbitron|orbitron.woff2|Display"
  "Bebas Neue|bebas_neue.woff2|Display"
  "Bangers|bangers.woff2|Display"
  "Press Start 2P|press_start_2p.woff2|Display"
  "Special Elite|special_elite.woff2|Display"
)

cat > "$OUTFILE" << 'HEADER'
/* Embedded Fonts (base64 data URIs — no cross-origin requests)
 * Fonts are inlined to avoid CORS blocks in Dashboard Studio's
 * srcdoc iframe. Regenerate with: fonts/embed-fonts.sh
 */

HEADER

CURRENT_CAT=""
for entry in "${FONTS[@]}"; do
  IFS='|' read -r FAMILY FILE CAT <<< "$entry"

  if [ "$CAT" != "$CURRENT_CAT" ]; then
    echo "/* ── ${CAT} ──────────────────────────────────────── */" >> "$OUTFILE"
    echo "" >> "$OUTFILE"
    CURRENT_CAT="$CAT"
  fi

  if [ ! -f "$FILE" ]; then
    echo "  SKIP — $FILE not found" >&2
    continue
  fi

  B64=$(base64 < "$FILE" | tr -d '\n')
  cat >> "$OUTFILE" << CSSBLOCK
@font-face {
  font-family: '${FAMILY}';
  src: url(data:font/woff2;base64,${B64}) format('woff2');
  font-weight: 100 900;
  font-display: swap;
}

CSSBLOCK
  echo "  Embedded: $FAMILY ($(wc -c < "$FILE" | tr -d ' ') bytes)"
done

cat >> "$OUTFILE" << 'FOOTER'
/* ── Viz container ─────────────────────────────────────────── */

.infographic-shapes-viz {
  background: transparent;
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
FOOTER

echo ""
echo "Done. Generated $OUTFILE with $(grep -c '@font-face' "$OUTFILE") embedded @font-face rules."
echo "Size: $(wc -c < "$OUTFILE" | tr -d ' ') bytes"
