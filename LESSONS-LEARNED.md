# Splunk Custom Visualizations — Lessons Learned & Training Reference

> Distilled from building **infographic_shapes** (advanced shape/effects engine) and **icon_library** (Material Symbols icon renderer). Every lesson below was learned the hard way — through bugs, AppInspect failures, CORS errors, and hours of debugging.

---

## Table of Contents

1. [Font Loading — The #1 Pain Point](#1-font-loading--the-1-pain-point)
2. [Background Transparency — Dashboard Studio vs Your Code](#2-background-transparency--dashboard-studio-vs-your-code)
3. [Webpack ES5 — Silent Failures](#3-webpack-es5--silent-failures)
4. [Option Namespace — Short Keys vs Full Keys](#4-option-namespace--short-keys-vs-full-keys)
5. [The getOption Helper — Mandatory](#5-the-getoption-helper--mandatory)
6. [Formatter HTML — Exact Labels or Duplicate Groups](#6-formatter-html--exact-labels-or-duplicate-groups)
7. [Canvas Font Rendering — Not Like HTML](#7-canvas-font-rendering--not-like-html)
8. [HiDPI / Retina Canvas Scaling](#8-hidpi--retina-canvas-scaling)
9. [Auto-Scaling Formulas](#9-auto-scaling-formulas)
10. [Drilldown Implementation](#10-drilldown-implementation)
11. [AppInspect — Failure Catalog](#11-appinspect--failure-catalog)
12. [Dashboard Studio Type Format](#12-dashboard-studio-type-format)
13. [MutationObserver — Hiding Splunk Placeholders](#13-mutationobserver--hiding-splunk-placeholders)
14. [Reflow — Two Approaches](#14-reflow--two-approaches)
15. [Canvas Effects Stacking Order](#15-canvas-effects-stacking-order)
16. [Animation on Canvas](#16-animation-on-canvas)
17. [Data Contract and formatData](#17-data-contract-and-formatdata)
18. [Test Harness Gotchas](#18-test-harness-gotchas)
19. [Packaging — What to Exclude](#19-packaging--what-to-exclude)
20. [Skill Gaps — What the Existing Skill Gets Wrong](#20-skill-gaps--what-the-existing-skill-gets-wrong)

---

## 1. Font Loading — The #1 Pain Point

### The Problem

Splunk custom visualizations render inside an `<iframe>` with `src="about:srcdoc"`. This means:

- **CORS blocks all external font requests.** The iframe origin is `null`, so any `@font-face` with a URL path (even to the same Splunk server) fails with:
  ```
  Access to font at 'http://localhost:8000/.../fonts/inter.woff2'
  from origin 'null' has been blocked by CORS policy
  ```
- **Relative `url()` paths in CSS do not work.** Splunk rewrites static asset URLs through a cache-busting path (`/static/@hash/app/...`), but the iframe's origin mismatch still blocks them.
- **The JavaScript `FontFace` API fails** for the same CORS reason — it cannot fetch the font binary.

### The Solution: Base64 Data URIs

The **only** reliable method is embedding fonts as base64 data URIs directly in `visualization.css`:

```css
@font-face {
    font-family: 'Material Symbols Outlined';
    src: url(data:font/woff2;base64,d09GMgABAAAAAP...{huge blob}...) format('woff2');
    font-weight: 100 700;
    font-display: swap;
}
```

**How to generate:**
```bash
base64 -i MaterialSymbols.woff2 | tr -d '\n'
```

**Trade-offs:**
- File size: a single woff2 can be 300KB+, base64 adds ~33% → visualization.css can exceed 400KB
- Build time: webpack doesn't touch CSS, so the blob is just... there
- Works on Splunk Cloud, on-prem, air-gapped environments — everywhere

### Two Font Embedding Architectures

**Architecture A: All-in-one CSS (icon_library)**

One `visualization.css` contains both the base64 `@font-face` and container styles. Simple, self-contained.

```
visualization.css  →  @font-face { ... base64 ... }
                      .icon-library-viz { ... }
```

**Architecture B: Separate fonts + build-time merge (infographic_shapes)**

A `fonts/fonts.css` holds all `@font-face` declarations (with base64). A build step prepends it to `visualization.css`. Source stays clean; shipped CSS is self-contained.

```
fonts/fonts.css    →  @font-face 'Inter' { base64 }
                      @font-face 'Oswald' { base64 }
                      @font-face 'Fira Code' { base64 }
visualization.css  →  .infographic-shapes-viz { ... }

build.sh           →  cat fonts/fonts.css visualization.css > visualization.css.tmp
                      mv visualization.css.tmp visualization.css
```

Architecture B is better when you have many fonts (infographic_shapes ships 12+).

### Runtime Font Readiness (Critical for Canvas)

CSS `@font-face` registers the font, but **Canvas 2D does not auto-swap** when the font loads (unlike HTML text nodes). You must explicitly wait.

**Pattern from icon_library (Material Symbols):**
```javascript
var _fontReady = false;
var _fontPending = false;

function loadFont(onReady) {
    if (_fontReady) { onReady(); return; }
    if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) {
        setTimeout(onReady, 200);
        return;
    }
    if (!_fontPending) {
        _fontPending = true;
        document.fonts.load('400 48px "Material Symbols Outlined"').then(function() {
            _fontReady = true;
        });
    }
    var attempts = 0;
    var poll = function() {
        attempts++;
        if (_fontReady || attempts > 30) {
            _fontReady = true;
            onReady();
            return;
        }
        setTimeout(poll, 100);
    };
    poll();
}
```

**Key insight:** `document.fonts.load()` returns a promise, but it can resolve before the font is actually usable by Canvas. The **poll loop** (up to 30 × 100ms = 3 seconds) is a safety net. After 30 attempts, force `_fontReady = true` and render anyway — better to show fallback glyphs than a blank canvas.

**Pattern from infographic_shapes (multiple fonts):**
```javascript
if (document.fonts && document.fonts.check) {
    if (!document.fonts.check('16px "FontName"')) {
        document.fonts.load('16px "FontName"').then(function() {
            self.invalidateUpdateView();
        });
    }
}
```

This checks per-font and triggers a re-render when each font becomes available.

### Lesson

> Never use URL-based font loading in Splunk custom visualizations. Always base64 encode into CSS. Always poll for font readiness before Canvas drawing.

---

## 2. Background Transparency — Dashboard Studio vs Your Code

### The Problem

When you add a custom visualization panel in Dashboard Studio, the panel background defaults to a dark color (often `#53535E` or similar). You cannot change this from inside the visualization's JavaScript or CSS.

### What We Tried (All Failed)

1. **CSS in `visualization.css`:**
   ```css
   html, body { background: transparent !important; }
   ```
   Only affects the iframe's internal document — Dashboard Studio's React container wraps the iframe in its own styled `<div>`.

2. **JavaScript DOM traversal from `initialize()`:**
   ```javascript
   var frame = window.frameElement;
   if (frame) frame.style.background = 'transparent';
   frame.parentElement.style.background = 'transparent';
   ```
   Briefly works, then Dashboard Studio's React reconciler re-applies styles on the next render cycle.

3. **Aggressive polling in `updateView()`:**
   ```javascript
   setInterval(function() {
       // walk up the DOM and force transparent
   }, 500);
   ```
   Race condition with React. Sometimes works, sometimes doesn't. Unreliable.

### The Correct Solution

`backgroundColor` is a **Dashboard Studio panel-level option**. The only reliable way to set it is in the dashboard JSON:

```json
"viz_my_icon": {
    "type": "icon_library.icon_library",
    "options": {
        "icon_library.icon_library.iconName": "home",
        "backgroundColor": "transparent"
    }
}
```

Note: `backgroundColor` is a **built-in Dashboard Studio option** (no namespace prefix), while `icon_library.icon_library.iconName` is a custom viz option (with namespace prefix).

### What To Do About It

1. **Document it everywhere** — README, in-app readme dashboard, Quick Start sections
2. **Set it in all demo dashboards** — showcase.xml, readme.xml
3. **Accept it** — this is a Dashboard Studio architectural decision, not a bug

### Lesson

> You cannot control the Dashboard Studio panel background from inside a custom visualization. Document `"backgroundColor": "transparent"` as a required setup step for users.

---

## 3. Webpack ES5 — Silent Failures

### The Problem

Splunk's AMD module loader requires ES5-compatible JavaScript. Webpack 5+ defaults to ES2015+ output including arrow functions and shorthand methods. If your bundle contains ES6 syntax, the viz may:
- Fail to load silently
- Load but break when Dashboard Studio tries to bind formatter properties
- Work in the test harness but fail in Splunk

### The Fix

```javascript
// webpack.config.js — MANDATORY for all Splunk custom vizs
var path = require('path');

module.exports = {
    target: ['web', 'es5'],
    entry: './src/visualization_source.js',
    output: {
        filename: 'visualization.js',
        path: path.resolve(__dirname),
        libraryTarget: 'amd',
        environment: {
            arrowFunction: false,
            bigIntLiteral: false,
            const: false,
            destructuring: false,
            forOf: false,
            dynamicImport: false,
            module: false
        }
    },
    externals: [
        'api/SplunkVisualizationBase'
    ]
};
```

### Verification After Every Build

```bash
head -c 200 visualization.js
# Must start with: define(["api/SplunkVisualizationBase"], function(
# Must NOT start with: define(["api/SplunkVisualizationBase"], (
```

The difference is `function(` vs `(` — an arrow function in the AMD wrapper is the #1 sign of broken ES5 output.

### Lesson

> Always set `target: ['web', 'es5']` and all `output.environment` flags to `false`. Verify the bundle after every build.

---

## 4. Option Namespace — Short Keys vs Full Keys

### Dashboard Studio JSON Options

In Dashboard Studio v2, custom visualization options use **short keys** (namespace prefix only, no `display.visualizations.custom.` prefix):

```json
"viz_example": {
    "type": "icon_library.icon_library",
    "options": {
        "icon_library.icon_library.iconName": "search",
        "icon_library.icon_library.iconColor": "#06B6D4"
    }
}
```

### BANNED Formats

| Format | Where it fails |
|--------|---------------|
| `"display.visualizations.custom.icon_library.icon_library.iconName"` | Dashboard Studio ignores it |
| `"iconName"` (no prefix at all) | Works in test harness, fails in Splunk |

### savedsearches.conf

Uses the **full** namespace:
```ini
display.visualizations.custom.icon_library.icon_library.iconName = home
```

### formatter.html

Uses `{{VIZ_NAMESPACE}}` which Splunk replaces at load time:
```html
<splunk-text-input name="{{VIZ_NAMESPACE}}.iconName" value="home">
```

### Lesson

> Three different namespace formats for three different contexts. Get any one wrong and the setting silently fails.

---

## 5. The getOption Helper — Mandatory

Dashboard Studio may pass formatter-changed values as short keys (without namespace prefix), while initial dashboard JSON values use the full namespace. You need to check both.

```javascript
function getOption(config, ns, key, defaultValue) {
    var v = config[ns + key];
    if (v !== undefined && v !== null) return v;
    v = config[key];
    if (v !== undefined && v !== null) return v;
    return defaultValue;
}
```

Also add a safe namespace getter for test harness compatibility:

```javascript
function getNS(viz) {
    try {
        var info = viz.getPropertyNamespaceInfo();
        if (info && info.propertyNamespace) return info.propertyNamespace;
    } catch (e) { /* harness or early call */ }
    return '';
}
```

### In updateView:
```javascript
var ns = getNS(this);
var iconName = getOption(config, ns, 'iconName', 'home');
var iconColor = getOption(config, ns, 'iconColor', '#F8FAFC');
```

### Lesson

> Never use `config[ns + 'key'] || 'default'` directly. Always use `getOption`. The `getNS` wrapper prevents crashes in the test harness.

---

## 6. Formatter HTML — Exact Labels or Duplicate Groups

### The Problem

Dashboard Studio merges formatter sections into its built-in settings groups by matching `section-label` values **exactly** (case-sensitive). If you use the wrong label, Dashboard Studio creates a **duplicate group** prefixed with the viz name.

### Required Labels (Exact Match)

```html
<form class="splunk-formatter-section" section-label="Data configurations">
<form class="splunk-formatter-section" section-label="Data display">
<form class="splunk-formatter-section" section-label="Color and style">
```

### BANNED Labels

| Wrong | Why | Right |
|-------|-----|-------|
| `"Data Configuration"` | Singular, capital C | `"Data configurations"` |
| `"Data Display"` | Capital D | `"Data display"` |
| `"Color and Style"` | Capital S | `"Color and style"` |

### Structure Rules

- **No wrapper `<div>`** around the forms — bare `<form>` elements only
- **No nested `<form>` inside `<form>`** — invalid HTML, breaks property binding
- Every `<splunk-control-group>` **must have `help="..."`** attribute

### Exception: infographic_shapes Uses 6 Sections

The infographic_shapes viz uses six custom sections (`Shape`, `Fill and Stroke`, `Effects`, `Text and Font`, `Data Binding`, etc.) instead of the standard three. This creates viz-prefixed groups in Dashboard Studio but was intentional — the viz has too many settings for three tabs. This is a valid design choice when settings are genuinely complex.

### Lesson

> For most vizs, use exactly three sections with the exact standard labels. Only add custom sections when the complexity genuinely demands it.

---

## 7. Canvas Font Rendering — Not Like HTML

### The Problem

Unlike HTML text nodes, Canvas 2D text does **not** automatically re-render when a web font loads. If you call `ctx.fillText('home', x, y)` before `Material Symbols Outlined` is loaded, you get a fallback glyph (usually a rectangle or tofu character) — and it **stays** that way until you explicitly re-render.

### Solution Pattern

1. Register font via base64 `@font-face` in CSS
2. In `updateView`, check font readiness before drawing
3. If font isn't ready, poll and trigger re-render when it is
4. After first successful font load, skip the check on subsequent calls

```javascript
updateView: function(data, config) {
    this._lastConfig = config;
    this._lastData = data;
    var self = this;
    if (!this._fontDone) {
        loadFont(function() {
            self._fontDone = true;
            self._render(data, config);
        });
    } else {
        this._render(data, config);
    }
}
```

### Font String Quoting for Canvas

```javascript
// WRONG — broken quotes
ctx.font = '400 48px \'Material Symbols Outlined\'';

// CORRECT — escaped double quotes in single-quoted JS string
ctx.font = '400 48px "Material Symbols Outlined"';

// CORRECT — variable approach (safest for complex font stacks)
var fontStack = '"Material Symbols Outlined", sans-serif';
ctx.font = '400 ' + iconSize + 'px ' + fontStack;
```

### Lesson

> Always wait for font readiness before Canvas text rendering. Use escaped double quotes in `ctx.font` strings.

---

## 8. HiDPI / Retina Canvas Scaling

Every custom viz must handle high-DPI displays. Without this, the canvas renders at 1x resolution and looks blurry on Retina/4K screens.

```javascript
var el = this.el;
var w = el.offsetWidth;
var h = el.offsetHeight;
if (w <= 0 || h <= 0) return;

var dpr = window.devicePixelRatio || 1;
var canvas = this.canvas;
canvas.width = w * dpr;
canvas.height = h * dpr;
canvas.style.width = w + 'px';
canvas.style.height = h + 'px';

var ctx = canvas.getContext('2d');
if (!ctx) return;
ctx.scale(dpr, dpr);
ctx.clearRect(0, 0, w, h);

// All drawing uses w, h (CSS pixels), NOT canvas.width/height
```

### Lesson

> Set canvas dimensions to CSS pixels × devicePixelRatio, then `ctx.scale(dpr, dpr)`. Draw using CSS pixel values.

---

## 9. Auto-Scaling Formulas

Hardcoded pixel values break when panels resize. Use these formulas:

| Element | Formula | Min | Max |
|---------|---------|-----|-----|
| Primary value | `Math.min(w, h) * 0.35` | 14 | 72 |
| Title / label | `Math.min(w, h) * 0.09` | 8 | 20 |
| Unit text | `valueFontSize * 0.45` | 8 | 28 |
| Padding | `Math.max(8, Math.min(w, h) * 0.04)` | 8 | — |

### User Override Pattern

```javascript
var userFontSize = parseInt(getOption(config, ns, 'iconSize', '0'), 10);
var iconSize;
if (userFontSize > 0) {
    iconSize = userFontSize;
} else {
    iconSize = Math.max(16, Math.min(200, Math.min(w, h) * 0.6));
}
```

`0` means auto-scale. Any positive value is a user override.

### fitText Helper

Shrink text to fit available width (not used in icon_library, but essential for KPI vizs):

```javascript
function fitText(ctx, text, maxWidth, startSize, minSize) {
    var size = startSize;
    var min = minSize || 8;
    ctx.font = 'bold ' + size + 'px monospace';
    while (ctx.measureText(text).width > maxWidth && size > min) {
        size -= 1;
        ctx.font = 'bold ' + size + 'px monospace';
    }
    return size;
}
```

### Lesson

> Default to auto-scale (setting = 0). Let users override with explicit pixel values. Always clamp with min/max.

---

## 10. Drilldown Implementation

### Approach 1: Splunk Native Drilldown (icon_library)

```javascript
drilldown: function(params, event) {
    var data = params.data || {};
    return {
        action: SplunkVisualizationBase.FIELD_VALUE_DRILLDOWN,
        data: data
    };
},

// In click handler:
self.drilldown({
    action: SplunkVisualizationBase.FIELD_VALUE_DRILLDOWN,
    data: { icon: iconName, label: labelText, color: iconColor }
}, event);
```

### Approach 2: Custom URL Drilldown (both vizs)

```javascript
if (drilldownUrl) {
    var url = drilldownUrl
        .replace('$icon$', encodeURIComponent(iconName))
        .replace('$label$', encodeURIComponent(labelText))
        .replace('$color$', encodeURIComponent(iconColor));
    if (drilldownNewTab === 'yes') {
        window.open(url, '_blank');
    } else {
        window.location.href = url;
    }
}
```

### Critical: Cursor Feedback

When drilldown is enabled, always set cursor to pointer:
```javascript
if (this._drilldownEnabled) {
    this.el.style.cursor = 'pointer';
    this.canvas.style.cursor = 'pointer';
}
```

### Wrap in try/catch for Harness

The test harness doesn't have the Splunk drilldown infrastructure:
```javascript
try {
    self.drilldown({ action: SplunkVisualizationBase.FIELD_VALUE_DRILLDOWN, data: data }, event);
} catch (e) { /* test harness */ }
```

### Lesson

> Always support both native Splunk drilldown and custom URL drilldown. Wrap `self.drilldown()` in try/catch. Set cursor to pointer when drilldown is enabled.

---

## 11. AppInspect — Failure Catalog

Every issue below was a real failure or warning during Splunk Cloud vetting.

### Blocking Failures

| Issue | Fix |
|-------|-----|
| Nested archives in `dist/` | Remove old `.tar.gz` files from app directory before packaging |
| Missing global write access in `default.meta` | Add `[] access = read : [ * ], write : [ sc_admin ]` |
| No `[id]` section in `app.conf` | Add `[id]` stanza with `name = {app_id}` |
| `.DS_Store` / `._*` macOS artifacts | `find . -name '._*' -delete && find . -name '.DS_Store' -delete` |
| `local/` directory present | Never include `local/` in packages |

### Warnings (Non-blocking but Fix Anyway)

| Issue | Fix |
|-------|-----|
| `check_for_updates = true` for private app | Set to `false` in `[package]` |
| `is_configured = true` (non-standard) | Set to `0` (Splunk spec default) |
| Empty `README/` directory | Add `savedsearches.conf.spec` |
| Missing `[package]` stanza | Add it with `id = {app_name}` |

### Complete app.conf Template

```ini
[install]
is_configured = 0
build = 1

[id]
name = icon_library

[package]
id = icon_library
check_for_updates = false

[ui]
is_visible = true
label = Icon Library

[launcher]
author = Custom Viz
description = Description here
version = 1.3.1
```

### Complete default.meta Template

```ini
[]
access = read : [ * ], write : [ sc_admin ]
export = system

[views]
access = read : [ * ], write : [ sc_admin ]
export = system

[visualizations/icon_library]
export = system
```

### Packaging Command (macOS)

```bash
find app_dir -name '._*' -delete
find app_dir -name '.DS_Store' -delete
COPYFILE_DISABLE=1 tar czf app-1.0.0.tar.gz \
    --exclude='app_dir/.../node_modules' \
    --exclude='app_dir/.../src' \
    --exclude='app_dir/.../package.json' \
    --exclude='app_dir/.../package-lock.json' \
    --exclude='app_dir/.../webpack.config.js' \
    --exclude='app_dir/.../harness.json' \
    app_dir
```

### Lesson

> Always use `COPYFILE_DISABLE=1` on macOS. Always include `[id]` stanza. Always set `check_for_updates = false`. Always add `savedsearches.conf.spec`.

---

## 12. Dashboard Studio Type Format

### For Dashboard Studio JSON

```json
"type": "icon_library.icon_library"
```

Format: `{app_id}.{viz_name}`

### NEVER Use These

| Wrong | Why |
|-------|-----|
| `viz.custom.icon_library.icon_library` | Not a valid Dashboard Studio type prefix |
| `custom.visualizations.icon_library.icon_library` | Internal Splunk namespace |
| `splunk.custom.icon_library.icon_library` | `splunk.*` is for built-in viz types |
| `splunk.icon_library` | Only for built-in Splunk vizs |

### For savedsearches.conf

```ini
display.visualizations.custom.type = icon_library.icon_library
```

### Lesson

> Dashboard Studio uses `{app_id}.{viz_name}`. No `viz.custom.` prefix. No `display.visualizations.custom.` prefix.

---

## 13. MutationObserver — Hiding Splunk Placeholders

Splunk shows "no results" or empty placeholder overlays when a viz has no search attached. For vizs that should render without data (like a static icon), you need to hide these.

```javascript
initialize: function() {
    // ...
    var self = this;
    this._observer = new MutationObserver(function(mutations) {
        self._hideFrameworkPlaceholder();
    });
    this._observer.observe(this.el, { childList: true, subtree: true });
},

_hideFrameworkPlaceholder: function() {
    var nodes = this.el.querySelectorAll(
        '.viz-placeholder, .shared-viz-no-results, ' +
        '[data-test="viz-no-results"], .viz-controller-no-results'
    );
    for (var i = 0; i < nodes.length; i++) {
        nodes[i].style.display = 'none';
    }
},

destroy: function() {
    if (this._observer) this._observer.disconnect();
    SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
}
```

### Lesson

> Use MutationObserver to hide Splunk's placeholder nodes. Always disconnect in `destroy()`.

---

## 14. Reflow — Two Approaches

### Approach A: Invalidate (triggers full Splunk cycle)

```javascript
reflow: function() {
    this.invalidateUpdateView();
}
```

Triggers Splunk's `formatData` → `updateView` pipeline. Correct but can cause brief flicker if formatData re-processes.

### Approach B: Direct re-render (icon_library)

```javascript
reflow: function() {
    if (this._lastConfig) {
        this._render(this._lastData, this._lastConfig);
    }
}
```

Skips `formatData`, directly re-renders with cached data/config. Faster, no flicker, but requires caching `_lastData` and `_lastConfig` in `updateView`.

### Lesson

> For simple vizs, direct re-render is smoother. For vizs where data changes frequently, use `invalidateUpdateView()`.

---

## 15. Canvas Effects Stacking Order

From infographic_shapes, the correct paint order for complex effects:

1. **Set globalAlpha** (panel opacity × animation pulse)
2. **Apply transforms** (rotation + animation spin/breathe + flip)
3. **Drop shadow** — multi-pass with `shadowSpread`: loop, set `shadowColor/Blur/Offset`, fill with `rgba(0,0,0,0.01)` (near-transparent fill to multiply shadow draws)
4. **Glow** — multi-pass with `glowIntensity`: loop, set `shadowColor/Blur`, fill with `glowColor` (actual fill, not transparent)
5. **Main fill** — solid color or gradient
6. **Background image** — async loaded, clipped to shape
7. **Progress bar** — clipped fill or radial wedge
8. **Inner shadow** — clip to shape, `globalCompositeOperation = 'destination-atop'`, large fillRect with shadow settings (inset shadow trick)
9. **Pattern overlay** — recreate path, `clip()`, `globalAlpha = 0.38`, fill with `ctx.createPattern()`
10. **Stroke** — color, width, dash pattern
11. **Text** — `strokeText` then `fillText` for outline effect
12. **Reflection** — translate/scale -1 vertically, repaint fill-only mirrored shape, `destination-out` + vertical gradient to fade

### Key Insight: Multi-Pass Shadows/Glows

Splunk's Canvas context doesn't support blur filters directly. The trick is to draw the same path multiple times with `shadowBlur` set, accumulating the effect:

```javascript
for (var sp = 0; sp < shadowPasses; sp++) {
    ctx.save();
    ctx.shadowColor = hexToRgba(shadowColor, shadowOpacity);
    ctx.shadowBlur = shadowBlur;
    ctx.shadowOffsetX = shadowX;
    ctx.shadowOffsetY = shadowY;
    createShapePath(ctx, shape, sx, sy, sw, sh, opts);
    ctx.fillStyle = 'rgba(0,0,0,0.01)';
    ctx.fill();
    ctx.restore();
}
```

### Always Reset Shadow State

```javascript
ctx.shadowBlur = 0;
ctx.shadowColor = 'transparent';
ctx.shadowOffsetX = 0;
ctx.shadowOffsetY = 0;
```

Canvas shadow state **leaks** into subsequent draw calls if not explicitly reset.

### Lesson

> Canvas effects require careful ordering and state management. Always save/restore context. Always reset shadow state. Multi-pass drawing is the only way to control shadow/glow intensity.

---

## 16. Animation on Canvas

```javascript
initialize: function() {
    this._animPhase = 0;
    this._animTimer = null;
},

updateView: function(data, config) {
    var animType = getOption(config, ns, 'animation', 'none');
    if (animType !== 'none' && !this._animTimer) {
        var self = this;
        this._animTimer = setInterval(function() {
            self._animPhase += 0.05; // speed increment
            self.invalidateUpdateView();
        }, 33); // ~30fps
    } else if (animType === 'none' && this._animTimer) {
        clearInterval(this._animTimer);
        this._animTimer = null;
        this._animPhase = 0;
    }
},

destroy: function() {
    if (this._animTimer) {
        clearInterval(this._animTimer);
        this._animTimer = null;
    }
}
```

### Animation Types

| Type | Implementation |
|------|---------------|
| `pulse` | Modulate `globalAlpha` with `0.5 + 0.5 * Math.sin(phase)` |
| `glow_pulse` | Modulate `shadowBlur` multiplier |
| `breathe` | Small `scale()` around center: `1 + 0.03 * Math.sin(phase)` |
| `spin` | Add continuous degrees to rotation transform |

### Lesson

> Always guard against creating duplicate timers. Always clear timers in `destroy()`. Use `invalidateUpdateView()` to trigger redraws from timers.

---

## 17. Data Contract and formatData

### Keep formatData Lightweight

```javascript
formatData: function(data, config) {
    if (!data || !data.rows || data.rows.length === 0) {
        if (this._lastGoodData) return this._lastGoodData;
        throw new SplunkVisualizationBase.VisualizationError(
            'Awaiting data — Icon Library'
        );
    }
    var fields = data.fields;
    var colIdx = {};
    for (var i = 0; i < fields.length; i++) {
        colIdx[fields[i].name] = i;
    }
    var result = { colIdx: colIdx, rows: data.rows };
    this._lastGoodData = result;
    return result;
}
```

### Critical Rules

1. **Never read `config` in `formatData`** — causes caching/timing issues
2. **Always cache last good data** — prevents flashing during real-time search gaps
3. **Use `VisualizationError` for first-time empty data** — only way to show message in Dashboard Studio v2
4. **Read last row for latest-value vizs** — `data.rows[data.rows.length - 1]`
5. **Field extraction happens in `updateView`**, not `formatData`

### Lesson

> `formatData` is a data passthrough. All config reading and field extraction belongs in `updateView`.

---

## 18. Test Harness Gotchas

### TypeError: Cannot read properties of undefined (reading 'mode')

This error occurs when the test harness tries to call `formatData` before the visualization is fully initialized. Fix: guard `formatData` against missing data gracefully.

### Namespace is Empty String

In the test harness, `getPropertyNamespaceInfo()` may throw or return undefined. Use the `getNS()` wrapper:

```javascript
function getNS(viz) {
    try {
        var info = viz.getPropertyNamespaceInfo();
        if (info && info.propertyNamespace) return info.propertyNamespace;
    } catch (e) {}
    return '';
}
```

### Drilldown Not Available

`self.drilldown()` throws in the test harness. Wrap in try/catch:

```javascript
try {
    self.drilldown({ action: SplunkVisualizationBase.FIELD_VALUE_DRILLDOWN, data: d }, event);
} catch (e) { /* harness */ }
```

### Lesson

> Test harness lacks full Splunk infrastructure. Guard namespace, drilldown, and formatData with try/catch and fallback values.

---

## 19. Packaging — What to Exclude

### Always Exclude from Tarball

| Path | Why |
|------|-----|
| `node_modules/` | Dev dependency, huge, not needed at runtime |
| `src/` | Source code — only the webpack bundle is needed |
| `package.json` | npm metadata, not needed at runtime |
| `package-lock.json` | npm lock, not needed at runtime |
| `webpack.config.js` | Build config, not needed at runtime |
| `harness.json` | Test harness config |
| `.gitignore` | Git metadata |
| `fonts/` (if using Architecture B) | Build-time only; base64 is in CSS |
| `_generate_*.py` | Build scripts |
| `dist/` (nested) | Previous builds — causes "nested archives" AppInspect failure |
| `._*`, `.DS_Store` | macOS artifacts — AppInspect failure |

### Files That MUST Ship

| File | Purpose |
|------|---------|
| `visualization.js` | The webpack bundle |
| `visualization.css` | Styles + base64 fonts |
| `formatter.html` | Dashboard Studio settings UI |
| `default/visualizations.conf` | Viz registration |
| `default/app.conf` | App metadata |
| `metadata/default.meta` | Permissions |
| `README/savedsearches.conf.spec` | btool compliance |

### Lesson

> Be explicit with `--exclude` in `tar`. Verify the package contents with `tar tzf` after creation.

---

## 20. Skill Gaps — What the Existing Skill Gets Wrong

Issues found by comparing the `splunk-viz` SKILL.md against real-world experience:

### 1. Webpack Config Missing ES5 Target

The skill's webpack template is:
```javascript
module.exports = {
    entry: './src/visualization_source.js',
    output: { filename: 'visualization.js', libraryTarget: 'amd' },
    externals: ['api/SplunkVisualizationBase', 'api/SplunkVisualizationUtils']
};
```

**Missing:** `target: ['web', 'es5']` and `output.environment` flags. This causes ES6 output that silently breaks in Splunk.

### 2. app.conf Missing `[id]` Stanza

The skill generates four stanzas (`[install]`, `[package]`, `[ui]`, `[launcher]`). AppInspect requires a fifth: `[id]` with `name = {app_id}`.

### 3. app.conf Uses `is_configured = true`

Splunk's spec says `is_configured` should be `0` (not configured) or `1`. The string `true` works but is non-standard.

### 4. `SplunkVisualizationUtils` Externalized But Often Unused

The skill externals both `SplunkVisualizationBase` and `SplunkVisualizationUtils`. If the viz doesn't use Utils, this wastes an AMD slot and webpack emits a warning. Only externalize what you actually import.

### 5. Font Loading Via `document.fonts.ready`

The skill uses:
```javascript
document.fonts.ready.then(function() {
    self._fontReady = true;
    self.invalidateUpdateView();
});
```

This is insufficient. `document.fonts.ready` resolves when **all currently loading fonts** finish, but doesn't guarantee your specific font is ready. Use `document.fonts.load('400 48px "FontName"')` to explicitly request your font, plus a poll loop as safety net.

### 6. Missing `getNS()` Safety Wrapper

The skill uses `this.getPropertyNamespaceInfo().propertyNamespace` directly. This throws in test harness environments. Wrap in try/catch.

### 7. Missing `getOption()` Helper

The skill uses `config[ns + 'key'] || 'default'` directly. This fails when Dashboard Studio passes short keys without the namespace prefix.

### 8. Missing MutationObserver Pattern

The skill doesn't document how to hide Splunk's "no results" placeholder for vizs that should render without data.

### 9. Missing `check_for_updates = false`

The skill doesn't set this in `[package]`. AppInspect warns for private apps.

### 10. No Mention of `backgroundColor: transparent` Panel Issue

The skill documents transparent CSS background but not the Dashboard Studio panel-level `backgroundColor` option that must be set in JSON.

### 11. `formatData` Return `false` Contradiction

Rule 20 says to throw `VisualizationError` (correct), but the "CORRECT" snippet in rule 21 returns `false` for empty rows, which causes Dashboard Studio to show a grey bar chart placeholder.

### Lesson

> The skill is a solid foundation but needs updates based on these real-world findings. Every gap above was discovered by shipping vizs to Splunk Cloud.

---

## Appendix A: File Map (icon_library)

```
icon_library/
├── README.md
├── _generate_showcase.py                    (build-time only, excluded from package)
├── default/
│   ├── app.conf                             (5 stanzas: install, id, package, ui, launcher)
│   ├── visualizations.conf                  ([icon_library] stanza)
│   └── data/ui/views/
│       ├── readme.xml                       (in-app documentation dashboard)
│       └── showcase.xml                     (256-icon demo dashboard)
├── metadata/
│   └── default.meta                         (sc_admin write, system export)
├── README/
│   └── savedsearches.conf.spec              (full namespace for all custom settings)
└── appserver/static/visualizations/icon_library/
    ├── src/
    │   └── visualization_source.js          (source — not shipped)
    ├── visualization.js                     (webpack bundle — shipped)
    ├── visualization.css                    (base64 Material Symbols font + container)
    ├── formatter.html                       (3 sections: Data config, Display, Color)
    ├── webpack.config.js                    (ES5 target — not shipped)
    ├── package.json                         (npm — not shipped)
    └── .gitignore                           (excludes node_modules)
```

## Appendix B: File Map (infographic_shapes)

```
infographic_shapes/
├── README.md
├── default/
│   ├── app.conf
│   ├── visualizations.conf
│   └── data/ui/views/
│       └── showcase.xml                     (comprehensive settings demo)
├── metadata/
│   └── default.meta
├── README/
│   └── savedsearches.conf.spec
└── appserver/static/visualizations/infographic_shapes/
    ├── src/
    │   └── visualization_source.js          (1660 lines — shapes, effects, animation)
    ├── visualization.js                     (webpack bundle)
    ├── visualization.css                    (base64 fonts: 12+ families, ~400KB+)
    ├── formatter.html                       (6 sections — complex settings UI)
    ├── fonts/
    │   ├── fonts.css                        (font-face declarations for dev)
    │   ├── download-fonts.sh                (fetch new fonts from Google Fonts)
    │   ├── inter.woff2, oswald.woff2, ...   (binary font files for base64 conversion)
    ├── webpack.config.js
    ├── package.json
    └── .gitignore
```

## Appendix C: Quick Checklist for New Custom Vizs

- [ ] Webpack has `target: ['web', 'es5']` and all `output.environment` flags
- [ ] `app.conf` has all 5 stanzas (`install`, `id`, `package`, `ui`, `launcher`)
- [ ] `app.conf` has `is_configured = 0`, `check_for_updates = false`
- [ ] `default.meta` uses `sc_admin` (for Cloud) and exports `[visualizations/{name}]`
- [ ] `savedsearches.conf.spec` documents every custom setting
- [ ] `formatter.html` uses exact standard section labels (lowercase, plural)
- [ ] `formatter.html` has `help="..."` on every control group
- [ ] `visualization.css` uses base64 data URIs for fonts (no URL paths)
- [ ] `visualization_source.js` uses `getOption()` helper for all config reads
- [ ] `visualization_source.js` uses `getNS()` wrapper for namespace
- [ ] `visualization_source.js` handles HiDPI with `devicePixelRatio`
- [ ] `visualization_source.js` waits for font readiness before Canvas text
- [ ] `visualization_source.js` caches last good data in `formatData`
- [ ] `visualization_source.js` handles `data = false` in `updateView`
- [ ] `visualization_source.js` wraps `drilldown()` in try/catch
- [ ] Bundle verified: starts with `define([...], function(` (not arrow)
- [ ] Package excludes: `node_modules`, `src`, `package.json`, webpack config, `._*`, `.DS_Store`
- [ ] Documentation mentions `"backgroundColor": "transparent"` for Dashboard Studio panels
- [ ] MutationObserver hides Splunk placeholders (if viz renders without data)
- [ ] All animations cleared in `destroy()`
