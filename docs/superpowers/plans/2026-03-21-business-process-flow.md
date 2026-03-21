# Business Process Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an interactive business process flow visualization for Splunk where users can arrange nodes with live data, connect them with editable lines, and persist the layout.

**Architecture:** Canvas 2D rendering in an AMD module extending SplunkVisualizationBase. Nodes render from search data (label + value + optional sparkline). Connections come from step/connects_to columns or manual drawing. All editor state (positions, connections, formatting) stored as JSON in a single viz config setting. Edit mode activated via formatter toggle, view mode controlled by lock state.

**Tech Stack:** ES5 JavaScript, Canvas 2D API, Splunk Visualization Framework (AMD/RequireJS), webpack 5

**Spec:** `docs/superpowers/specs/2026-03-21-business-process-flow-design.md`

---

## File Structure

```
examples/business_process_flow/
  README.md
  default/
    app.conf
    visualizations.conf
    savedsearches.conf
  metadata/
    default.meta
  README/
    savedsearches.conf.spec
  appserver/
    static/
      visualizations/
        business_process_flow/
          src/
            visualization_source.js    # Main viz (~1500-2000 lines)
          formatter.html
          visualization.css
          webpack.config.js
          package.json
          .gitignore
```

Single JS file following the established project pattern (process_mining is ~2500 lines in one file). The viz has these logical sections within visualization_source.js:

1. **Helper functions** (pure, no `this`) — color math, formatCount, drawing primitives, hit testing
2. **Data processing** — parse rows, build node/connection model
3. **Rendering** — draw nodes, connections, sparklines, toolbar, popups
4. **Interaction** — mouse handlers for drag, connect, resize, edit
5. **Lifecycle** — initialize, formatData, updateView, reflow, destroy

---

## Task 1: App Scaffolding

**Files:**
- Create: `examples/business_process_flow/default/app.conf`
- Create: `examples/business_process_flow/default/visualizations.conf`
- Create: `examples/business_process_flow/default/savedsearches.conf`
- Create: `examples/business_process_flow/metadata/default.meta`
- Create: `examples/business_process_flow/README/savedsearches.conf.spec`
- Create: `examples/business_process_flow/appserver/static/visualizations/business_process_flow/visualization.css`
- Create: `examples/business_process_flow/appserver/static/visualizations/business_process_flow/webpack.config.js`
- Create: `examples/business_process_flow/appserver/static/visualizations/business_process_flow/package.json`
- Create: `examples/business_process_flow/appserver/static/visualizations/business_process_flow/.gitignore`
- Create: `examples/business_process_flow/README.md`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p examples/business_process_flow/default
mkdir -p examples/business_process_flow/metadata
mkdir -p examples/business_process_flow/README
mkdir -p examples/business_process_flow/appserver/static/visualizations/business_process_flow/src
```

- [ ] **Step 2: Create app.conf**

```ini
[install]
is_configured = true
build = 1

[package]
id = business_process_flow

[ui]
is_visible = true
label = Business Process Flow

[launcher]
author = joehanse
description = Interactive business process flow visualization with editable nodes and connections
version = 1.0.0
```

- [ ] **Step 3: Create visualizations.conf**

```ini
[business_process_flow]
label = Business Process Flow
description = Interactive business process flow visualization with editable nodes and connections
default_height = 600
allow_user_selection = true
disabled = 0
search_fragment = | stats count by sourcetype | eval step=1 | table sourcetype count step
```

- [ ] **Step 4: Create metadata/default.meta**

```ini
[]
access = read : [ * ], write : [ admin ]

[visualizations/business_process_flow]
export = system
```

- [ ] **Step 5: Create savedsearches.conf with demo search**

Demo search generates synthetic business process data with sourcetypes, counts, and step ordering. Include all `display.visualizations.custom.*` settings with defaults matching formatter.html.

- [ ] **Step 6: Create savedsearches.conf.spec**

Document every custom setting: labelField, valueField, subtitleField, palette, accentLine, sparklineType, editMode, editorState, lock.

- [ ] **Step 7: Create visualization.css**

```css
.business-process-flow-viz {
    background: transparent;
}
```

- [ ] **Step 8: Create webpack.config.js**

Standard webpack config: entry `./src/visualization_source.js`, output `visualization.js`, AMD library target, externals for SplunkVisualizationBase and SplunkVisualizationUtils.

- [ ] **Step 9: Create package.json**

Name: `business-process-flow-viz`, scripts: build (webpack --mode production), dev (webpack --mode development --watch), devDependencies: webpack ^5.90.0, webpack-cli ^5.1.4.

- [ ] **Step 10: Create .gitignore**

```
node_modules
```

- [ ] **Step 11: Create README.md**

Documentation with install instructions, required/optional columns, example SPL queries, configuration table, and build instructions.

- [ ] **Step 12: Commit scaffolding**

```bash
git add examples/business_process_flow/
git commit -m "feat: scaffold business_process_flow viz app"
```

---

## Task 2: Formatter HTML

**Files:**
- Create: `examples/business_process_flow/appserver/static/visualizations/business_process_flow/formatter.html`

- [ ] **Step 1: Create formatter.html with all sections**

Sections and settings:

**Fields section:**
- `labelField` — text input, default `sourcetype`
- `valueField` — text input, default `count`
- `subtitleField` — text input, default empty

**Appearance section:**
- `palette` — dropdown: corporate/security/nature/neon/mono, default `corporate`
- `accentLine` — radio: true/false, default `false`
- `sparklineType` — dropdown: line/area/bar/none, default `area`
- `nodeRadius` — text input, default `8` (border radius in px)

**Editor section:**
- `editMode` — radio: true/false, default `false`
- `lock` — radio: true/false, default `false`
- `editorState` — text area (hidden-ish, for JSON blob), default empty

- [ ] **Step 2: Commit formatter**

```bash
git add examples/business_process_flow/appserver/static/visualizations/business_process_flow/formatter.html
git commit -m "feat: add formatter.html with all settings"
```

---

## Task 3: Core Visualization — Data Processing & Basic Node Rendering

**Files:**
- Create: `examples/business_process_flow/appserver/static/visualizations/business_process_flow/src/visualization_source.js`

This is the largest task. Build the visualization in layers, starting with data processing and basic rendering.

- [ ] **Step 1: Write AMD module skeleton**

Set up the module with: initialize (create canvas, init state variables), getInitialDataParams (ROW_MAJOR, count 10000), formatData (validate data, build colIdx, cache rows), updateView (stub), reflow, destroy.

State variables to initialize:
```javascript
this._lastGoodData = null;
this._editorState = { nodes: {}, connections: [], lock: false };
this._isDragging = false;
this._dragNodeId = null;
this._dragStartX = 0;
this._dragStartY = 0;
this._isConnecting = false;
this._connectFromId = null;
this._isResizing = false;
this._resizeNodeId = null;
this._resizeHandle = null;
this._selectedConnection = null;
this._editMode = false;
this._hitNodes = [];
this._hitConnections = [];
this._hoverItem = null;
```

- [ ] **Step 2: Write helper functions**

Pure functions (no `this`):
- `formatCount(n)` — format large numbers (1.2K, 3.4M, etc.)
- `lerpColor(a, b, t)` — linear color interpolation
- `roundRect(ctx, x, y, w, h, r)` — rounded rectangle path
- `drawArrowhead(ctx, x, y, angle, size, color)` — arrowhead at line end
- `pointInRect(px, py, x, y, w, h)` — hit test for rectangles
- `pointInCircle(px, py, cx, cy, r)` — hit test for circles
- `pointInDiamond(px, py, cx, cy, w, h)` — hit test for diamonds
- `pointNearLine(px, py, x1, y1, x2, y2, threshold)` — proximity test for lines
- `pointNearBezier(px, py, x1, y1, cx, cy, x2, y2, threshold)` — proximity test for curves
- `getEdgeConnectionPoint(node, targetX, targetY)` — compute where a line exits a node shape
- `hexToRgba(hex, alpha)` — hex color to rgba string

Color palettes as a constant object:
```javascript
var PALETTES = {
    corporate: ['#3b82f6','#6366f1','#8b5cf6','#0ea5e9','#06b6d4','#14b8a6','#64748b','#475569'],
    security: ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#8b5cf6','#ec4899','#64748b'],
    nature: ['#059669','#16a34a','#65a30d','#ca8a04','#d97706','#0d9488','#78716c','#57534e'],
    neon: ['#00ff88','#00d4ff','#bf5af2','#ff375f','#ffd60a','#ff9f0a','#30d158','#5e5ce6'],
    mono: ['#f8fafc','#e2e8f0','#94a3b8','#64748b','#475569','#334155','#1e293b','#0f172a']
};
```

Theme color helper:
```javascript
function getThemeColors(isDark) {
    return {
        bg: isDark ? '#0f172a' : '#ffffff',
        nodeBg: isDark ? '#1e293b' : '#f1f5f9',
        nodeBorder: isDark ? '#334155' : '#e2e8f0',
        text: isDark ? '#f1f5f9' : '#1e293b',
        textMuted: isDark ? '#94a3b8' : '#64748b',
        lineBg: isDark ? '#475569' : '#94a3b8',
        toolbarBg: isDark ? '#1e293b' : '#f8fafc',
        toolbarBorder: isDark ? '#334155' : '#e2e8f0'
    };
}
```

- [ ] **Step 3: Implement formatData**

Parse search results into a node data model. Handle two data formats:

**Format A (stats/table — single row per node):**
Each row has label, value, optional step, optional connects_to. Build array of node objects.

**Format B (timechart — time series):**
First column is `_time`, remaining columns are series (one per node). Extract latest value and full time series for sparklines.

Detect format by checking if first field is `_time`. Return:
```javascript
{
    nodes: [{ id: 'syslog', label: 'syslog', value: 1234, step: 1, connectsTo: ['ids'], series: [10,20,30,...] }],
    isTimechart: true/false
}
```

Cache in `this._lastGoodData`. Throw VisualizationError if no data on first load.

- [ ] **Step 4: Implement updateView — config reading and canvas setup**

Read all config settings with defaults matching formatter.html:
- `labelField` || 'sourcetype'
- `valueField` || 'count'
- `subtitleField` || ''
- `palette` || 'corporate'
- `accentLine` === 'true'
- `sparklineType` || 'area'
- `editMode` === 'true'
- `editorState` — parse JSON, merge with existing state
- `lock` === 'true'

Set up canvas: HiDPI sizing, clear, detect theme via `getCurrentTheme()`.

- [ ] **Step 5: Implement node positioning logic**

Function `computeNodePositions(nodes, editorState, canvasW, canvasH)`:
- If editor state has saved positions for a node, use those
- Otherwise, auto-layout based on `step` column:
  - Group nodes by step value
  - Distribute steps horizontally across canvas
  - Stack nodes in same step vertically
  - Default node size: 180×120px
- Nodes without step: place in a grid below the main flow

- [ ] **Step 6: Implement connection building logic**

Function `buildConnections(nodes, editorState)`:
- From `step` column: connect step N → step N+1 (all-to-all for same step groups)
- From `connects_to` column: override auto-connections for that node
- From `editorState.connections`: add manual connections
- Each connection: `{ from, to, style, color, width, dash, arrow, label, manual }`
- Deduplicate (don't create auto-connection if manual one exists between same pair)

- [ ] **Step 7: Implement drawNode function**

`drawNode(ctx, node, theme, palette, accentLine, sparklineType, nodeRadius)`:
- Draw shape (rect/circle/diamond) with rounded corners for rect
- Accent line at top if enabled (node's palette color)
- Label text (small, muted, sans-serif)
- Value text (large, bold, monospace for numbers)
- Optional subtitle (small, muted)
- Optional delta indicator
- Optional sparkline at bottom (edge-to-edge)
- Selection highlight border when selected in edit mode
- Resize handles (small squares at corners) when in edit mode

- [ ] **Step 8: Implement drawSparkline function**

`drawSparkline(ctx, series, x, y, w, h, type, color)`:
- `line`: polyline of data points scaled to w×h
- `area`: same as line + filled area below with gradient
- `bar`: vertical bars for each data point
- Handle empty/null values gracefully
- No axis labels — just the shape

- [ ] **Step 9: Implement drawConnection function**

`drawConnection(ctx, fromNode, toNode, conn, theme)`:
- Compute start/end points using `getEdgeConnectionPoint`
- Draw straight line or quadratic bezier based on `conn.style`
- Apply color, width, dash pattern
- Draw arrowhead based on `conn.arrow` setting
- Draw label text at midpoint if `conn.label` exists
- Highlight when selected in edit mode

- [ ] **Step 10: Wire up updateView to draw everything**

Call sequence in updateView:
1. Compute node positions
2. Build connections
3. Clear canvas
4. Draw all connections (behind nodes)
5. Draw all nodes
6. Store hit rects for interactions
7. Draw toolbar if edit mode
8. Draw connection popup if a connection is selected

- [ ] **Step 11: Build and test basic rendering**

```bash
cd examples/business_process_flow/appserver/static/visualizations/business_process_flow
npm install && npm run build
```

Verify `visualization.js` is generated. Test in Splunk with a simple `| stats count by sourcetype | eval step=1 | table sourcetype count step` search.

- [ ] **Step 12: Commit core rendering**

```bash
git add examples/business_process_flow/appserver/static/visualizations/business_process_flow/src/visualization_source.js
git commit -m "feat: core data processing and node/connection rendering"
```

---

## Task 4: Edit Mode — Toolbar and Node Dragging

**Files:**
- Modify: `examples/business_process_flow/appserver/static/visualizations/business_process_flow/src/visualization_source.js`

- [ ] **Step 1: Implement drawToolbar function**

`drawToolbar(ctx, w, theme, editState)`:
- 36px tall bar at top of canvas
- Buttons with icons (text-based, no images):
  - Save (disk icon: "Save")
  - Lock toggle (shows locked/unlocked state)
  - Add Node (+)
  - Add Connection (→)
  - Delete (✕)
  - Fit to View (⊡)
- "EDIT MODE" label right-aligned
- Store button hit rects in `this._toolbarButtons`

- [ ] **Step 2: Implement mouse event handlers**

In `initialize`, add event listeners on canvas:

**mousedown:**
- Check toolbar button hits (if edit mode)
- Check node hits → start drag (if edit mode OR lock off in view mode)
- Check connection hits → select connection (if edit mode)

**mousemove:**
- If dragging: update node position, invalidateUpdateView
- If connecting: draw temporary line from source to cursor
- Update hover state, set cursor

**mouseup:**
- If dragging: stop drag. If edit mode, update editorState position.
  If view mode (lock off), snap back (don't persist).
- If connecting: check if cursor is over target node, create connection

**click:**
- Toolbar button actions (save, lock, add node, add connection, delete)

- [ ] **Step 3: Implement Save functionality**

On Save button click:
- Serialize editorState to JSON
- Call `this.drilldown()` with special payload? No — use a different approach:
- Write editorState JSON to a hidden formatter field via DOM manipulation:
  Find the formatter input for `editorState` and set its value, triggering Splunk's config save.

Alternative (simpler, used by process_mining): store positions in a `savedPositions` config setting. On save, construct the JSON and use:
```javascript
var ns = this.getPropertyNamespaceInfo().propertyNamespace;
// Splunk viz framework doesn't have a direct "save config" API.
// The process_mining viz stores positions in the config and relies on
// the formatter textarea being synced. Use the same pattern:
// Store in this._editorState, serialize to config via formatter binding.
```

Look at how process_mining handles `savedPositions` — it stores JSON in a text area formatter field. Follow same pattern.

- [ ] **Step 4: Implement Lock toggle**

Toggle `this._editorState.lock`. Update toolbar button appearance. In view mode mouse handlers, check lock state before allowing drag.

- [ ] **Step 5: Implement node drag with snap-back in view mode**

- Edit mode drag: update `editorState.nodes[id].x/y` — persisted on save
- View mode drag (lock off): temporarily move node, on mouseup reset to saved position
- View mode (lock on): no drag at all

- [ ] **Step 6: Build and test edit mode**

```bash
cd examples/business_process_flow/appserver/static/visualizations/business_process_flow
npm run build
```

Test in Splunk: toggle edit mode in formatter, verify toolbar appears, drag nodes, click save.

- [ ] **Step 7: Commit edit mode**

```bash
git add examples/business_process_flow/appserver/static/visualizations/business_process_flow/src/visualization_source.js
git commit -m "feat: edit mode toolbar with node dragging and save"
```

---

## Task 5: Edit Mode — Manual Connections, Node Creation, and Delete

**Files:**
- Modify: `examples/business_process_flow/appserver/static/visualizations/business_process_flow/src/visualization_source.js`

- [ ] **Step 1: Implement Add Connection flow**

When "Add Connection" toolbar button clicked:
- Set `this._isConnecting = true`
- Change cursor to crosshair
- On node click: if no source yet, set `_connectFromId`. If source set, create connection to clicked node.
- Draw temporary dashed line from source node to mouse cursor during connecting
- On Escape or right-click: cancel connecting mode
- New connection defaults: straight, palette color, width 2, solid, forward arrow, no label

- [ ] **Step 2: Implement Add Node flow**

When "Add Node" toolbar button clicked:
- Create a new manual node with generated ID (`manual_1`, `manual_2`, etc.)
- Default label "New Node", no value, placed at center of visible canvas
- Add to `editorState.nodes` with `manual: true`
- Trigger redraw
- User can then drag it into position and edit label via popup

- [ ] **Step 3: Implement Delete flow**

When "Delete" button clicked:
- If a connection is selected: remove it from `editorState.connections`
- If a manual node is selected: remove from `editorState.nodes` and all its connections
- Data-driven nodes cannot be deleted (they come from search)
- Trigger redraw

- [ ] **Step 4: Implement node property popup**

When double-clicking a node in edit mode:
- Show a simple popup (drawn on canvas) with:
  - Label (editable for manual nodes — use a temporary DOM input overlay)
  - Shape selector: rect/circle/diamond (clickable icons)
  - Color override (small color swatches from current palette)
- Close on click outside or Escape

- [ ] **Step 5: Implement node resizing**

In edit mode, draw small square handles at corners of selected/hovered node.
- mousedown on handle → start resize
- mousemove → update node width/height (min 80×60)
- mouseup → stop resize
- Store new size in editorState

- [ ] **Step 6: Implement connection formatting popup**

When clicking a connection in edit mode:
- Show popup (drawn on canvas) at click position:
  - Style toggle: straight / curved
  - Color swatches from current palette
  - Width: thin/medium/thick (1/2/4px)
  - Dash toggle: solid / dashed
  - Arrow: none / forward / backward / both
  - Label: text input (DOM overlay)
- Apply changes immediately, persist on save

- [ ] **Step 7: Implement Fit to View**

When "Fit to View" button clicked:
- Calculate bounding box of all nodes
- Scale and translate so all nodes fit within canvas with 40px padding
- Update all node positions in editorState proportionally

- [ ] **Step 8: Build and test all edit features**

```bash
cd examples/business_process_flow/appserver/static/visualizations/business_process_flow
npm run build
```

Test: add manual nodes, draw connections, delete connections, resize nodes, format lines, fit to view, save and reload.

- [ ] **Step 9: Commit edit features**

```bash
git add examples/business_process_flow/appserver/static/visualizations/business_process_flow/src/visualization_source.js
git commit -m "feat: manual connections, node creation, delete, resize, and formatting popups"
```

---

## Task 6: Light/Dark Mode and Color Palettes

**Files:**
- Modify: `examples/business_process_flow/appserver/static/visualizations/business_process_flow/src/visualization_source.js`

- [ ] **Step 1: Implement theme detection and color switching**

In updateView:
```javascript
var theme = SplunkVisualizationUtils.getCurrentTheme();
var isDark = (theme === 'dark');
var colors = getThemeColors(isDark);
```

Pass `colors` to all drawing functions. Ensure:
- Node background, border, text use theme colors
- Connection colors adjust for contrast
- Toolbar uses theme-appropriate background
- Popup backgrounds use theme colors
- Sparkline colors work on both backgrounds

- [ ] **Step 2: Implement palette color assignment**

In updateView, when processing nodes:
```javascript
var paletteColors = PALETTES[paletteName] || PALETTES.corporate;
for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    // Use editor override if set, otherwise auto-assign from palette
    node.color = editorState.nodes[node.id] && editorState.nodes[node.id].color
        ? editorState.nodes[node.id].color
        : paletteColors[i % paletteColors.length];
}
```

- [ ] **Step 3: Adjust monochrome palette for light mode**

Monochrome palette needs to be inverted for light mode (dark values on light background). Add logic:
```javascript
if (!isDark && paletteName === 'mono') {
    paletteColors = paletteColors.slice().reverse();
}
```

- [ ] **Step 4: Build and test both modes**

Test in Splunk with dashboard theme set to dark and light. Verify all elements are legible and palette colors work correctly.

- [ ] **Step 5: Commit theme support**

```bash
git add examples/business_process_flow/appserver/static/visualizations/business_process_flow/src/visualization_source.js
git commit -m "feat: light/dark mode support and color palette assignment"
```

---

## Task 7: Drilldown and View Mode Interactions

**Files:**
- Modify: `examples/business_process_flow/appserver/static/visualizations/business_process_flow/src/visualization_source.js`

- [ ] **Step 1: Implement drilldown on node click in view mode**

In click handler, when not in edit mode and click hits a node:
```javascript
var drilldownData = {};
drilldownData[self._drilldownField] = hitNode.label;
event.preventDefault();
self.drilldown({
    action: SplunkVisualizationBase.FIELD_VALUE_DRILLDOWN,
    data: drilldownData
}, event);
```

Add `drilldownField` to formatter (text input, default matches labelField).

- [ ] **Step 2: Implement hover tooltips in view mode**

On mousemove in view mode:
- If hovering a node: show tooltip with label, value, subtitle
- If hovering a connection with label: show label tooltip
- Draw tooltip on canvas (dark rounded rect with white text, like process_mining)

- [ ] **Step 3: Implement cursor feedback**

- View mode + lock off + over node: `grab` cursor
- View mode + lock off + dragging: `grabbing` cursor
- View mode + lock on + over node: `pointer` cursor (for drilldown)
- Edit mode + over node: `move` cursor
- Edit mode + over resize handle: `nwse-resize` / `nesw-resize` cursor
- Edit mode + connecting mode: `crosshair` cursor
- Edit mode + over connection: `pointer` cursor

- [ ] **Step 4: Build and test interactions**

```bash
cd examples/business_process_flow/appserver/static/visualizations/business_process_flow
npm run build
```

Test drilldown, tooltips, cursor changes in both view and edit modes.

- [ ] **Step 5: Commit interactions**

```bash
git add examples/business_process_flow/appserver/static/visualizations/business_process_flow/src/visualization_source.js
git commit -m "feat: drilldown, hover tooltips, and cursor feedback"
```

---

## Task 8: Final Polish and Build

**Files:**
- Modify: `examples/business_process_flow/README.md` (add drilldown section)
- All files verified for completeness

- [ ] **Step 1: Update README with drilldown documentation**

Add Drilldown section explaining token format and example search.

- [ ] **Step 2: Verify all formatter defaults match JS defaults**

Cross-check every setting in formatter.html against the `||` fallbacks in updateView. They must be identical.

- [ ] **Step 3: Verify savedsearches.conf.spec covers all settings**

Every setting in formatter.html must appear in the spec file.

- [ ] **Step 4: Full build and test**

```bash
./build.sh business_process_flow
```

Verify tarball is created in `dist/`. Install in Splunk, test end-to-end:
- Simple stats search → nodes appear with auto-layout
- Timechart search → sparklines appear in nodes
- Edit mode → drag, connect, resize, format, save
- Reload dashboard → layout persists
- Lock on → view mode is non-interactive
- Lock off → view mode allows dragging (no persist)
- Light and dark mode
- All 5 palettes
- Drilldown works

- [ ] **Step 5: Commit final polish**

```bash
git add examples/business_process_flow/
git commit -m "feat: complete business_process_flow visualization v1"
```
