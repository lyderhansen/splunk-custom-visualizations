# Business Process Flow v5.0.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade BPF visualization from v4.9.1 to v5.0.0 — replace canvas popups with DOM properties panel, add canvas panning, new shapes, visual effects, grid/snap, stroke patterns, line animations, and markdown textboxes.

**Architecture:** Single-file AMD visualization (`visualization_source.js`, currently 4269 lines). DOM panel built with `document.createElement()` in `initialize()`, updated via `_updatePanel()` helper. All new features integrate through existing `_editorState` → `drawNode`/`drawConnection` → `updateView` pipeline. ES5 only.

**Tech Stack:** Canvas 2D, vanilla DOM, ES5 JavaScript, AMD module, webpack 5

**Spec:** `docs/superpowers/specs/2026-03-22-bpf-v5-design.md`

**Source file:** `examples/business_process_flow/appserver/static/visualizations/business_process_flow/src/visualization_source.js`

**Key line references (v4.9.1):**
- `roundRect`: L111, `getEdgeConnectionPoint`: L283, `getThemeColors`: L335
- `computeNodePositions`: L350, `drawNode`: L708, `drawConnection`: L976
- `drawToolbar`: L1157, `drawNodePopup`: L1278, `drawConnectionPopup`: L1695
- `initialize`: L2033, `mousedown`: L2541, `mousemove`: L3242
- `mouseup`: L3536, `dblclick`: L3708, `keydown`: L3795, `updateView`: L3930

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/visualization_source.js` | Modify | All visualization logic — panel, shapes, panning, effects, animations, grid |
| `formatter.html` | Modify | Add Effects section (rawValue, shadow, glow settings) |
| `README/savedsearches.conf.spec` | Modify | Add new setting entries, remove stale editMode |
| `default/savedsearches.conf` | Modify | Add new default settings |
| `default/app.conf` | Modify | Version bump to 5.0.0 |
| `CHANGELOG.md` | Modify | Add v5.0.0 entry |

---

## Task 1: Multi-Select Foundation

Convert `_selectedNodeId` (single string) to `_selectedNodeIds` (array). This is prerequisite for the panel (which shows different content for single vs multi-select) and for align/distribute.

**Files:**
- Modify: `src/visualization_source.js` — all references to `_selectedNodeId`

- [ ] **Step 1: Find all `_selectedNodeId` references**

Run: `grep -n '_selectedNodeId' src/visualization_source.js | head -40`

Document every line number. These all need migration.

- [ ] **Step 2: Replace initialization**

In `initialize()` (~L2033), change:
```javascript
// OLD
this._selectedNodeId = null;

// NEW
this._selectedNodeIds = [];
```

- [ ] **Step 3: Add multi-select helper functions**

Add after the helper functions section (~L100):
```javascript
function arrContains(arr, val) {
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] === val) return true;
    }
    return false;
}

function arrRemove(arr, val) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] !== val) out.push(arr[i]);
    }
    return out;
}
```

- [ ] **Step 4: Update click handlers for shift+click**

In mousedown/click handler, replace single-select logic with:
```javascript
// Single click without shift: select only this node
if (!event.shiftKey) {
    self._selectedNodeIds = [hitNode.id];
} else {
    // Shift+click: toggle in/out of selection
    if (arrContains(self._selectedNodeIds, hitNode.id)) {
        self._selectedNodeIds = arrRemove(self._selectedNodeIds, hitNode.id);
    } else {
        self._selectedNodeIds = self._selectedNodeIds.concat([hitNode.id]);
    }
}
```

- [ ] **Step 5: Update all remaining references**

Migrate every `_selectedNodeId` reference to use `_selectedNodeIds[0]` for single-selection behavior, or `arrContains(_selectedNodeIds, id)` for membership checks. Key locations:
- Toolbar delete handler: delete all selected nodes
- Node drag: move all selected nodes together (apply dx/dy to each)
- Resize handles: only show for single selection (`_selectedNodeIds.length === 1`)
- Connection creation: use `_selectedNodeIds[0]` as source
- Escape key: `self._selectedNodeIds = [];`
- Highlight rendering in drawNode: `arrContains(self._selectedNodeIds, node.id)`
- Code editor JSON generation

- [ ] **Step 6: Update drawNode highlight**

In `drawNode()` (~L708), change the selected-node highlight border to check array:
```javascript
var isSelected = arrContains(selectedIds, node.id);
if (isSelected) {
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.stroke();
}
```

- [ ] **Step 7: Add rubber-band drag selection**

When dragging on empty space (not a node, not Space-for-pan):
```javascript
// In mousedown: if no node hit and not panning
this._isRubberBand = true;
this._rubberBandStart = { x: mx, y: my };
this._rubberBandEnd = { x: mx, y: my };

// In mousemove: if _isRubberBand
this._rubberBandEnd = { x: mx, y: my };
self.invalidateUpdateView();

// In mouseup: if _isRubberBand
var rx = Math.min(self._rubberBandStart.x, self._rubberBandEnd.x);
var ry = Math.min(self._rubberBandStart.y, self._rubberBandEnd.y);
var rw = Math.abs(self._rubberBandEnd.x - self._rubberBandStart.x);
var rh = Math.abs(self._rubberBandEnd.y - self._rubberBandStart.y);
self._selectedNodeIds = [];
for (var i = 0; i < positioned.length; i++) {
    var n = positioned[i];
    if (n.x + n.w > rx && n.x < rx + rw && n.y + n.h > ry && n.y < ry + rh) {
        self._selectedNodeIds.push(n.id);
    }
}
self._isRubberBand = false;
self._updatePanel();
```

In updateView, draw the rubber-band rectangle:
```javascript
if (this._isRubberBand) {
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    var rx = Math.min(this._rubberBandStart.x, this._rubberBandEnd.x);
    var ry = Math.min(this._rubberBandStart.y, this._rubberBandEnd.y);
    ctx.strokeRect(rx, ry,
        Math.abs(this._rubberBandEnd.x - this._rubberBandStart.x),
        Math.abs(this._rubberBandEnd.y - this._rubberBandStart.y));
    ctx.setLineDash([]);
}
```

- [ ] **Step 8: Test and commit**

Build: `cd examples/business_process_flow/appserver/static/visualizations/business_process_flow && npm run build`
Test in harness: verify single-click selects one node, shift+click adds/removes, dragging moves all selected, rubber-band selects enclosed nodes.

```bash
git add -A && git commit -m "feat: multi-select nodes with shift+click and rubber-band drag

Replaces _selectedNodeId with _selectedNodeIds array.
Shift+click toggles nodes in/out of selection.
Drag empty space for rubber-band selection box.
Dragging moves all selected nodes together.
Resize handles only for single selection."
```

---

## Task 2: DOM Properties Panel — Shell

Create the panel DOM structure in `initialize()`. No content yet — just the collapsible container with header, collapse toggle, and scrollable body.

**Files:**
- Modify: `src/visualization_source.js` — `initialize()` and `updateView()`

- [ ] **Step 1: Create panel DOM in initialize()**

After the Edit button creation (~L2061), add:
```javascript
// ── Properties Panel ──
this._panelEl = document.createElement('div');
this._panelEl.style.cssText = 'position:absolute;right:0;top:36px;bottom:0;width:280px;' +
    'background:rgba(15,23,42,0.97);border-left:1px solid #334155;' +
    'display:none;flex-direction:column;font:11px sans-serif;color:#cbd5e1;' +
    'z-index:4;transition:width 0.15s;overflow:hidden;';
this.el.appendChild(this._panelEl);

// Panel header
this._panelHeader = document.createElement('div');
this._panelHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;' +
    'padding:8px 12px;border-bottom:1px solid #334155;flex-shrink:0;';
this._panelTitle = document.createElement('span');
this._panelTitle.style.cssText = 'font-weight:bold;color:#fbbf24;font-size:12px;';
this._panelTitle.textContent = 'Properties';
this._panelCollapse = document.createElement('span');
this._panelCollapse.style.cssText = 'cursor:pointer;color:#64748b;font-size:16px;padding:0 4px;';
this._panelCollapse.textContent = '»';
this._panelHeader.appendChild(this._panelTitle);
this._panelHeader.appendChild(this._panelCollapse);
this._panelEl.appendChild(this._panelHeader);

// Panel body (scrollable)
this._panelBody = document.createElement('div');
this._panelBody.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;padding:0;';
this._panelEl.appendChild(this._panelBody);

// Collapsed strip
this._panelStrip = document.createElement('div');
this._panelStrip.style.cssText = 'position:absolute;right:0;top:36px;bottom:0;width:24px;' +
    'background:rgba(15,23,42,0.97);border-left:1px solid #334155;' +
    'display:none;flex-direction:column;align-items:center;padding-top:8px;' +
    'cursor:pointer;z-index:4;font:10px sans-serif;color:#64748b;';
var stripIcon = document.createElement('span');
stripIcon.textContent = '«';
stripIcon.style.cssText = 'font-size:14px;';
this._panelStrip.appendChild(stripIcon);
var stripLabel = document.createElement('span');
stripLabel.textContent = 'Properties';
stripLabel.style.cssText = 'writing-mode:vertical-lr;margin-top:8px;font-size:9px;';
this._panelStrip.appendChild(stripLabel);
this.el.appendChild(this._panelStrip);

// Panel state
this._panelCollapsed = false;
```

- [ ] **Step 2: Add collapse/expand handlers**

```javascript
var self = this;
this._panelCollapse.addEventListener('click', function() {
    self._panelCollapsed = true;
    self._panelEl.style.display = 'none';
    self._panelStrip.style.display = 'flex';
});
this._panelStrip.addEventListener('click', function() {
    self._panelCollapsed = false;
    self._panelEl.style.display = 'flex';
    self._panelStrip.style.display = 'none';
});
```

- [ ] **Step 3: Show/hide panel in updateView()**

In `updateView()`, after the Edit button visibility logic (~L4247):
```javascript
// Panel visibility — only in edit mode
if (this._editMode) {
    if (this._panelCollapsed) {
        this._panelEl.style.display = 'none';
        this._panelStrip.style.display = 'flex';
    } else {
        this._panelEl.style.display = 'flex';
        this._panelStrip.style.display = 'none';
    }
} else {
    this._panelEl.style.display = 'none';
    this._panelStrip.style.display = 'none';
}
```

- [ ] **Step 4: Build and test**

Build and verify: panel appears when entering edit mode, collapses/expands with toggle, hidden in view mode.

```bash
git add -A && git commit -m "feat: DOM properties panel shell with collapse toggle"
```

---

## Task 3: Panel Content — Section Builder

Add helper functions to build collapsible sections with Splunk-inspired styling. These helpers are reused by all panel states (node, connection, canvas tools).

**Files:**
- Modify: `src/visualization_source.js` — add panel helper functions

- [ ] **Step 1: Add section builder helper**

Add near the panel code in `initialize()` area, or as a standalone helper:
```javascript
function createPanelSection(title, summaryText, expanded) {
    var section = document.createElement('div');
    section.style.cssText = 'border-bottom:1px solid #1e293b;';

    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 12px;' +
        'background:#1e293b;cursor:pointer;user-select:none;';

    var arrow = document.createElement('span');
    arrow.style.cssText = 'color:#64748b;font-size:9px;flex-shrink:0;';
    arrow.textContent = expanded ? '▼' : '▶';

    var titleEl = document.createElement('span');
    titleEl.style.cssText = 'font-size:11px;font-weight:bold;color:#94a3b8;';
    titleEl.textContent = title;

    var summary = document.createElement('span');
    summary.style.cssText = 'font-size:9px;color:#475569;margin-left:auto;';
    summary.textContent = summaryText || '';

    header.appendChild(arrow);
    header.appendChild(titleEl);
    header.appendChild(summary);

    var body = document.createElement('div');
    body.style.cssText = 'padding:8px 12px;' + (expanded ? '' : 'display:none;');

    header.addEventListener('click', function() {
        var isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : '';
        arrow.textContent = isOpen ? '▶' : '▼';
        summary.style.display = isOpen ? '' : 'none';
    });

    section.appendChild(header);
    section.appendChild(body);
    section._body = body;
    section._summary = summary;
    section._arrow = arrow;
    return section;
}
```

- [ ] **Step 2: Add input builder helpers**

```javascript
function createToggleRow(label, options, activeValue, onChange) {
    var row = document.createElement('div');
    row.style.cssText = 'margin-bottom:8px;';

    var lbl = document.createElement('div');
    lbl.style.cssText = 'color:#64748b;font-size:9px;margin-bottom:4px;';
    lbl.textContent = label;
    row.appendChild(lbl);

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:3px;flex-wrap:wrap;';

    for (var i = 0; i < options.length; i++) {
        (function(opt) {
            var btn = document.createElement('button');
            btn.textContent = opt.label || opt.value;
            var isActive = opt.value === activeValue;
            btn.style.cssText = 'padding:3px 8px;border-radius:4px;border:1px solid ' +
                (isActive ? '#6366f1' : '#334155') + ';background:' +
                (isActive ? '#475569' : '#1e293b') + ';color:' +
                (isActive ? '#fff' : '#94a3b8') + ';font-size:10px;cursor:pointer;';
            btn.addEventListener('click', function() { onChange(opt.value); });
            btnRow.appendChild(btn);
        })(options[i]);
    }

    row.appendChild(btnRow);
    return row;
}

function createTextRow(label, value, onChange) {
    var row = document.createElement('div');
    row.style.cssText = 'margin-bottom:8px;';

    var lbl = document.createElement('div');
    lbl.style.cssText = 'color:#64748b;font-size:9px;margin-bottom:4px;';
    lbl.textContent = label;
    row.appendChild(lbl);

    var input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    input.style.cssText = 'width:100%;box-sizing:border-box;padding:4px 8px;border-radius:4px;' +
        'border:1px solid #334155;background:#0f172a;color:#cbd5e1;font-size:11px;outline:none;';
    input.addEventListener('focus', function() { input.style.borderColor = '#6366f1'; });
    input.addEventListener('blur', function() {
        input.style.borderColor = '#334155';
        onChange(input.value);
    });
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { input.blur(); }
        e.stopPropagation();
    });
    row.appendChild(input);
    return row;
}

function createColorRow(label, colors, activeColor, onSelect) {
    var row = document.createElement('div');
    row.style.cssText = 'margin-bottom:8px;';

    var lbl = document.createElement('div');
    lbl.style.cssText = 'color:#64748b;font-size:9px;margin-bottom:4px;';
    lbl.textContent = label;
    row.appendChild(lbl);

    var swatchRow = document.createElement('div');
    swatchRow.style.cssText = 'display:flex;gap:3px;flex-wrap:wrap;align-items:center;';

    for (var i = 0; i < colors.length; i++) {
        (function(c) {
            var swatch = document.createElement('div');
            var isSel = c === activeColor;
            swatch.style.cssText = 'width:18px;height:18px;border-radius:3px;cursor:pointer;' +
                'background:' + c + ';border:' + (isSel ? '2px solid #fbbf24' : '1px solid #475569') + ';';
            swatch.addEventListener('click', function() { onSelect(c); });
            swatchRow.appendChild(swatch);
        })(colors[i]);
    }

    // Hex input
    var hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.value = activeColor || '';
    hexInput.style.cssText = 'width:60px;padding:2px 4px;border-radius:3px;border:1px solid #334155;' +
        'background:#0f172a;color:#cbd5e1;font-size:9px;margin-left:4px;';
    hexInput.addEventListener('blur', function() { onSelect(hexInput.value); });
    hexInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') hexInput.blur();
        e.stopPropagation();
    });
    swatchRow.appendChild(hexInput);

    // Native color picker
    var picker = document.createElement('input');
    picker.type = 'color';
    picker.value = activeColor || '#3b82f6';
    picker.style.cssText = 'width:18px;height:18px;border:none;padding:0;cursor:pointer;' +
        'background:transparent;margin-left:2px;';
    picker.addEventListener('input', function() { onSelect(picker.value); });
    swatchRow.appendChild(picker);

    row.appendChild(swatchRow);
    return row;
}
```

- [ ] **Step 3: Build and commit**

```bash
git add -A && git commit -m "feat: panel section and input builder helpers"
```

---

## Task 4: Panel Content — Node Properties

Wire the panel to show node properties when a node is selected. This replaces `drawNodePopup()`.

**Files:**
- Modify: `src/visualization_source.js` — add `_updatePanel()` method, update click handlers

- [ ] **Step 1: Add _updatePanel() method**

Add as a method on the visualization object:
```javascript
_updatePanel: function() {
    if (!this._panelBody || !this._editMode) return;
    var self = this;
    var body = this._panelBody;
    body.innerHTML = '';

    var es = this._editorState;
    var colors = PALETTES[this._currentPalette || 'corporate'] || PALETTES.corporate;

    if (this._selectedNodeIds.length === 1) {
        // Single node selected
        var nodeId = this._selectedNodeIds[0];
        var ns = es.nodes[nodeId] || {};
        this._panelTitle.textContent = ns.label || nodeId;

        this._buildNodePanel(body, nodeId, ns, colors);
    } else if (this._selectedNodeIds.length > 1) {
        // Multi-select
        this._panelTitle.textContent = this._selectedNodeIds.length + ' nodes selected';
        this._buildMultiSelectPanel(body);
    } else if (this._selectedConnection !== null) {
        // Connection selected
        this._panelTitle.textContent = 'Connection';
        this._buildConnectionPanel(body);
    } else {
        // Nothing selected — canvas tools
        this._panelTitle.textContent = 'Canvas Tools';
        this._buildCanvasToolsPanel(body);
    }
},
```

- [ ] **Step 2: Implement _buildNodePanel()**

Build collapsible sections for: Appearance, Text & Value, Sparkline, Effects, Conditions. Each section uses the helpers from Task 3. All onChange callbacks follow pattern:
```javascript
function(val) {
    if (!es.nodes[nodeId]) es.nodes[nodeId] = {};
    es.nodes[nodeId].property = val;
    self._pushUndo();
    self.invalidateUpdateView();
    self._updatePanel();
}
```

Full implementation includes all properties from the spec Section 1 "Node selected" table:
- Appearance: shape (8 options), color (palette + hex + picker), borderRadius (0/4/8/12/20/50), opacity (100/80/60/40%), strokePattern (solid/dashed/dotted/dash-dot/long-dash), borderWidth (none/thin/med/thick)
- Text & Value: label (text input), show/hide value (toggle), rawValue (toggle), prefix (text), suffix (text), fontSize (auto/S/M/L/XL), textAlign (left/center/right), labelColor (color), valueColor (color), padding (compact/normal/spacious)
- Sparkline: sparklineType (auto/line/area/bar/off), sparkPosition (below/above/behind/left), chartHeight (auto/S/M/L)
- Effects: shadowEnabled, shadowBlur, shadowOffsetX/Y, shadowColor, glowEnabled, glowBlur, glowColor
- Conditions: existing rule editor (operator + value + color, add/delete)

- [ ] **Step 3: Update click handlers to call _updatePanel()**

In mousedown handler, after setting `_selectedNodeIds`, add:
```javascript
self._updatePanel();
```

Also after deselect (click empty space, Escape key):
```javascript
self._selectedNodeIds = [];
self._selectedConnection = null;
self._updatePanel();
```

- [ ] **Step 4: Remove drawNodePopup() call from updateView()**

In `updateView()` (~L4217-4229), remove the `drawNodePopup()` call and related state. Keep the popup state cleanup but remove canvas rendering.

- [ ] **Step 5: Build and test**

Verify: click node in edit mode → panel shows properties. Change shape/color/value → canvas updates. Deselect → panel shows Canvas Tools.

```bash
git add -A && git commit -m "feat: node properties in DOM panel, remove canvas popup"
```

---

## Task 5: Panel Content — Connection Properties

Wire connection properties panel, replacing `drawConnectionPopup()`.

**Files:**
- Modify: `src/visualization_source.js`

- [ ] **Step 1: Implement _buildConnectionPanel()**

Sections: Style, Endpoints, Anchors, Label, Animation (placeholder for now).
All properties from spec Section 1 "Connection selected" table.

- [ ] **Step 2: Update click handlers for connection selection**

When clicking a connection, set `_selectedNodeIds = []` and call `_updatePanel()`.

- [ ] **Step 3: Remove drawConnectionPopup() call from updateView()**

- [ ] **Step 4: Build and test**

```bash
git add -A && git commit -m "feat: connection properties in DOM panel, remove canvas popup"
```

---

## Task 6: Panel Content — Canvas Tools

Show grid/snap/align controls when nothing is selected.

**Files:**
- Modify: `src/visualization_source.js`

- [ ] **Step 1: Add canvas tool state to initialize()**

```javascript
this._gridEnabled = false;
this._gridSize = 20;
this._snapEnabled = false;
```

- [ ] **Step 2: Implement _buildCanvasToolsPanel()**

Sections with toggles for grid on/off, grid size (10/20/50), snap on/off.
Align/distribute buttons (disabled when < 2 nodes selected).

- [ ] **Step 3: Implement _buildMultiSelectPanel()**

Shows "N nodes selected" with align/distribute buttons and shared property editing.

- [ ] **Step 4: Build and commit**

```bash
git add -A && git commit -m "feat: canvas tools panel (grid, snap, align, distribute)"
```

---

## Task 7: Canvas Panning

Add Space+drag canvas panning with `ctx.translate()`.

**Files:**
- Modify: `src/visualization_source.js`

- [ ] **Step 1: Add pan state to initialize()**

```javascript
this._panX = 0;
this._panY = 0;
this._isPanning = false;
this._spaceHeld = false;
```

- [ ] **Step 2: Add keydown/keyup handlers for Space**

In keydown handler, add at the top:
```javascript
if (e.key === ' ' || e.keyCode === 32) {
    var tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    e.preventDefault();
    self._spaceHeld = true;
    self.canvas.style.cursor = 'grab';
}
```

In keyup:
```javascript
if (e.key === ' ' || e.keyCode === 32) {
    self._spaceHeld = false;
    self._isPanning = false;
    self.canvas.style.cursor = 'default';
}
```

- [ ] **Step 3: Add pan logic to mousedown/mousemove/mouseup**

Mousedown: if `_spaceHeld && !_isDragging && !_isResizing`, set `_isPanning = true`, cursor = 'grabbing'.
Mousemove: if `_isPanning`, `_panX += dx; _panY += dy; invalidateUpdateView(); return;`
Mouseup: `_isPanning = false;`

- [ ] **Step 4: Apply pan offset in updateView()**

Before drawing nodes/connections:
```javascript
ctx.save();
ctx.translate(this._panX, this._panY);
```
After drawing nodes/connections/overlays (before toolbar/panel):
```javascript
ctx.restore();
```

- [ ] **Step 5: Adjust all hit testing**

In mousedown/mousemove/mouseup, adjust mouse coordinates for pan:
```javascript
var mx = (event.clientX - canvasRect.left) - self._panX;
var my = (event.clientY - canvasRect.top) - self._panY;
```
Toolbar hit testing uses raw coordinates (not panned).

- [ ] **Step 6: Reset pan on Fit button**

In the "fit" toolbar action, add:
```javascript
self._panX = 0;
self._panY = 0;
```

- [ ] **Step 7: Build and test**

Test: hold Space + drag to pan. Release Space → normal mode. Fit button resets pan. Verify node clicks still work after panning.

```bash
git add -A && git commit -m "feat: canvas panning with Space+drag"
```

---

## Task 8: Grid & Snap

Draw dot grid on canvas, snap nodes to grid on drag end.

**Files:**
- Modify: `src/visualization_source.js`

- [ ] **Step 1: Add drawGrid() function**

```javascript
function drawGrid(ctx, w, h, gridSize, panX, panY, isDark) {
    var dotColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    var startX = (panX % gridSize);
    var startY = (panY % gridSize);
    ctx.fillStyle = dotColor;
    for (var x = startX; x < w; x += gridSize) {
        for (var y = startY; y < h; y += gridSize) {
            ctx.beginPath();
            ctx.arc(x, y, 1, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}
```

- [ ] **Step 2: Call drawGrid() in updateView()**

After clearing canvas, before drawing connections/nodes, if `_editMode && _gridEnabled`:
```javascript
if (this._editMode && this._gridEnabled) {
    drawGrid(ctx, w, h, this._gridSize, this._panX, this._panY, isDark);
}
```

- [ ] **Step 3: Add snap logic to mouseup (drag end)**

In mouseup handler, after node drag ends, if `_snapEnabled`:
```javascript
if (self._snapEnabled && self._gridSize > 0) {
    var nodeState = es.nodes[nodeId];
    if (nodeState) {
        nodeState.x = Math.round(nodeState.x / self._gridSize) * self._gridSize;
        nodeState.y = Math.round(nodeState.y / self._gridSize) * self._gridSize;
    }
}
```

- [ ] **Step 4: Implement align/distribute functions**

```javascript
function alignNodes(editorState, nodeIds, computedNodes, direction) {
    // direction: 'left','center','right','top','middle','bottom'
    var positions = [];
    for (var i = 0; i < nodeIds.length; i++) {
        var cn = computedNodes[nodeIds[i]];
        if (cn) positions.push({ id: nodeIds[i], x: cn.x, y: cn.y, w: cn.w, h: cn.h });
    }
    if (positions.length < 2) return;
    // ... compute target position based on direction, update editorState.nodes[id].x/y
}

function distributeNodes(editorState, nodeIds, computedNodes, axis) {
    // axis: 'horizontal' or 'vertical'
    // ... sort by position, space evenly
}
```

- [ ] **Step 5: Build and test**

```bash
git add -A && git commit -m "feat: dot grid, snap-to-grid, align and distribute nodes"
```

---

## Task 9: New Shapes (+5)

Add hexagon, triangle, cylinder, cloud, pill shape paths.

**Files:**
- Modify: `src/visualization_source.js`

- [ ] **Step 1: Add shape path functions**

Add after `roundRect()` (~L111):
```javascript
function drawHexagonPath(ctx, x, y, w, h) {
    var cx = x + w / 2, cy = y + h / 2;
    var rx = w / 2, ry = h / 2;
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
        var angle = (Math.PI / 3) * i - Math.PI / 2;
        var px = cx + rx * Math.cos(angle);
        var py = cy + ry * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
}

function drawTrianglePath(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
}

function drawCylinderPath(ctx, x, y, w, h) {
    var ellH = h * 0.15;
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + ellH, w / 2, ellH, 0, Math.PI, 0);
    ctx.lineTo(x + w, y + h - ellH);
    ctx.ellipse(x + w / 2, y + h - ellH, w / 2, ellH, 0, 0, Math.PI);
    ctx.closePath();
}

function drawCloudPath(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.arc(x + w * 0.25, y + h * 0.55, w * 0.2, 0, Math.PI * 2);
    ctx.arc(x + w * 0.45, y + h * 0.35, w * 0.22, 0, Math.PI * 2);
    ctx.arc(x + w * 0.7, y + h * 0.4, w * 0.2, 0, Math.PI * 2);
    ctx.arc(x + w * 0.55, y + h * 0.6, w * 0.18, 0, Math.PI * 2);
    ctx.closePath();
}

function drawPillPath(ctx, x, y, w, h) {
    var r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x + r, y + h);
    ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
}
```

- [ ] **Step 2: Update drawNode() to use new shapes**

In `drawNode()`, expand the shape switch:
```javascript
if (shape === 'circle') {
    // existing circle path
} else if (shape === 'diamond') {
    // existing diamond path
} else if (shape === 'hexagon') {
    drawHexagonPath(ctx, nx, ny, nw, nh);
} else if (shape === 'triangle') {
    drawTrianglePath(ctx, nx, ny, nw, nh);
} else if (shape === 'cylinder') {
    drawCylinderPath(ctx, nx, ny, nw, nh);
} else if (shape === 'cloud') {
    drawCloudPath(ctx, nx, ny, nw, nh);
} else if (shape === 'pill') {
    drawPillPath(ctx, nx, ny, nw, nh);
} else {
    // default rect
    roundRect(ctx, nx, ny, nw, nh, radius);
}
```

- [ ] **Step 3: Update hit testing per shape**

Add point-in-shape functions for hexagon (polygon test), triangle (barycentric), cylinder/pill (bounding rect + radius check), cloud (union of circles).

- [ ] **Step 4: Update getEdgeConnectionPoint() per shape**

Calculate anchor points on actual shape boundary for each new shape.

- [ ] **Step 5: Update panel shape selector**

In `_buildNodePanel()` Appearance section, add all 8 shape options.

- [ ] **Step 6: Build and test**

```bash
git add -A && git commit -m "feat: add hexagon, triangle, cylinder, cloud, pill shapes"
```

---

## Task 10: Stroke Patterns

Replace boolean `dash` with `strokePattern` string for nodes and connections.

**Files:**
- Modify: `src/visualization_source.js`

- [ ] **Step 1: Add stroke pattern lookup**

```javascript
var STROKE_PATTERNS = {
    solid: [],
    dashed: [8, 4],
    dotted: [2, 3],
    'dash-dot': [8, 4, 2, 4],
    'long-dash': [16, 6]
};

function applyStrokePattern(ctx, pattern) {
    ctx.setLineDash(STROKE_PATTERNS[pattern] || []);
}
```

- [ ] **Step 2: Update drawNode() border rendering**

Apply stroke pattern to node border if `nodeState.strokePattern` is set.

- [ ] **Step 3: Update drawConnection()**

Replace `if (conn.dash) ctx.setLineDash([6,4])` with `applyStrokePattern(ctx, conn.strokePattern || 'solid')`. Add backward compat: if `conn.dash === true && !conn.strokePattern`, use 'dashed'.

- [ ] **Step 3b: Clean up `dash` property on save**

When writing editorState to JSON (Copy Layout, localStorage sync), migrate connections:
```javascript
// In the save/serialize path, strip old dash property
for (var i = 0; i < es.connections.length; i++) {
    var c = es.connections[i];
    if (c.dash !== undefined && !c.strokePattern) {
        c.strokePattern = c.dash ? 'dashed' : 'solid';
    }
    delete c.dash;
}
```

- [ ] **Step 4: Add to panel (node Appearance + connection Style)**

- [ ] **Step 5: Build and test**

```bash
git add -A && git commit -m "feat: stroke patterns (solid, dashed, dotted, dash-dot, long-dash)"
```

---

## Task 11: Node Visual Effects (Shadow & Glow)

Add shadow and glow rendering to nodes.

**Files:**
- Modify: `src/visualization_source.js`, `formatter.html`, `savedsearches.conf.spec`

- [ ] **Step 1: Add shadow/glow rendering to drawNode()**

Before drawing the node fill/stroke:
```javascript
// Shadow
var shadowOn = nodeState.shadowEnabled !== undefined ? nodeState.shadowEnabled : globalShadowEnabled;
if (shadowOn) {
    ctx.shadowBlur = nodeState.shadowBlur || globalShadowBlur || 8;
    ctx.shadowOffsetX = nodeState.shadowOffsetX || globalShadowOffsetX || 2;
    ctx.shadowOffsetY = nodeState.shadowOffsetY || globalShadowOffsetY || 2;
    ctx.shadowColor = nodeState.shadowColor || globalShadowColor || '#000000';
}
ctx.fill();
// Reset shadow (rule 5)
ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; ctx.shadowColor = 'transparent';

// Glow (draw a second pass with glow)
var glowOn = nodeState.glowEnabled !== undefined ? nodeState.glowEnabled : globalGlowEnabled;
if (glowOn) {
    ctx.shadowBlur = nodeState.glowBlur || globalGlowBlur || 12;
    ctx.shadowColor = nodeState.glowColor || globalGlowColor || '#3b82f6';
    ctx.stroke();
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
}
```

- [ ] **Step 2: Add Effects section to node panel**

Toggle rows for shadow/glow enable, plus text inputs for blur/offset/color.

- [ ] **Step 3: Update formatter.html**

Add "Effects" section with all 9 new settings per the spec.

- [ ] **Step 4: Update savedsearches.conf.spec**

Add 9 new entries, remove stale `editMode` entry.

- [ ] **Step 5: Read new config values in updateView()**

Add JS defaults that match formatter HTML defaults exactly.

- [ ] **Step 6: Build and test**

```bash
git add -A && git commit -m "feat: node shadow and glow effects with global/local settings"
```

---

## Task 12: Raw Value Toggle & Remaining Node Properties

Add all remaining node rendering properties not yet implemented: rawValue, textAlign, labelColor, valueColor, padding, fontSize, opacity, borderWidth. Note: rawValue formatter setting is added in Task 11 Step 3 (all 9 formatter settings added together). This task handles the per-node panel controls and drawNode rendering.

**Files:**
- Modify: `src/visualization_source.js`

- [ ] **Step 1: Update drawNode() for rawValue**

```javascript
var showRaw = nodeState.rawValue !== undefined ? nodeState.rawValue : globalRawValue;
var displayValue = showRaw ? Number(rawVal).toLocaleString() : formatCount(rawVal);
```

- [ ] **Step 2: Update drawNode() for textAlign**

```javascript
var tAlign = nodeState.textAlign || 'center';
ctx.textAlign = tAlign;
var textX = tAlign === 'left' ? nx + pad : tAlign === 'right' ? nx + nw - pad : nx + nw / 2;
```

- [ ] **Step 3: Update drawNode() for labelColor, valueColor**

```javascript
var lblColor = nodeState.labelColor || theme.textPrimary;
var valColor = nodeState.valueColor || theme.textSecondary;
```

- [ ] **Step 4: Update drawNode() for padding**

```javascript
var padMap = { compact: 6, normal: 10, spacious: 16 };
var pad = padMap[nodeState.padding] || padMap.normal;
```

- [ ] **Step 5: Ensure existing fontSize and opacity work through panel**

These properties already exist in drawNode() from v4.9.1. Verify the panel Appearance section includes:
- Opacity toggles (100%/80%/60%/40%) wired to `nodeState.opacity`
- Font size toggles (auto/S/M/L/XL) wired to `nodeState.fontSize`
- Border width toggles (none/thin/med/thick) wired to `nodeState.borderWidth`

- [ ] **Step 6: Update connection panel for endpoint size**

Ensure endpoint size control in connection panel Step 1 (Task 5) is wired to `conn.endpointSize`.

- [ ] **Step 7: Build and test**

```bash
git add -A && git commit -m "feat: raw value, text align, label/value colors, padding in drawNode"
```

---

## Task 13: Line Animations

Add marching-ants and pulse animations for connections.

**Files:**
- Modify: `src/visualization_source.js`

- [ ] **Step 1: Add animation state**

```javascript
this._animationFrame = null;
this._animationOffset = 0;
this._lastAnimTime = 0;
```

- [ ] **Step 2: Add animation loop**

```javascript
_startAnimationLoop: function() {
    if (this._animationFrame) return;
    var self = this;
    var targetInterval = 1000 / 30; // 30fps
    function tick(timestamp) {
        if (!self._hasActiveAnimations) { self._animationFrame = null; return; }
        if (timestamp - self._lastAnimTime >= targetInterval) {
            self._animationOffset += 1;
            self._lastAnimTime = timestamp;
            self.invalidateUpdateView();
        }
        self._animationFrame = requestAnimationFrame(tick);
    }
    this._animationFrame = requestAnimationFrame(tick);
},

_stopAnimationLoop: function() {
    if (this._animationFrame) {
        cancelAnimationFrame(this._animationFrame);
        this._animationFrame = null;
    }
},
```

- [ ] **Step 3: Update drawConnection() for animations**

Marching ants: `ctx.lineDashOffset = -self._animationOffset * speed;`
Pulse: `ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(self._animationOffset * freq));`

- [ ] **Step 4: Add animation controls to connection panel**

- [ ] **Step 5: Implement trigger handlers (hover/click)**

In mousemove: if hovering a connection with `animationTrigger === 'hover'`, set `conn._animActive = true`. On leave, set false.
In mousedown: if clicking a connection with `animationTrigger === 'click'`, toggle `conn._animActive`.
Connections with `animationTrigger === 'always'` are always active.

```javascript
// In drawConnection, check if animation should render:
var animType = conn.animationType || 'none';
var animTrigger = conn.animationTrigger || 'always';
var isAnimActive = animType !== 'none' && (animTrigger === 'always' || conn._animActive);
```

- [ ] **Step 6: Auto-start/stop animation loop based on active animations**

Check after every updateView: set `_hasActiveAnimations = true` if any connection has active animation. If true, start loop. If false, stop. Animations work in BOTH edit and view mode.

- [ ] **Step 6: Build and test**

```bash
git add -A && git commit -m "feat: marching-ants and pulse line animations at 30fps"
```

---

## Task 14: Markdown Text Boxes (MVP)

Add textbox shape with basic markdown rendering.

**Files:**
- Modify: `src/visualization_source.js`

- [ ] **Step 1: Add markdown parser**

```javascript
function parseMarkdown(text) {
    var lines = text.split('\n');
    var result = [];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf('## ') === 0) {
            result.push({ type: 'heading', text: line.substring(3) });
        } else if (line.indexOf('- ') === 0) {
            result.push({ type: 'bullet', text: line.substring(2) });
        } else if (line.trim() === '') {
            result.push({ type: 'blank' });
        } else {
            result.push({ type: 'text', text: line });
        }
    }
    return result;
}

function renderMarkdownSpan(text) {
    // Returns array of {text, bold, italic} segments
    var segments = [];
    var regex = /(\*\*[^*]+\*\*|\*[^*]+\*|[^*]+)/g;
    var match;
    while ((match = regex.exec(text)) !== null) {
        var s = match[1];
        if (s.indexOf('**') === 0 && s.lastIndexOf('**') === s.length - 2) {
            segments.push({ text: s.slice(2, -2), bold: true, italic: false });
        } else if (s.indexOf('*') === 0 && s.lastIndexOf('*') === s.length - 1) {
            segments.push({ text: s.slice(1, -1), bold: false, italic: true });
        } else {
            segments.push({ text: s, bold: false, italic: false });
        }
    }
    return segments;
}
```

- [ ] **Step 2: Add textbox rendering in drawNode()**

When shape === 'textbox':
- Draw rounded rect background (no sparkline, no value formatting)
- Parse `nodeState.markdownContent` with `parseMarkdown()`
- Render each line with appropriate font style
- Clip text to node bounds

- [ ] **Step 3: Add "Add Text" button to toolbar**

- [ ] **Step 4: Add Content section to panel for textbox nodes**

Textarea for editing markdown content, replaces Text & Value section.

- [ ] **Step 5: Build and test**

```bash
git add -A && git commit -m "feat: markdown textbox nodes with basic formatting"
```

---

## Task 15: Destroy / Cleanup

Add proper teardown to prevent memory leaks.

**Files:**
- Modify: `src/visualization_source.js`

- [ ] **Step 1: Implement destroy() method**

```javascript
destroy: function() {
    this._stopAnimationLoop();
    if (this._panelEl && this._panelEl.parentNode) {
        this._panelEl.parentNode.removeChild(this._panelEl);
    }
    if (this._panelStrip && this._panelStrip.parentNode) {
        this._panelStrip.parentNode.removeChild(this._panelStrip);
    }
    if (this._editBtn && this._editBtn.parentNode) {
        this._editBtn.parentNode.removeChild(this._editBtn);
    }
    // Remove key listeners
    if (this._keydownHandler) {
        document.removeEventListener('keydown', this._keydownHandler);
    }
    if (this._keyupHandler) {
        document.removeEventListener('keyup', this._keyupHandler);
    }
    this._panelEl = null;
    this._panelStrip = null;
    this._editBtn = null;
    SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
},
```

- [ ] **Step 2: Refactor key listeners to be removable**

Store handlers as named references in initialize:
```javascript
this._keydownHandler = function(e) { /* ... */ };
this._keyupHandler = function(e) { /* ... */ };
document.addEventListener('keydown', this._keydownHandler);
document.addEventListener('keyup', this._keyupHandler);
```

- [ ] **Step 3: Build and commit**

```bash
git add -A && git commit -m "feat: destroy() method with full cleanup"
```

---

## Task 16: Version Bump & Config Updates

Update version, changelog, formatter, and spec file.

**Files:**
- Modify: `default/app.conf` — version 5.0.0
- Modify: `CHANGELOG.md` — add v5.0.0 entry
- Modify: `default/savedsearches.conf` — add new default settings
- Modify: `README/savedsearches.conf.spec` — add new entries, remove editMode

- [ ] **Step 1: Update app.conf version**

Change `version = 4.9.1` to `version = 5.0.0`

- [ ] **Step 2: Update savedsearches.conf.spec**

Add 9 new entries (rawValue, shadow*, glow*), remove editMode.

- [ ] **Step 3: Update savedsearches.conf**

Add default values for new settings in the demo saved search.

- [ ] **Step 4: Write CHANGELOG entry**

Comprehensive v5.0.0 entry listing all new features.

- [ ] **Step 5: Build final package**

```bash
cd /path/to/repo && ./build.sh business_process_flow
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "release: Business Process Flow v5.0.0

DOM properties panel, canvas panning, 5 new shapes, stroke patterns,
shadow/glow effects, line animations, markdown textboxes, grid/snap,
multi-select with align/distribute."
```
