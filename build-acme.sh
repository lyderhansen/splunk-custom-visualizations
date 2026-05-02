#!/usr/bin/env bash
set -euo pipefail

#
# build-acme.sh — Build and package the acme_splunk_viz multi-viz app.
#
# Single multi-entry webpack build produces 16 visualization.js bundles,
# then packages everything (minus dev files) into one installable tarball.
#

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="acme_splunk_viz"
APP_DIR="$SCRIPT_DIR/examples/$APP_NAME"
BUILD_DIR="$APP_DIR/_build"
VIZ_ROOT="$APP_DIR/appserver/static/visualizations"
OUTPUT_DIR="$SCRIPT_DIR/dist"
FONT_CSS="$SCRIPT_DIR/shared/fonts.css"

mkdir -p "$OUTPUT_DIR"

VERSION=$(grep '^version' "$APP_DIR/default/app.conf" | head -1 | cut -d= -f2 | tr -d ' ')
TARBALL="$OUTPUT_DIR/${APP_NAME}-${VERSION}.tar.gz"

echo "=== Building: $APP_NAME v$VERSION ==="

# Step 1: install dev deps
if [ ! -d "$BUILD_DIR/node_modules" ]; then
    echo "[1/4] Installing npm dependencies..."
    (cd "$BUILD_DIR" && npm install --silent)
else
    echo "[1/4] Dependencies already installed, skipping."
fi

# Step 2: webpack — one build, 16 outputs
echo "[2/4] Building 16 visualization bundles..."
(cd "$BUILD_DIR" && npm run build --silent)

# Step 2b: regenerate icons + previews (only if Python+PIL available)
if command -v python3 >/dev/null 2>&1 && python3 -c "import PIL" 2>/dev/null; then
    echo "       Regenerating app icons + viz previews..."
    (cd "$APP_DIR" && python3 _build/generate_assets.py >/dev/null)
else
    echo "       Skipping asset regeneration (python3 + Pillow not found)."
fi

# Step 2c: ensure formatter HTML is multi-line (Splunk's editor parser is
#         whitespace-sensitive; compact one-line forms break radio inputs)
if command -v python3 >/dev/null 2>&1; then
    echo "       Ensuring formatters are multi-line..."
    (cd "$APP_DIR" && python3 _build/expand_formatters.py >/dev/null)
fi

# Step 2d: sync formatter settings into harness.json + savedsearches.conf.spec
if command -v python3 >/dev/null 2>&1; then
    echo "       Syncing formatter settings to harness + spec..."
    (cd "$APP_DIR" && python3 _build/sync_settings.py >/dev/null)
fi

# Step 3: prepend shared font CSS to each viz CSS for self-contained packaging
declare -a MODIFIED_CSS=()
declare -a ORIGINAL_CONTENT=()
if [ -f "$FONT_CSS" ]; then
    echo "[3/4] Merging shared font CSS into each viz..."
    for viz_dir in "$VIZ_ROOT"/*/; do
        viz_css="$viz_dir/visualization.css"
        if [ -f "$viz_css" ] && ! grep -q "@font-face" "$viz_css"; then
            MODIFIED_CSS+=("$viz_css")
            ORIGINAL_CONTENT+=("$(cat "$viz_css")")
            cat "$FONT_CSS" "$viz_css" > "$viz_css.tmp" && mv "$viz_css.tmp" "$viz_css"
        fi
    done
else
    echo "[3/4] No shared/fonts.css — skipping font merge."
fi

# Step 4: tar
echo "[4/4] Packaging $TARBALL..."

TAR_FLAGS=()
if [[ "$(uname)" == "Darwin" ]]; then
    xattr -rc "$APP_DIR" 2>/dev/null || true
    export COPYFILE_DISABLE=1
    TAR_FLAGS+=(--disable-copyfile --no-xattrs --no-mac-metadata)
fi

tar "${TAR_FLAGS[@]}" \
    --exclude='.*' --exclude='._*' --exclude='__MACOSX' \
    --exclude="$APP_NAME/_build" \
    --exclude="$APP_NAME/appserver/static/visualizations/*/src" \
    -czf "$TARBALL" \
    -C "$APP_DIR/.." \
    "$APP_NAME"

# Restore each modified CSS
if [ ${#MODIFIED_CSS[@]} -gt 0 ]; then
    for i in "${!MODIFIED_CSS[@]}"; do
        echo "${ORIGINAL_CONTENT[$i]}" > "${MODIFIED_CSS[$i]}"
    done
fi

echo ""
echo "Done! Install with:"
echo "  \$SPLUNK_HOME/bin/splunk install app $TARBALL"
echo ""
ls -lh "$TARBALL"
