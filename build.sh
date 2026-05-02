#!/usr/bin/env bash
set -euo pipefail

#
# build.sh — Build and package Splunk custom visualization apps
#
# Usage:
#   ./build.sh                    # Build all viz apps in examples/
#   ./build.sh custom_single_value # Build a specific viz app
#
# Output: {app_name}-{version}.tar.gz in the dist/ directory
#

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXAMPLES_DIR="$SCRIPT_DIR/examples"
OUTPUT_DIR="$SCRIPT_DIR/dist"

# Optional: path to shared font CSS to prepend to visualization.css
FONT_CSS="$SCRIPT_DIR/shared/fonts.css"

mkdir -p "$OUTPUT_DIR"

build_app() {
    local APP_NAME="$1"
    local APP_DIR="$EXAMPLES_DIR/$APP_NAME"
    local VIZ_BASE="$APP_DIR/appserver/static/visualizations"

    if [ ! -d "$APP_DIR" ]; then
        echo "Error: App directory not found: $APP_DIR"
        return 1
    fi

    if [ ! -f "$APP_DIR/default/app.conf" ]; then
        echo "Error: No app.conf found in $APP_DIR/default/"
        return 1
    fi

    local VERSION
    VERSION=$(grep '^version' "$APP_DIR/default/app.conf" | head -1 | cut -d= -f2 | tr -d ' ')
    local TARBALL="$OUTPUT_DIR/${APP_NAME}-${VERSION}.tar.gz"

    echo "=== Building: $APP_NAME v$VERSION ==="
    echo ""

    # Discover all viz directories (multi-viz apps have multiple, single-viz apps have one)
    local VIZ_DIRS=()
    if [ -d "$VIZ_BASE" ]; then
        for vd in "$VIZ_BASE"/*/; do
            if [ -f "$vd/package.json" ]; then
                VIZ_DIRS+=("$vd")
            fi
        done
    fi

    if [ ${#VIZ_DIRS[@]} -eq 0 ]; then
        echo "Error: No visualization directories found with package.json in $VIZ_BASE"
        return 1
    fi

    local VIZ_COUNT=${#VIZ_DIRS[@]}
    local VIZ_IDX=0

    # Step 1 & 2: Install dependencies + build for each viz
    for VIZ_DIR in "${VIZ_DIRS[@]}"; do
        VIZ_IDX=$((VIZ_IDX + 1))
        local VIZ_NAME
        VIZ_NAME=$(basename "$VIZ_DIR")
        echo "[$VIZ_IDX/$VIZ_COUNT] Building viz: $VIZ_NAME"

        if [ ! -d "$VIZ_DIR/node_modules" ]; then
            echo "         Installing npm dependencies..."
            (cd "$VIZ_DIR" && npm install --silent)
        fi

        echo "         Building webpack bundle..."
        (cd "$VIZ_DIR" && npm run build --silent)
    done

    # Step 3: Optionally prepend shared font CSS to each viz
    local CSS_ORIGINALS=()
    local CSS_PATHS=()
    for VIZ_DIR in "${VIZ_DIRS[@]}"; do
        local VIZ_CSS="$VIZ_DIR/visualization.css"
        if [ -n "${FONT_CSS:-}" ] && [ -f "${FONT_CSS:-}" ] && [ -f "$VIZ_CSS" ] && ! grep -q "@font-face" "$VIZ_CSS"; then
            echo "       Prepending shared font CSS to $(basename "$VIZ_DIR")/visualization.css..."
            CSS_PATHS+=("$VIZ_CSS")
            CSS_ORIGINALS+=("$(cat "$VIZ_CSS")")
            cat "$FONT_CSS" "$VIZ_CSS" > "$VIZ_CSS.tmp" && mv "$VIZ_CSS.tmp" "$VIZ_CSS"
        fi
    done

    # Step 4: Package tarball
    echo "Packaging $TARBALL..."

    # Build tar flags (macOS needs extra flags to suppress resource forks)
    local TAR_FLAGS=()
    if [[ "$(uname)" == "Darwin" ]]; then
        xattr -rc "$APP_DIR" 2>/dev/null || true
        export COPYFILE_DISABLE=1
        TAR_FLAGS+=(--disable-copyfile --no-xattrs --no-mac-metadata)
    fi

    # Build exclude patterns for all viz directories
    local EXCLUDE_FLAGS=()
    EXCLUDE_FLAGS+=(--exclude='.*' --exclude='._*' --exclude='__MACOSX')
    EXCLUDE_FLAGS+=(--exclude='*/visualizations/*/node_modules')
    EXCLUDE_FLAGS+=(--exclude='*/visualizations/*/src')
    EXCLUDE_FLAGS+=(--exclude='*/visualizations/*/package.json')
    EXCLUDE_FLAGS+=(--exclude='*/visualizations/*/package-lock.json')
    EXCLUDE_FLAGS+=(--exclude='*/visualizations/*/webpack.config.js')
    EXCLUDE_FLAGS+=(--exclude='*/static/shared')

    tar "${TAR_FLAGS[@]}" "${EXCLUDE_FLAGS[@]}" \
        -czf "$TARBALL" \
        -C "$EXAMPLES_DIR" \
        "$APP_NAME"

    # Restore original CSS files
    for i in "${!CSS_PATHS[@]}"; do
        echo "${CSS_ORIGINALS[$i]}" > "${CSS_PATHS[$i]}"
    done

    echo ""
    echo "Done! Install with:"
    echo "  \$SPLUNK_HOME/bin/splunk install app $TARBALL"
    echo ""
}

# Main
if [ $# -gt 0 ]; then
    # Build specific app(s)
    for app in "$@"; do
        build_app "$app"
    done
else
    # Build all apps in examples/
    echo "Building all visualization apps..."
    echo ""
    for app_dir in "$EXAMPLES_DIR"/*/; do
        app_name=$(basename "$app_dir")
        if [ -f "$app_dir/default/app.conf" ]; then
            build_app "$app_name"
        fi
    done
fi
