# Process Mining Visualization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Splunk custom visualization that renders process mining directed graphs from raw event sequences on Canvas 2D.

**Architecture:** Single AMD module (`visualization_source.js`) that receives rows of `(case_id, activity, _time, status, resource)`, computes transitions in `updateView`, runs a Sugiyama-inspired layered layout algorithm, and renders an interactive directed graph with zoom/pan, tooltips, drilldown, and optional KPI header. All pure Canvas 2D, ES5, no external dependencies.

**Tech Stack:** Splunk Visualization Framework, Canvas 2D, webpack 5, ES5 JavaScript

**Spec:** `docs/superpowers/specs/2026-03-20-process-mining-viz-design.md`

---

## File Structure

```
examples/process_mining/
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
        process_mining/
          src/
            visualization_source.js    (~900 lines — all viz logic)
          formatter.html
          visualization.css
          webpack.config.js
          package.json
          .gitignore
```

Single JS file. The visualization_source.js is organized into sections:
1. Helper functions (pure, no `this`) — data processing, layout algorithm, drawing primitives
2. Visualization class — lifecycle methods only

---

### Task 1: Scaffold the Splunk app

**Files:**
- Create: `examples/process_mining/default/app.conf`
- Create: `examples/process_mining/default/visualizations.conf`
- Create: `examples/process_mining/default/savedsearches.conf`
- Create: `examples/process_mining/metadata/default.meta`
- Create: `examples/process_mining/README/savedsearches.conf.spec`
- Create: `examples/process_mining/appserver/static/visualizations/process_mining/visualization.css`
- Create: `examples/process_mining/appserver/static/visualizations/process_mining/webpack.config.js`
- Create: `examples/process_mining/appserver/static/visualizations/process_mining/package.json`
- Create: `examples/process_mining/appserver/static/visualizations/process_mining/.gitignore`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p examples/process_mining/default
mkdir -p examples/process_mining/metadata
mkdir -p examples/process_mining/README
mkdir -p examples/process_mining/appserver/static/visualizations/process_mining/src
```

- [ ] **Step 2: Create app.conf**

```ini
[install]
is_configured = true
build = 1

[package]
id = process_mining

[ui]
is_visible = true
label = Process Mining

[launcher]
author = joehanse
description = Process mining directed graph visualization from raw event sequences
version = 1.0.0
```

- [ ] **Step 3: Create visualizations.conf**

```ini
[process_mining]
label = Process Mining
description = Process mining directed graph from event sequences
default_height = 600
allow_user_selection = true
disabled = 0
search_fragment = | table _time case_id activity status resource
```

- [ ] **Step 4: Create savedsearches.conf**

```ini
[Process Mining - Demo]
search = | makeresults count=1 \
| eval case_id="case-001", activity="Order Received", status="success", resource="web-server-01" \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+1m"), case_id="case-001", activity="Payment Check", status="success", resource="payment-svc"] \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+2m"), case_id="case-001", activity="Inventory Check", status="success", resource="inventory-svc"] \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+4m"), case_id="case-001", activity="Ship Order", status="success", resource="warehouse-01"] \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+5m"), case_id="case-001", activity="Confirm Delivery", status="success", resource="logistics-svc"] \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+0s"), case_id="case-002", activity="Order Received", status="success", resource="web-server-02"] \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+1m"), case_id="case-002", activity="Payment Check", status="error", resource="payment-svc"] \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+3m"), case_id="case-002", activity="Payment Check", status="success", resource="payment-svc"] \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+4m"), case_id="case-002", activity="Inventory Check", status="success", resource="inventory-svc"] \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+6m"), case_id="case-002", activity="Ship Order", status="success", resource="warehouse-02"] \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+7m"), case_id="case-002", activity="Confirm Delivery", status="success", resource="logistics-svc"] \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+0s"), case_id="case-003", activity="Order Received", status="success", resource="web-server-01"] \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+2m"), case_id="case-003", activity="Payment Check", status="success", resource="payment-svc"] \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+3m"), case_id="case-003", activity="Inventory Check", status="error", resource="inventory-svc"] \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+5m"), case_id="case-003", activity="Inventory Check", status="success", resource="inventory-svc"] \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+7m"), case_id="case-003", activity="Ship Order", status="success", resource="warehouse-01"] \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+8m"), case_id="case-003", activity="Confirm Delivery", status="success", resource="logistics-svc"] \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+0s"), case_id="case-004", activity="Order Received", status="success", resource="web-server-02"] \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+1m"), case_id="case-004", activity="Payment Check", status="success", resource="payment-svc"] \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+3m"), case_id="case-004", activity="Ship Order", status="success", resource="warehouse-01"] \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+4m"), case_id="case-004", activity="Confirm Delivery", status="success", resource="logistics-svc"] \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+0s"), case_id="case-005", activity="Order Received", status="pending", resource="web-server-01"] \
| append [| makeresults count=1 | eval _time=relative_time(now(), "+2m"), case_id="case-005", activity="Payment Check", status="error", resource="payment-svc"] \
| table _time case_id activity status resource
dispatch.earliest_time = -60m
dispatch.latest_time = now
display.general.type = visualizations
display.visualizations.type = custom
display.visualizations.custom.type = process_mining.process_mining
display.visualizations.custom.process_mining.process_mining.caseField = case_id
display.visualizations.custom.process_mining.process_mining.activityField = activity
display.visualizations.custom.process_mining.process_mining.timeField = _time
display.visualizations.custom.process_mining.process_mining.statusField = status
display.visualizations.custom.process_mining.process_mining.resourceField = resource
display.visualizations.custom.process_mining.process_mining.layoutDirection = top-down
display.visualizations.custom.process_mining.process_mining.nodeColor = #607d8b
display.visualizations.custom.process_mining.process_mining.edgeColor = #90a4ae
display.visualizations.custom.process_mining.process_mining.successColor = #4caf50
display.visualizations.custom.process_mining.process_mining.errorColor = #f44336
display.visualizations.custom.process_mining.process_mining.showKPIs = true
display.visualizations.custom.process_mining.process_mining.kpiColor = #00bcd4
display.visualizations.custom.process_mining.process_mining.showEdgeLabels = true
display.visualizations.custom.process_mining.process_mining.showNodeCounts = true
display.visualizations.custom.process_mining.process_mining.drilldownField = activity
```

- [ ] **Step 5: Create savedsearches.conf.spec**

```
display.visualizations.custom.process_mining.process_mining.caseField = <string>
display.visualizations.custom.process_mining.process_mining.activityField = <string>
display.visualizations.custom.process_mining.process_mining.timeField = <string>
display.visualizations.custom.process_mining.process_mining.statusField = <string>
display.visualizations.custom.process_mining.process_mining.resourceField = <string>
display.visualizations.custom.process_mining.process_mining.layoutDirection = <string>
display.visualizations.custom.process_mining.process_mining.nodeColor = <string>
display.visualizations.custom.process_mining.process_mining.edgeColor = <string>
display.visualizations.custom.process_mining.process_mining.successColor = <string>
display.visualizations.custom.process_mining.process_mining.errorColor = <string>
display.visualizations.custom.process_mining.process_mining.showKPIs = <boolean>
display.visualizations.custom.process_mining.process_mining.kpiColor = <string>
display.visualizations.custom.process_mining.process_mining.showEdgeLabels = <boolean>
display.visualizations.custom.process_mining.process_mining.showNodeCounts = <boolean>
display.visualizations.custom.process_mining.process_mining.drilldownField = <string>
```

- [ ] **Step 6: Create default.meta**

```ini
[]
access = read : [ * ], write : [ admin ]

[visualizations/process_mining]
export = system
```

- [ ] **Step 7: Create visualization.css**

```css
.process-mining-viz {
    background: transparent;
}
```

- [ ] **Step 8: Create webpack.config.js**

```javascript
var path = require('path');

module.exports = {
    entry: './src/visualization_source.js',
    output: {
        filename: 'visualization.js',
        path: path.resolve(__dirname),
        libraryTarget: 'amd'
    },
    externals: [
        'api/SplunkVisualizationBase',
        'api/SplunkVisualizationUtils'
    ]
};
```

- [ ] **Step 9: Create package.json**

```json
{
  "name": "process-mining-viz",
  "version": "1.0.0",
  "description": "Process mining directed graph visualization",
  "scripts": {
    "build": "webpack --mode production",
    "dev": "webpack --mode development --watch"
  },
  "devDependencies": {
    "webpack": "^5.90.0",
    "webpack-cli": "^5.1.4"
  }
}
```

- [ ] **Step 10: Create .gitignore**

```
node_modules
```

- [ ] **Step 11: Commit scaffold**

```bash
git add examples/process_mining/
git commit -m "feat: scaffold process_mining viz app"
```

---

### Task 2: Create formatter.html

**Files:**
- Create: `examples/process_mining/appserver/static/visualizations/process_mining/formatter.html`

- [ ] **Step 1: Create formatter.html with all 6 tabs**

```html
<form class="splunk-formatter-section" section-label="Fields">

    <splunk-control-group label="Case ID Field" help="Column that groups events into a process flow">
        <splunk-text-input name="{{VIZ_NAMESPACE}}.caseField" value="case_id">
        </splunk-text-input>
    </splunk-control-group>

    <splunk-control-group label="Activity Field" help="Column with the activity/step name">
        <splunk-text-input name="{{VIZ_NAMESPACE}}.activityField" value="activity">
        </splunk-text-input>
    </splunk-control-group>

    <splunk-control-group label="Time Field" help="Column with the event timestamp">
        <splunk-text-input name="{{VIZ_NAMESPACE}}.timeField" value="_time">
        </splunk-text-input>
    </splunk-control-group>

    <splunk-control-group label="Status Field" help="Column for node color-coding (optional)">
        <splunk-text-input name="{{VIZ_NAMESPACE}}.statusField" value="status">
        </splunk-text-input>
    </splunk-control-group>

    <splunk-control-group label="Resource Field" help="Column for resource info in tooltips (optional)">
        <splunk-text-input name="{{VIZ_NAMESPACE}}.resourceField" value="resource">
        </splunk-text-input>
    </splunk-control-group>

</form>

<form class="splunk-formatter-section" section-label="Layout">

    <splunk-control-group label="Direction" help="Graph flow direction">
        <splunk-radio-input name="{{VIZ_NAMESPACE}}.layoutDirection" value="top-down">
            <option value="top-down">Top → Down</option>
            <option value="left-right">Left → Right</option>
        </splunk-radio-input>
    </splunk-control-group>

</form>

<form class="splunk-formatter-section" section-label="Appearance">

    <splunk-control-group label="Node Color" help="Default node fill color">
        <splunk-color-picker name="{{VIZ_NAMESPACE}}.nodeColor" value="#607d8b">
        </splunk-color-picker>
    </splunk-control-group>

    <splunk-control-group label="Edge Color" help="Edge line color">
        <splunk-color-picker name="{{VIZ_NAMESPACE}}.edgeColor" value="#90a4ae">
        </splunk-color-picker>
    </splunk-control-group>

    <splunk-control-group label="Success Color" help="Node color for success status">
        <splunk-color-picker name="{{VIZ_NAMESPACE}}.successColor" value="#4caf50">
        </splunk-color-picker>
    </splunk-control-group>

    <splunk-control-group label="Error Color" help="Node color for error status">
        <splunk-color-picker name="{{VIZ_NAMESPACE}}.errorColor" value="#f44336">
        </splunk-color-picker>
    </splunk-control-group>

</form>

<form class="splunk-formatter-section" section-label="KPIs">

    <splunk-control-group label="Show KPIs" help="Display summary metrics above the graph">
        <splunk-radio-input name="{{VIZ_NAMESPACE}}.showKPIs" value="true">
            <option value="true">Yes</option>
            <option value="false">No</option>
        </splunk-radio-input>
    </splunk-control-group>

    <splunk-control-group label="KPI Color" help="Color for KPI values">
        <splunk-color-picker name="{{VIZ_NAMESPACE}}.kpiColor" value="#00bcd4">
        </splunk-color-picker>
    </splunk-control-group>

</form>

<form class="splunk-formatter-section" section-label="Labels">

    <splunk-control-group label="Edge Labels" help="Show transition counts on edges">
        <splunk-radio-input name="{{VIZ_NAMESPACE}}.showEdgeLabels" value="true">
            <option value="true">Yes</option>
            <option value="false">No</option>
        </splunk-radio-input>
    </splunk-control-group>

    <splunk-control-group label="Node Counts" help="Show event counts on nodes">
        <splunk-radio-input name="{{VIZ_NAMESPACE}}.showNodeCounts" value="true">
            <option value="true">Yes</option>
            <option value="false">No</option>
        </splunk-radio-input>
    </splunk-control-group>

</form>

<form class="splunk-formatter-section" section-label="Drilldown">

    <splunk-control-group label="Drilldown Field" help="Field name sent on node click">
        <splunk-text-input name="{{VIZ_NAMESPACE}}.drilldownField" value="activity">
        </splunk-text-input>
    </splunk-control-group>

</form>
```

- [ ] **Step 2: Commit formatter**

```bash
git add examples/process_mining/appserver/static/visualizations/process_mining/formatter.html
git commit -m "feat: add process_mining formatter.html with 6 tabs"
```

---

### Task 3: Write visualization_source.js — Data processing helpers

**Files:**
- Create: `examples/process_mining/appserver/static/visualizations/process_mining/src/visualization_source.js`

This task creates the file with the AMD wrapper, all data processing helper functions, and a stub visualization class. Later tasks fill in the layout, rendering, and interaction code.

- [ ] **Step 1: Write the data processing helpers and stub class**

The data processing helpers (all pure functions, no `this`):

- `buildProcessGraph(rows, colIdx, caseField, activityField, timeField, statusField, resourceField)` — groups rows by case, sorts by time, computes transitions, returns `{ nodes: {name, count, statuses, resources}, edges: {from, to, count, durations}, cases: [...], variants: count }`
- `computeKPIs(graphData)` — computes case count, activity count, median/avg duration, self-loop %, variant count
- `formatDuration(ms)` — formats milliseconds as "Xd Yh Zm" or "< 1m"
- `median(arr)` — computes median of a numeric array
- `truncateText(text, maxLen)` — truncates with ellipsis at 20 chars

Write the full AMD module structure (include the required file header comment):
```javascript
/*
 * Process Mining — Splunk Custom Visualization
 *
 * Renders a process mining directed graph from raw event sequences.
 * Computes transitions, builds a Sugiyama-inspired layered layout,
 * and draws interactive nodes and edges on Canvas 2D.
 *
 * Expected SPL columns: _time, case_id, activity, status (optional), resource (optional)
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function(SplunkVisualizationBase, SplunkVisualizationUtils) {

    // ── Data Processing Helpers ─────────────────────────────────

    function median(arr) { /* ... */ }
    function formatDuration(ms) { /* ... */ }
    function truncateText(text, maxLen) { /* ... */ }
    function buildProcessGraph(rows, colIdx, caseField, activityField, timeField, statusField, resourceField) { /* ... */ }
    function computeKPIs(graphData) { /* ... */ }

    // ── Layout Helpers (Task 4) ─────────────────────────────────
    // ── Drawing Helpers (Task 5) ─────────────────────────────────
    // ── Interaction Helpers (Task 6) ─────────────────────────────

    // ── Visualization Class ─────────────────────────────────────

    return SplunkVisualizationBase.extend({
        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('process-mining-viz');
            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.el.appendChild(this.canvas);
            this._lastGoodData = null;
            // Transform state for zoom/pan
            this._tx = 0;
            this._ty = 0;
            this._scale = 1;
            // Interaction state
            this._hitNodes = [];
            this._hitEdges = [];
            this._hoverItem = null;
            this._isPanning = false;
            this._panStartX = 0;
            this._panStartY = 0;
            this._drilldownField = 'activity';
        },

        getInitialDataParams: function() {
            return {
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 10000
            };
        },

        formatData: function(data, config) {
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError(
                    'Awaiting data \u2014 Process Mining'
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
        },

        updateView: function(data, config) {
            if (!data) {
                if (this._lastGoodData) { data = this._lastGoodData; }
                else { return; }
            }
            // Stub — will be filled in Tasks 4-6
        },

        reflow: function() {
            this.invalidateUpdateView();
        },

        destroy: function() {
            // Will add listener cleanup in Task 6
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        }
    });
});
```

Write the complete data processing functions with full ES5 implementation. Key logic for `buildProcessGraph`:
- Iterate rows, group into cases object keyed by case_id
- Sort each case's events by time (parseFloat on _time), tiebreak by original row index
- For each case: prepend Start transition, build consecutive pairs, append End transition
- Aggregate node counts/statuses/resources and edge counts/durations
- Track variants (stringify each case's activity sequence, count uniques)

- [ ] **Step 2: Verify webpack builds**

```bash
cd examples/process_mining/appserver/static/visualizations/process_mining
npm install && npm run build
```

Expected: `visualization.js` created with no errors.

- [ ] **Step 3: Commit**

```bash
git add examples/process_mining/appserver/static/visualizations/process_mining/
git commit -m "feat: add visualization_source.js with data processing helpers"
```

---

### Task 4: Write layout algorithm

**Files:**
- Modify: `examples/process_mining/appserver/static/visualizations/process_mining/src/visualization_source.js`

Add the Sugiyama-inspired layout functions between the data processing helpers and the visualization class.

- [ ] **Step 1: Write the layout helper functions**

Functions to add (all pure, no `this`):

- `breakCycles(nodes, edges)` — DFS-based cycle detection; returns edges array with back-edges reversed and flagged
- `assignLevels(nodes, edges, startId)` — BFS from Start node, assigns each node a level (depth). Handles disconnected nodes by assigning max_level+1.
- `minimizeCrossings(levels, edges)` — for each level (repeated 4 passes), sort nodes by barycenter of their neighbors in adjacent level
- `assignPositions(levels, direction, canvasW, canvasH, kpiReserve)` — compute x,y for each node. For top-down: levels are rows, nodes spread horizontally. For left-right: levels are columns, nodes spread vertically. Returns `{ nodePositions: {id: {x, y}}, levelCount, maxNodesInLevel }`
- `computeNodeRadius(count, maxCount)` — maps count to radius in range [30, 60] proportional to count/maxCount

Key layout math:
- Level spacing: `availableSpace / (levelCount + 1)`
- Node spacing within level: `availableSpace / (nodesInLevel + 1)`
- After positioning, compute a bounding box and center the graph in the available canvas area

- [ ] **Step 2: Verify webpack builds**

```bash
cd examples/process_mining/appserver/static/visualizations/process_mining && npm run build
```

Expected: builds with no errors.

- [ ] **Step 3: Commit**

```bash
git add examples/process_mining/appserver/static/visualizations/process_mining/src/visualization_source.js
git commit -m "feat: add Sugiyama-inspired layout algorithm"
```

---

### Task 5: Write rendering code

**Files:**
- Modify: `examples/process_mining/appserver/static/visualizations/process_mining/src/visualization_source.js`

Add drawing helper functions and fill in `updateView` with the full render pipeline.

- [ ] **Step 1: Write drawing helper functions**

Functions to add (all pure, no `this`):

- `drawNode(ctx, x, y, radius, label, count, color, isStart, isEnd, isHovered, showCount)` — draws a circle node with label and optional count. Start node: dark filled. End node: double circle. Hovered: lighter fill + thicker border. Text auto-sized to fit radius.
- `drawEdge(ctx, fromX, fromY, toX, toY, fromR, toR, count, color, thickness, isHovered, showLabel, isSelfLoop)` — draws quadratic bezier from edge of from-circle to edge of to-circle, with arrowhead. Self-loops draw a small arc. Label at bezier midpoint (t=0.5).
- `drawArrowhead(ctx, x, y, angle, size, color)` — triangle arrowhead at end of edge
- `drawKPIHeader(ctx, kpis, w, kpiColor)` — draws the 6 KPI values evenly across the top 60px
- `drawTooltip(ctx, x, y, lines, w, h)` — rounded rect with text lines at mouse position
- `hexToRgba(hex, alpha)` — convert hex color to rgba string for hover effects
- `lightenColor(hex, amount)` — lighten a hex color for hover state

- [ ] **Step 2: Fill in updateView with the full render pipeline**

```javascript
updateView: function(data, config) {
    if (!data) {
        if (this._lastGoodData) { data = this._lastGoodData; }
        else { return; }
    }

    // 1. Read all config settings with defaults matching formatter.html
    var ns = this.getPropertyNamespaceInfo().propertyNamespace;
    var caseField = config[ns + 'caseField'] || 'case_id';
    var activityField = config[ns + 'activityField'] || 'activity';
    var timeField = config[ns + 'timeField'] || '_time';
    var statusField = config[ns + 'statusField'] || 'status';
    var resourceField = config[ns + 'resourceField'] || 'resource';
    var layoutDirection = config[ns + 'layoutDirection'] || 'top-down';
    var nodeColor = config[ns + 'nodeColor'] || '#607d8b';
    var edgeColor = config[ns + 'edgeColor'] || '#90a4ae';
    var successColor = config[ns + 'successColor'] || '#4caf50';
    var errorColor = config[ns + 'errorColor'] || '#f44336';
    var showKPIs = (config[ns + 'showKPIs'] || 'true') === 'true';
    var kpiColor = config[ns + 'kpiColor'] || '#00bcd4';
    var showEdgeLabels = (config[ns + 'showEdgeLabels'] || 'true') === 'true';
    var showNodeCounts = (config[ns + 'showNodeCounts'] || 'true') === 'true';
    this._drilldownField = config[ns + 'drilldownField'] || 'activity';

    // 2. Size canvas for HiDPI
    var el = this.el;
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    var dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    var ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    var w = rect.width;
    var h = rect.height;

    // 3. Clear canvas
    ctx.clearRect(0, 0, w, h);

    // 4. Build process graph from raw rows
    var graph = buildProcessGraph(data.rows, data.colIdx, caseField, activityField, timeField, statusField, resourceField);

    // 5. Compute KPIs
    var kpis = computeKPIs(graph);
    var kpiReserve = showKPIs ? 60 : 0;

    // 6. Draw KPI header if enabled
    if (showKPIs) {
        drawKPIHeader(ctx, kpis, w, kpiColor);
    }

    // 7. Run layout algorithm
    var safeEdges = breakCycles(graph.nodes, graph.edges);
    var levels = assignLevels(graph.nodes, safeEdges, '__start__');
    minimizeCrossings(levels, safeEdges);
    var positions = assignPositions(levels, layoutDirection, w, h, kpiReserve);

    // 8. Apply zoom/pan transform
    ctx.save();
    ctx.translate(this._tx, this._ty + kpiReserve);
    ctx.scale(this._scale, this._scale);

    // 9. Draw edges (behind nodes)
    // 10. Draw nodes
    // 11. Store hit rects for interaction
    // 12. Draw tooltip if hovering

    ctx.restore();

    // 13. Draw tooltip outside transform (screen coordinates)
}
```

- [ ] **Step 3: Verify webpack builds**

```bash
cd examples/process_mining/appserver/static/visualizations/process_mining && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add examples/process_mining/appserver/static/visualizations/process_mining/src/visualization_source.js
git commit -m "feat: add Canvas rendering and full updateView pipeline"
```

---

### Task 6: Add interactions (zoom/pan, hover, drilldown)

**Files:**
- Modify: `examples/process_mining/appserver/static/visualizations/process_mining/src/visualization_source.js`

- [ ] **Step 1: Add interaction helper functions**

Functions to add:

- `pointInCircle(px, py, cx, cy, r)` — returns true if point is within circle
- `pointNearBezier(px, py, x1, y1, cpx, cpy, x2, y2, threshold)` — sample 20 points on bezier, return true if any within threshold (6px)
- `bezierPoint(t, p0, p1, p2)` — evaluate quadratic bezier at parameter t
- `screenToWorld(sx, sy, tx, ty, scale)` — convert screen coords to world coords accounting for transform

- [ ] **Step 2: Add event listeners in initialize**

Add to `initialize` after canvas creation:

- `wheel` listener: adjust `this._scale` (clamp 0.1–5), adjust `this._tx`/`this._ty` to zoom toward mouse. Call `this.invalidateUpdateView()`.
- `mousedown` listener: if not over a node, start panning (`this._isPanning = true`, store start coords)
- `mousemove` listener: if panning, update `this._tx`/`this._ty`. If not panning, hit-test nodes and edges, update `this._hoverItem`, set cursor. Call `this.invalidateUpdateView()`.
- `mouseup` listener: stop panning.
- `click` listener: hit-test nodes, fire drilldown if clicked.

Store all listener references on `this` for cleanup:
```javascript
this._onWheel = function(e) { /* ... */ };
this._onMouseDown = function(e) { /* ... */ };
this._onMouseMove = function(e) { /* ... */ };
this._onMouseUp = function(e) { /* ... */ };
this._onClick = function(e) { /* ... */ };
this.canvas.addEventListener('wheel', this._onWheel);
this.canvas.addEventListener('mousedown', this._onMouseDown);
this.canvas.addEventListener('mousemove', this._onMouseMove);
this.canvas.addEventListener('mouseup', this._onMouseUp);
this.canvas.addEventListener('click', this._onClick);
```

- [ ] **Step 3: Update destroy to clean up listeners**

```javascript
destroy: function() {
    if (this.canvas) {
        this.canvas.removeEventListener('wheel', this._onWheel);
        this.canvas.removeEventListener('mousedown', this._onMouseDown);
        this.canvas.removeEventListener('mousemove', this._onMouseMove);
        this.canvas.removeEventListener('mouseup', this._onMouseUp);
        this.canvas.removeEventListener('click', this._onClick);
    }
    SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
}
```

- [ ] **Step 4: Add zoom control buttons drawing**

In `updateView`, after restoring the transform, draw three buttons in the bottom-left:
- "+" button (zoom in)
- "−" button (zoom out)
- "⊡" button (fit to view — reset transform to center graph)

Add these to `this._hitNodes` with special type so click handler can distinguish them from data nodes.

- [ ] **Step 5: Verify webpack builds**

```bash
cd examples/process_mining/appserver/static/visualizations/process_mining && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add examples/process_mining/appserver/static/visualizations/process_mining/src/visualization_source.js
git commit -m "feat: add zoom/pan, hover tooltips, and drilldown interactions"
```

---

### Task 7: Write README.md and build

**Files:**
- Create: `examples/process_mining/README.md`

- [ ] **Step 1: Write README.md**

Include: description, install instructions, required/optional columns table, example SPL (from spec), configuration table (all 15 settings), drilldown setup instructions for Dashboard Studio, time range recommendation, and build instructions.

- [ ] **Step 2: Build with build.sh**

```bash
./build.sh process_mining
```

Expected: `dist/process_mining-1.0.0.tar.gz` created.

- [ ] **Step 3: Commit**

```bash
git add examples/process_mining/README.md
git commit -m "feat: add process_mining README and verify build"
```

---

### Task 8: Test in Splunk

**Files:** None (manual verification)

- [ ] **Step 1: Install in Splunk**

```bash
$SPLUNK_HOME/bin/splunk install app dist/process_mining-1.0.0.tar.gz
$SPLUNK_HOME/bin/splunk restart
```

- [ ] **Step 2: Verify the saved search renders**

Open Splunk → Search → Load "Process Mining - Demo" → Select "Process Mining" visualization.

Verify:
- Graph renders with Start → activities → End
- KPI header shows 6 metrics
- Hover shows tooltips on nodes and edges
- Click fires drilldown
- Zoom/pan works (scroll wheel, drag)
- Layout direction toggle works (top-down vs left-right)
- All formatter settings respond correctly

- [ ] **Step 3: Test with the user's real SPL**

```spl
index=fake_tshrt sourcetype IN (fake:access_combined, FAKE:azure:servicebus, FAKE:online:order, FAKE:online:order:registry, FAKE:sap:auditlog)
| eval case_id=tshirtcid, activity=sourcetype, status=coalesce(status, http_status, "ok"), resource=coalesce(user, host)
| table _time case_id activity status resource
| sort case_id _time
```

Verify: renders the process flow between sourcetypes.
