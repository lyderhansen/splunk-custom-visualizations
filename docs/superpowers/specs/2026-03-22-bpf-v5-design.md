# Business Process Flow v5 — Design Spec

## Overview

Major upgrade to the Business Process Flow visualization (currently v4.9.1). Replaces canvas-drawn popups with a DOM-based properties panel, adds canvas panning, new shapes, visual effects, grid/snap, stroke patterns, line animations, and markdown text boxes.

**Constraints:**
- Stays within `/splunk-viz` pattern: ES5 only, AMD module, Canvas 2D, vanilla DOM
- No React, no new npm dependencies — panel built with `document.createElement()`
- Panel styled to match Splunk UI design language (colors, spacing, typography)
- Global defaults live in Splunk's formatter.html; per-element overrides in the panel
- Local overrides always take precedence over global defaults

## 1. Properties Panel

### Architecture
- **DOM-based**: vanilla JS, `document.createElement()` — same pattern as the existing Edit button
- **Hybrid overlay** with collapse toggle (`»` / `«`)
- Expanded width: ~280px. Collapsed: ~24px thin strip with vertical "Properties" label
- Positioned `absolute; right:0; top:{toolbarH}px; bottom:0` inside `this.el`
- Only visible when `_editMode === true`
- Content area: `overflow-y: auto` for scrolling

### Replaces Canvas Popups
- `drawNodePopup()` — removed entirely
- `drawConnectionPopup()` — removed entirely
- All popup state vars (`_showNodePopup`, `_showConnPopup`, `_nodePopupHits`, `_connPopupRect`, etc.) — removed
- Click on node/connection in edit mode → panel shows that element's properties
- Click on empty canvas → panel shows Canvas Tools

### Panel States

**Node selected** — collapsible sections:
| Section | Properties |
|---------|-----------|
| Appearance | Shape (rect, circle, diamond, hexagon, triangle, cylinder, cloud, pill), Color (palette swatches + hex input + native picker), Border radius (0/4/8/12/20/50), Opacity (100/80/60/40%), Stroke pattern (solid/dashed/dotted/dash-dot/long-dash), Border width (none/thin/med/thick) |
| Text & Value | Label (text input), Show/Hide value, Raw value toggle (12K vs 12,450), Prefix (text input), Suffix (text input), Font size (auto/S/M/L/XL), Text alignment (left/center/right), Label color override, Value color override |
| Sparkline | Chart type (auto/line/area/bar/off), Position (below/above/behind/left), Chart height (auto/S/M/L) |
| Effects | Shadow: on/off, blur, offsetX, offsetY, color. Glow: on/off, blur, color |
| Conditions | Rule list (operator + value + color), Add/delete rules |

**Connection selected** — collapsible sections:
| Section | Properties |
|---------|-----------|
| Style | Line style (straight/curved), Width (1/2/3/4), Stroke pattern (solid/dashed/dotted/dash-dot/long-dash), Color (palette + hex + picker) |
| Endpoints | Start type (8 types) + flip, End type (8 types) + flip, Endpoint size |
| Anchors | Source anchor (auto/top/bottom/left/right), Target anchor, Source offset, Target offset |
| Label | Label text, (drag position stored in editorState) |
| Animation | Type (none/marching-ants/pulse), Trigger (always/hover/click), Speed (slow/medium/fast) |

**Nothing selected** — Canvas Tools:
| Property | Controls |
|----------|---------|
| Grid | On/off toggle |
| Grid size | 10 / 20 / 50 px buttons |
| Snap | On/off toggle |
| Align | Left / Center / Right / Top / Middle / Bottom buttons (multi-select) |
| Distribute | Horizontal / Vertical buttons (multi-select) |

### Collapsible Section Behavior
- Each section header: `▶ Section Name` (collapsed) / `▼ Section Name` (expanded)
- Collapsed sections show summary text right-aligned (e.g., "Area · Below", "2 rules", "None")
- Click header to toggle
- Default: first two sections expanded, rest collapsed
- Section state is session-only (not persisted)

### Styling
- Inspired by Splunk UI design tokens
- Dark theme: `#0f172a` background, `#334155` borders, `#cbd5e1` text, `#fbbf24` accent for selected element name
- Light theme: appropriate contrast equivalents
- Buttons: pill-style toggles, active state with subtle highlight
- Color swatches: small squares with border on selected
- Text inputs: dark background, subtle border, focus ring
- Section headers: slightly darker background strip

### Communication with Canvas
- Panel DOM events call methods on the visualization instance
- Pattern: `self._editorState.nodes[nodeId].property = value; self._pushUndo(); self.invalidateUpdateView();`
- Same undo/redo integration as current canvas popups
- Panel re-renders when selection changes (triggered from canvas click handlers)

## 2. Canvas Panning

### Interaction
- Hold **Space** key + mouse drag = pan canvas
- Cursor changes to grab/grabbing hand during pan
- Space key alone does nothing (only activates pan mode)

### Implementation
- New state: `_panX = 0`, `_panY = 0`, `_isPanning = false`, `_spaceHeld = false`
- `keydown` space → `_spaceHeld = true`, cursor = 'grab'
- `keyup` space → `_spaceHeld = false`, cursor = 'default'
- `mousedown` while `_spaceHeld` → `_isPanning = true`, cursor = 'grabbing'
- `mousemove` while `_isPanning` → `_panX += dx`, `_panY += dy`
- `mouseup` → `_isPanning = false`

### Rendering
- `ctx.save(); ctx.translate(_panX, _panY);` before drawing nodes/connections
- `ctx.restore()` after — toolbar and panel are NOT panned
- Grid dots also translate with pan offset

### Hit Testing
- All hit test coordinates adjusted: `testX = mouseX - _panX`, `testY = mouseY - _panY`
- Toolbar hit testing is NOT adjusted (toolbar is fixed)

### Reset
- "Fit" button (⊞) resets `_panX = 0`, `_panY = 0`

## 3. New Shapes (+5)

### Shape Definitions
Each shape is a Canvas path function: `drawShapePath(ctx, x, y, w, h)`

| Shape | Path Description |
|-------|-----------------|
| hexagon | 6-sided polygon, pointy top/bottom |
| triangle | Equilateral triangle pointing up (can be rotated in future) |
| cylinder | Rectangle with elliptical top/bottom caps |
| cloud | Overlapping circles forming cloud outline |
| pill | Rectangle with fully rounded ends (radius = height/2) |

### Integration Points
- Shape selector in panel: row of small shape icons/buttons
- `drawNode()`: switch on shape type to call appropriate path function
- Hit testing: per-shape point-in-polygon or bounding check
- Anchor points: calculated on actual shape boundary (not bounding rect)
- `getEdgeConnectionPoint()`: updated per shape for connection endpoints

### editorState
- `_editorState.nodes[id].shape` — string: 'rect', 'circle', 'diamond', 'hexagon', 'triangle', 'cylinder', 'cloud', 'pill'

## 4. New Node Properties

### Raw Value Toggle
- Per-node: `_editorState.nodes[id].rawValue` — boolean, default false
- Global: new formatter setting `rawValue` (default "false")
- When true: display raw number with locale formatting (12,450 instead of 12K)
- Local overrides global

### Border Radius Per Node
- Per-node: `_editorState.nodes[id].borderRadius` — number or "default"
- Global: existing formatter setting `nodeRadius` (default 8)
- Values: 0, 4, 8, 12, 20, 50
- Local overrides global
- Only applies to rect shape (other shapes have inherent geometry)

### Shadow (flat properties)
- Per-node: `_editorState.nodes[id].shadowEnabled` (bool), `.shadowBlur` (number), `.shadowOffsetX` (number), `.shadowOffsetY` (number), `.shadowColor` (string)
- Global: formatter settings `shadowEnabled`, `shadowBlur`, `shadowOffsetX`, `shadowOffsetY`, `shadowColor`
- Rendered via `ctx.shadowBlur`, `ctx.shadowOffsetX`, `ctx.shadowOffsetY`, `ctx.shadowColor`
- Must reset shadow after drawing node (rule 5 from /splunk-viz)
- Local overrides global

### Glow (flat properties)
- Per-node: `_editorState.nodes[id].glowEnabled` (bool), `.glowBlur` (number), `.glowColor` (string)
- Global: formatter settings `glowEnabled`, `glowBlur`, `glowColor`
- Rendered via `ctx.shadowBlur` + `ctx.shadowColor` with zero offset
- Local overrides global

### Text Properties
- `_editorState.nodes[id].textAlign` — 'left', 'center', 'right' (default: 'center')
- `_editorState.nodes[id].labelColor` — hex string or null (uses theme default)
- `_editorState.nodes[id].valueColor` — hex string or null (uses theme default)
- `_editorState.nodes[id].padding` — 'compact', 'normal', 'spacious' (default: 'normal')

## 5. Stroke Patterns

### Pattern Definitions
| Name | setLineDash() | Description |
|------|--------------|-------------|
| solid | `[]` | Continuous line |
| dashed | `[8, 4]` | Current dashed style |
| dotted | `[2, 3]` | Small dots |
| dash-dot | `[8, 4, 2, 4]` | Alternating dash and dot |
| long-dash | `[16, 6]` | Long dashes |

### Application
- **Nodes**: border stroke pattern — `_editorState.nodes[id].strokePattern` (default: 'solid')
- **Connections**: line pattern — replaces boolean `dash` with `_editorState.connections[i].strokePattern`
- Backward compatibility: `dash: true` maps to `strokePattern: 'dashed'`

## 6. Line Animations

### Types
| Type | Implementation |
|------|---------------|
| marching-ants | `setLineDash()` with offset incremented per frame via `requestAnimationFrame` |
| pulse | Sinusoidal oscillation of line opacity (0.4–1.0) and width (±1px) |

### Properties (per connection, flat keys)
- `_editorState.connections[i].animationType` — `'none'|'marching-ants'|'pulse'` (default: undefined/none)
- `_editorState.connections[i].animationTrigger` — `'always'|'hover'|'click'` (default: 'always')
- `_editorState.connections[i].animationSpeed` — `'slow'|'medium'|'fast'` (default: 'medium')

### Speed Mapping
| Speed | marching-ants (offset/frame) | pulse (frequency) |
|-------|----------------------------|--------------------|
| slow | 0.5 | 0.5 Hz |
| medium | 1.5 | 1.0 Hz |
| fast | 3.0 | 2.0 Hz |

### Animation Loop
- Single `requestAnimationFrame` loop when any connection has `trigger: 'always'` or is in active state
- Loop calls `invalidateUpdateView()` each frame
- When no animations active, loop stops (no wasted frames)
- Cleanup in `destroy()`: cancel animation frame

### Trigger Behavior
- `always`: animation runs continuously
- `hover`: starts on mouse enter connection, stops on leave
- `click`: toggles on/off per click on connection

## 7. Markdown Text Boxes (MVP)

### Shape Type
- New shape: `'textbox'` — created via "Add Node" or new "Add Text" button
- No data binding — purely manual content
- Default size: wider than regular nodes (200×120)

### Supported Markdown (MVP)
| Syntax | Rendering |
|--------|----------|
| `## Heading` | Bold, larger font (1.4× base) |
| `**bold**` | Bold weight |
| `*italic*` | Italic style |
| `- item` | Bullet list with indent |
| Plain text | Normal paragraph |

### Rendering
- Parse markdown text line-by-line into styled segments
- Draw with `ctx.fillText()` using appropriate font style per segment
- Word wrap within node width minus padding
- Overflow: clip to node bounds

### Panel Integration
- "Text & Value" section replaced with "Content" section for textbox nodes
- Contains a textarea for editing markdown content
- Live preview on canvas as user types

## 8. Grid & Snap

### Grid
- **Visual**: dots pattern drawn on canvas (behind nodes, after clear)
- **Only in edit mode**
- Dots: small circles (1.5px radius), subtle color (`rgba(255,255,255,0.1)` dark / `rgba(0,0,0,0.1)` light)
- Grid translates with pan offset
- Only draw dots within visible canvas bounds (efficient)

### Grid Size
- Options: 10, 20, 50 px
- Selector in panel Canvas Tools section
- Default: 20px
- Session-only (not persisted in editorState)

### Snap
- When enabled: on drag end, round node position to nearest grid point
- `snapX = Math.round(x / gridSize) * gridSize`
- Toggle in panel Canvas Tools section
- Default: off

### Align & Distribute (Multi-Select Required)
- **Prerequisite**: multi-select nodes (Shift+click or drag-select box)
- New state: `_selectedNodeIds` — array (replaces single `_selectedNodeId` for multi)

**Align buttons** (in panel Canvas Tools):
| Button | Action |
|--------|--------|
| Align Left | Set all selected nodes' x to min(x) |
| Align Center | Set all x to avg(x + w/2) - w/2 |
| Align Right | Set all x to max(x + w) - w |
| Align Top | Set all y to min(y) |
| Align Middle | Set all y to avg(y + h/2) - h/2 |
| Align Bottom | Set all y to max(y + h) - h |

**Distribute buttons:**
| Button | Action |
|--------|--------|
| Distribute H | Space nodes evenly between leftmost and rightmost |
| Distribute V | Space nodes evenly between topmost and bottommost |

## 9. Formatter Updates

### New Settings in formatter.html
| Setting | Type | Default | Section |
|---------|------|---------|---------|
| `rawValue` | radio (true/false) | false | Appearance |
| `shadowEnabled` | radio (true/false) | false | Effects |
| `shadowBlur` | text (number) | 8 | Effects |
| `shadowOffsetX` | text (number) | 2 | Effects |
| `shadowOffsetY` | text (number) | 2 | Effects |
| `shadowColor` | text (hex) | #000000 | Effects |
| `glowEnabled` | radio (true/false) | false | Effects |
| `glowBlur` | text (number) | 12 | Effects |
| `glowColor` | text (hex) | #3b82f6 | Effects |

### Existing Settings (unchanged)
- labelField, valueField, subtitleField, palette, accentLine, sparklineType, nodeRadius, lock, editorState, drilldownField

## 10. Multi-Select

### Interaction
- **Shift+click**: toggle node in/out of selection
- **Drag on empty space** (without Space): rubber-band selection box
- Selected nodes: all get highlight border
- Drag any selected node: moves all selected nodes together

### State
- `_selectedNodeIds` — array of node IDs (replaces `_selectedNodeId`)
- Single click without Shift: clears to single selection
- Panel shows "X nodes selected" when multi-selected, with align/distribute buttons

## 11. Migration / Backward Compatibility

### strokePattern
- Old: `connections[i].dash` (boolean)
- New: `connections[i].strokePattern` (string)
- Migration: if `dash === true` and no `strokePattern`, treat as `strokePattern: 'dashed'`
- If `dash === false` and no `strokePattern`, treat as `strokePattern: 'solid'`

### selectedNodeId → selectedNodeIds
- Internal state only, not persisted — no migration needed

## 12. Keyboard / Focus Safety

### Space-for-Pan vs Text Input
- `keydown` handler for Space must check `document.activeElement`
- If active element is `input`, `textarea`, or `select` → do NOT activate pan mode
- Panel text inputs (label, prefix, suffix, hex color, markdown) must receive normal keyboard input

### Drag Priority
- Active drag operations (node, anchor, waypoint, label, resize) take precedence over pan
- Pan mode only activates if `_isDragging === false && _isResizing === false && _isDraggingWaypoint === false && _isDraggingAnchor === false && _isDraggingLabel === false`

## 13. Destroy / Cleanup

### destroy() Method
- Remove panel DOM element from `this.el`
- Remove Edit button DOM element
- Cancel `requestAnimationFrame` if animation loop active
- Remove `keydown`/`keyup` listeners from `document` (Space key for pan)
- Null all DOM references to prevent memory leaks
- Call `SplunkVisualizationBase.prototype.destroy.apply(this, arguments)`

## 14. Backward Compatibility — Full Details

### New Node Properties (all default to undefined/null)
- `rawValue`, `borderRadius`, `shadow`, `glow`, `textAlign`, `labelColor`, `valueColor`, `padding`, `strokePattern`, `markdownContent`
- Implementation MUST use defensive reads: `var val = nodeState.rawValue || false;`
- Existing v4.9.1 layouts load without changes

### strokePattern Migration
- If `connections[i].dash === true` and no `strokePattern` → treat as `'dashed'`
- If `connections[i].dash === false` and no `strokePattern` → treat as `'solid'`
- New saves write `strokePattern` only (no `dash` key)

### Flat Property Schema
- To maintain consistency with existing flat properties, shadow/glow/animation use flat keys:
  - Node: `shadowEnabled`, `shadowBlur`, `shadowOffsetX`, `shadowOffsetY`, `shadowColor`, `glowEnabled`, `glowBlur`, `glowColor`
  - Connection: `animationType`, `animationTrigger`, `animationSpeed`
- This matches existing patterns like `startEndpoint`, `endEndpoint`, `startFlipped`, `endFlipped`

### _selectedNodeId → _selectedNodeIds Audit
All code paths referencing `_selectedNodeId` must be migrated:
- Toolbar delete handler
- Popup rendering (replaced by panel)
- Node drag start/move/end
- Click handlers (single click, shift+click)
- Keyboard handlers (Escape to deselect)
- Connection creation (source/target selection)
- Resize handle rendering
- Code editor JSON generation
- Undo/redo state capture

### Clean Up editMode in savedsearches.conf.spec
- Remove `editMode` entry — it was removed from formatter in v4.5.0 but the spec entry was never cleaned up

## 15. Formatter Additions — Full Detail

### New formatter.html Settings
```html
<!-- Effects section -->
<form class="splunk-formatter-section" section-label="Effects">
    <splunk-control-group label="Raw Value" help="Show full numbers instead of abbreviated (12,450 vs 12K)">
        <splunk-radio-input name="{{VIZ_NAMESPACE}}.rawValue" value="false">
            <option value="true">Yes</option>
            <option value="false">No</option>
        </splunk-radio-input>
    </splunk-control-group>
    <splunk-control-group label="Shadow" help="Drop shadow on nodes">
        <splunk-radio-input name="{{VIZ_NAMESPACE}}.shadowEnabled" value="false">
            <option value="true">Yes</option>
            <option value="false">No</option>
        </splunk-radio-input>
    </splunk-control-group>
    <splunk-control-group label="Shadow Blur" help="Shadow blur radius in pixels">
        <splunk-text-input name="{{VIZ_NAMESPACE}}.shadowBlur" value="8">
        </splunk-text-input>
    </splunk-control-group>
    <splunk-control-group label="Shadow Offset X" help="Horizontal shadow offset">
        <splunk-text-input name="{{VIZ_NAMESPACE}}.shadowOffsetX" value="2">
        </splunk-text-input>
    </splunk-control-group>
    <splunk-control-group label="Shadow Offset Y" help="Vertical shadow offset">
        <splunk-text-input name="{{VIZ_NAMESPACE}}.shadowOffsetY" value="2">
        </splunk-text-input>
    </splunk-control-group>
    <splunk-control-group label="Shadow Color" help="Shadow color (hex)">
        <splunk-text-input name="{{VIZ_NAMESPACE}}.shadowColor" value="#000000">
        </splunk-text-input>
    </splunk-control-group>
    <splunk-control-group label="Glow" help="Outer glow effect on nodes">
        <splunk-radio-input name="{{VIZ_NAMESPACE}}.glowEnabled" value="false">
            <option value="true">Yes</option>
            <option value="false">No</option>
        </splunk-radio-input>
    </splunk-control-group>
    <splunk-control-group label="Glow Blur" help="Glow blur radius">
        <splunk-text-input name="{{VIZ_NAMESPACE}}.glowBlur" value="12">
        </splunk-text-input>
    </splunk-control-group>
    <splunk-control-group label="Glow Color" help="Glow color (hex)">
        <splunk-text-input name="{{VIZ_NAMESPACE}}.glowColor" value="#3b82f6">
        </splunk-text-input>
    </splunk-control-group>
</form>
```

### JS Defaults (must match formatter HTML defaults)
```javascript
var rawValue = config[ns + 'rawValue'] === 'true';                    // false
var shadowEnabled = config[ns + 'shadowEnabled'] === 'true';          // false
var shadowBlur = parseInt(config[ns + 'shadowBlur'], 10) || 8;       // 8
var shadowOffsetX = parseInt(config[ns + 'shadowOffsetX'], 10) || 2; // 2
var shadowOffsetY = parseInt(config[ns + 'shadowOffsetY'], 10) || 2; // 2
var shadowColor = config[ns + 'shadowColor'] || '#000000';            // #000000
var glowEnabled = config[ns + 'glowEnabled'] === 'true';             // false
var glowBlur = parseInt(config[ns + 'glowBlur'], 10) || 12;          // 12
var glowColor = config[ns + 'glowColor'] || '#3b82f6';               // #3b82f6
```

### New savedsearches.conf.spec Entries
```
display.visualizations.custom.business_process_flow.business_process_flow.rawValue = <boolean>
display.visualizations.custom.business_process_flow.business_process_flow.shadowEnabled = <boolean>
display.visualizations.custom.business_process_flow.business_process_flow.shadowBlur = <integer>
display.visualizations.custom.business_process_flow.business_process_flow.shadowOffsetX = <integer>
display.visualizations.custom.business_process_flow.business_process_flow.shadowOffsetY = <integer>
display.visualizations.custom.business_process_flow.business_process_flow.shadowColor = <string>
display.visualizations.custom.business_process_flow.business_process_flow.glowEnabled = <boolean>
display.visualizations.custom.business_process_flow.business_process_flow.glowBlur = <integer>
display.visualizations.custom.business_process_flow.business_process_flow.glowColor = <string>
```

## 16. Markdown Textbox — editorState Schema

- `_editorState.nodes[id].shape = 'textbox'`
- `_editorState.nodes[id].markdownContent` — string, the raw markdown text
- `_editorState.nodes[id].manual = true` — textbox nodes are always manual (no data binding)
- Default content: `'## Title\n\nDescription text here'`
- Panel shows "Content" section (textarea) instead of "Text & Value" when shape is textbox

## 17. Animation Performance

- Animation loop throttled to 30fps (not 60fps) — sufficient for marching-ants/pulse, halves CPU cost
- `requestAnimationFrame` with frame skip: only call `invalidateUpdateView()` every other frame
- When no animations are active (all connections have `animationType: 'none'` or undefined), loop stops completely
- Loop auto-restarts when a connection's animation is enabled

## 18. Multi-Select Property Editing

- When multiple nodes selected, panel shows shared properties
- If all selected nodes have same value → show that value
- If values differ → show "Mixed" placeholder
- Changing a property applies to ALL selected nodes
- Conditions section hidden for multi-select (too complex)

## Architecture Notes

- `visualization_source.js` will grow from ~3500 to ~5000+ lines
- Panel DOM creation in `initialize()`, updates via `_updatePanel()` helper
- Consider splitting pure functions (shape paths, markdown parser) into separate files that webpack bundles
- All panel event handlers use `var self = this` pattern (ES5, no arrow functions)
- Grid rendering: only draw visible dots (check bounds before drawing each dot)
- Animation loop: single rAF at 30fps, shared across all animated connections
