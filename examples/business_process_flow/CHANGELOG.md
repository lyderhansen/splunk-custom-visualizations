# Business Process Flow — Changelog

## v5.1.0 — 2026-03-23
- **Bug fixes & cleanup** — 688 lines of dead code removed, 4 memory/undo bugs fixed
  - Fixed memory leak: `_syncInterval` and canvas event listeners now cleaned up in `destroy()`
  - Fixed undo bug: multi-select property changes now capture pre-mutation state
  - Fixed `defaultOpacity` config mismatch between formatter and savedsearches.conf
  - Removed unused functions: `drawNodePopup`, `drawConnectionPopup`, `evalConditionsAll`, `lerpColor`, `pointNearLine`, `pointNearBezier`, `drawArrowhead`, `applyStrokePattern`
- **Connection label styling** — Font size, text/bg/border color, border style/width/radius
- **Labels snap to line** — Drag labels along the connection path, `labelPosition` (0-1) replaces free X/Y offset
- **Visible line animations** — Marching ants use lighter line color + glow, pulse has width oscillation + shadow
- **Animation hover trigger fixed** — `_animActive` now passed through computed connections
- **Condition presets** — Traffic Light, Binary, Heat Map, Status Text with auto-calculated thresholds
- **Dynamic Elements** — Splunk-style condition target selector (None/Value/Trend/Val+Trend/BG/Border/Spark/All)
- **Readable condition rules** — "If value at most 1600" instead of "<= 1600"
- **Reverse Order button** — Flip condition rule order with one click
- **Auto-populated rule values** — New rules calculate thresholds from node value
- **Trend improvements** — Unified color system (conditions > custom up/down > auto green/red), compare marker follows sparkline path
- **Gradient fill** — Custom start/end colors with direction (top-down, left-right, diagonal, radial)
- **Z-order layering** — Send Back / Bring Forward to control node draw order
- **Improved inner shadow** — Casts from all 4 edges, stronger on dark backgrounds
- **Connection hit testing** — Robust closest-match using actual rendered geometry (curves + waypoints)
- **Layout JSON editor** — S/M/L/Max size presets
- **Sparkline enhancements** — Dot and Step chart types, Right position, custom chart height in all positions
- **Sparkline hover overlay** — Crosshair + value tooltip on hover
- **Panel stability** — Section open/close state and scroll preserved on refresh, event isolation
- **Compact numeric spinners** — Fixed height 28px, smaller arrow buttons
- **Color picker in formatter** — `<splunk-color-picker>` for Default Background, Border, Shadow, Glow colors
- **Grid on by default** — Grid enabled when entering edit mode
- **Align buttons** — Visual icons grouped by Horizontal/Vertical/Distribute

## v5.0.0 — 2026-03-22
- **DOM Properties Panel** — Right-side inspector panel replaces all canvas popups
  - Collapsible sections: Appearance, Text & Value, Sparkline, Effects, Conditions
  - Connection panel: Style, Endpoints, Anchors, Label, Animation
  - Canvas Tools: Grid, Snap, Align, Distribute
  - Multi-select: shared property editing
  - Collapse/expand toggle (» / «)
  - Light/dark theme support
- **Canvas Panning** — Space+drag to pan, Fit button resets
- **Multi-Select** — Shift+click and rubber-band drag selection
  - Move all selected nodes together
  - Align: left/center/right/top/middle/bottom
  - Distribute: horizontal/vertical
- **5 New Shapes** — Hexagon, triangle, cylinder, cloud, pill
- **Stroke Patterns** — Solid, dashed, dotted, dash-dot, long-dash for nodes and connections
- **Shadow & Glow** — Per-node and global drop shadow and outer glow effects
- **Raw Value Toggle** — Show full numbers (12,450) instead of abbreviated (12K)
- **Text Properties** — Per-node text alignment, label/value colors, padding
- **Line Animations** — Marching ants and pulse effects with trigger (always/hover/click) and speed controls
- **Markdown Text Boxes** — New textbox shape with heading, bold, italic, bullet list support
- **Grid & Snap** — Dot grid overlay, snap-to-grid on drag, configurable grid size (10/20/50px)

## v4.9.1 — 2026-03-22 21:00
- **Fix: curved line selection** — Hit testing now samples bezier curve (10 points) instead of testing straight segment. Curved lines can now be clicked/hovered properly.
- **Auto-fit value text** — Values auto-shrink font to fit node width instead of truncating. Long numbers like "1,234,567" or "$45,678 events" shrink gracefully.
- **Fix: rule overflow** — Popup height now accounts for conditional formatting rules count

## v4.9.0 — 2026-03-22 20:30
- **Conditional formatting** — Per-node color rules based on value
  - Operators: `<`, `<=`, `>`, `>=`, `=`, `!=`, `contains`
  - Works with numeric values (0-10 green, 10-30 yellow, 30+ red)
  - Works with text matching ("error" = red, "info" = green)
  - Rules evaluated top-to-bottom, first match wins
  - Matching rule sets: subtle background tint (15% opacity), colored border
  - Node popup shows rules list with inline editor (operator dropdown + value input + color picker)
  - Add/delete rules with + Rule button and × icons

## v4.8.1 — 2026-03-22 20:05
- **Fix: flipped endpoint positioning** — When an endpoint direction is flipped, the arrow/icon is now shifted outward along the line by 80% of its size, preventing it from overlapping or hiding inside the node shape

## v4.8.0 — 2026-03-22 19:50
- **Sparkline position per node** — New "Spark" row in node popup with 4 layout options:
  - **Below** (default): label top, value middle, sparkline at bottom
  - **Above**: sparkline in top half, label and value below
  - **Behind**: sparkline fills entire node background, text overlays on top
  - **Left**: sparkline on left 45%, text on right 55%
- **Duplicate delete button removed** — Single ✕ in toolbar

## v4.7.0 — 2026-03-22 19:30
- **Flip direction per endpoint** — Each Start/End row has a flip button (🔄) that reverses the arrow direction
  - Default Start: ◀ (points toward source) → Flipped: ▶ (points away from source)
  - Default End: ▶ (points toward target) → Flipped: ◀ (points away from target)
  - All 4 combinations: `◀───▶` `◀───◀` `▶───▶` `▶───◀`
- **Visual flip indicator** — Flip button turns amber when active, icons swap direction in real-time
- **Stored as** `startFlipped`/`endFlipped` boolean in editorState

## v4.6.1 — 2026-03-22 19:15
- **Fix: Start/End endpoint icons show direction** — Start row uses left-pointing icons (◀◁) and End row uses right-pointing icons (▶▷), making it clear which way each arrow will point
- **Visual clarity** — `◀────▶` is now obvious from the popup: Start=◀ means arrow points toward source, End=▶ means arrow points toward target

## v4.6.0 — 2026-03-22 19:00
- **Undo/Redo system** — Full undo/redo with 50-step history
  - Toolbar buttons: ↩ (undo) and ↪ (redo)
  - Keyboard: Cmd+Z / Ctrl+Z (undo), Cmd+Shift+Z / Ctrl+Y (redo)
  - Tracks all changes: drag, resize, popup edits, connection changes, waypoints
- **Dedicated delete button** — ✖ button in toolbar deletes selected element
  - Deletes: waypoints (under cursor), connections, manual nodes
  - Shows status message: "Waypoint deleted", "Connection deleted", "Node deleted"
  - Shows "Cannot delete data-driven node" for search-driven nodes
  - Shows "Nothing selected" when nothing to delete
- **Status messages** — Blue text in toolbar showing undo/redo/delete feedback
- **Easier curved line waypoint adding** — Doubled hit threshold for double-click on curved lines

## v4.5.4 — 2026-03-22 18:40
- **Fix: start endpoint direction** — Start arrows now correctly point TOWARD the source node (←), giving proper `<---->` bidirectional arrows. Previously both ends pointed in the same direction (→→).

## v4.5.3 — 2026-03-22 18:25
- **Clickable waypoint delete buttons** — Red × icon appears above hovered waypoints; click to delete (no keyboard needed, works in Splunk)
- **Removed keyboard dependency** — Backspace doesn't work in Splunk's context, so all delete actions now have click-based alternatives

## v4.5.2 — 2026-03-22 18:10
- **Better waypoint deletion** — Increased hit radius to 16px, waypoints turn red when hoverable for deletion
- **Delete key support** — Delete/Backspace now also removes selected connections and manual nodes
- **Waypoint visual feedback** — Waypoints glow red when cursor is near (indicating deleteable)
- **Bigger waypoint handles** — 7px selected, 5px unselected (up from 6/4)

## v4.5.1 — 2026-03-22 17:50
- **Fix: circle/diamond anchor points** — Anchors now snap to actual shape boundary (circle radius, diamond edges) instead of bounding rectangle
- **Better line hit testing** — Threshold increased to 16px, hover glow stronger (shadowBlur 16 + line thickens by 2px)
- **Shape-aware anchor offset** — Offset follows circle curvature and diamond edges correctly

## v4.5.0 — 2026-03-22 17:35
- **Removed Edit Mode from formatter** — No more confusing Open/Closed toggle in Dashboard Studio
- **DOM Edit button** — "✎ Edit" button in bottom-right of panel, always visible in view mode, opens edit mode on click. Works in both Search view and Dashboard Studio view mode.
- **Native OS color picker** — Clicking hex row opens system color picker with full RGB/HSL controls, live preview
- **Simplified architecture** — Edit mode is purely session-based, controlled only by the Edit button and Close toolbar button

## v4.4.3 — 2026-03-22 17:25
- **Native OS color picker** — Clicking hex row opens the system color picker (macOS/Windows/Linux) with full RGB/HSL controls, live preview updates node color in real-time as you drag

## v4.4.2 — 2026-03-22 17:10
- **Fix: individual connection selection** — Multiple connections between same nodes can now be selected independently (uses computed index instead of from/to matching)
- **Fix: connection delete** — Deletes only the selected connection, not all connections between same node pair
- **Fix: connection popup** — Edits apply to the correct connection when multiple exist between same nodes

## v4.4.1 — 2026-03-22 16:41
- **Bidirectional arrows** — Start endpoints now point toward node, giving `<---->` instead of `>---->`
- **Connection hover glow** — Lines glow with their color on hover (shadow effect) for easier selection
- **Draggable anchor handles** — Orange circles on selected connections; drag to reposition anchors along node edges with auto-snap to nearest side
- **Color popup fix** — Dynamic height calculation, removed confusing special colors (X/white/black/theme)
- **Hex color input** — Click hex text in node popup to type any color (#ff6b00, rgb(), etc.)
- **Draggable connection labels** — Drag "tcp/9997" labels to any position; stored as labelOffsetX/Y
- **Delete waypoints** — Hover + Delete/Backspace removes waypoint
- **Endpoints render on top of nodes** — Deferred rendering pass ensures arrows/balls/diamonds always visible

## v4.2.0 — 2026-03-22 16:15
- **Waypoints (Pen Tool)** — Double-click on connection to add waypoint; drag to reshape (L-shapes, S-curves)
- **Endpoint size scaling** — Scales with line width (width * 3 + 2), custom override via popup
- **Anchor offsets** — Fine-tune connection points with px offset along node edge
- **Smooth multi-point curves** — Curved style draws quadratic bezier through all waypoints
- **Waypoint hit rects** — Blue circle handles, visible in edit mode, hidden when closed

## v4.1.0 — 2026-03-22 14:27
- **8 endpoint styles** — None, Filled Arrow, Open Arrow, Filled Ball, Ball, Filled Diamond, Diamond, Bar
- **Independent start/end endpoints** — Configure each end separately
- **Connection anchor points** — Auto, Top, Bottom, Left, Right per source/target
- **Legacy arrow migration** — Old forward/backward/both auto-converted
- **Edit mode session-only** — Never persists across page loads
- **Close button** — Exit edit mode from toolbar

## v4.0.0 — 2026-03-22 14:17
- **Prefix/suffix per node** — e.g., "$1,234" or "456 events"
- **Removed "Default" chart option** — Replaced with "Auto" (uses global setting)
- **Edit mode auto-reset** — Always starts closed on page load

## v3.9.0 — 2026-03-22 12:57
- **Apply button fix** — No longer reverts to old state when applying JSON edits

## v3.8.0 — 2026-03-22 12:50
- **Expanded node popup** — 9 configurable rows: Label, Shape, Value, Chart, Font, Graph H, Opacity, Border, Color
- **Per-node settings** — Chart type, font size, chart height, opacity, border width
- **Responsive node rendering** — Text/sparkline scale with node dimensions
- **Shape clipping** — Sparklines correctly clipped inside circles and diamonds

## v3.7.0 — 2026-03-22 12:44
- **Show/hide value per node** — Toggle in node popup
- **Live code editor updates** — JSON editor refreshes when dragging nodes

## v3.6.0 — 2026-03-22 12:37
- **Brighter syntax highlighting** — Keys sky-blue, strings green, numbers orange
- **Live editor refresh** — Skips update when user is typing

## v3.5.0 — 2026-03-22 12:30
- **Inline JSON code editor** — Toggle with { } button; syntax highlighting, Apply button with validation

## v3.4.0 — 2026-03-22 12:28
- **Renamed Save to "Copy Layout"** — Clearer purpose
- **Removed lock button from toolbar** — Lock Nodes stays in formatter settings

## v3.0.0–v3.3.0 — 2026-03-22 12:27
- **Clipboard save** — Copy Layout copies JSON to clipboard via execCommand
- **localStorage caching** — Periodic auto-sync to formatter textarea
- **Transparent canvas** — Inherits dashboard background color
- **Test harness support** — harness.json + manifest registration

## v2.0.0–v2.4.0 — 2026-03-22 (experimental, reverted)
- Modal editor experiments (rendered inside panel due to Splunk iframe constraints)
- Body-level overlay attempts
- DOM edit button (blocked by Dashboard Studio panel overlay)
- All approaches reverted in favor of view-mode editing

## v1.0.0–v1.8.0 — 2026-03-21 22:32 – 2026-03-22
- **Initial scaffolding** — App config, formatter, webpack, README
- **Core visualization** — Data processing, node/connection rendering, sparklines
- **Edit mode toolbar** — Node dragging, save, lock toggle
- **Manual connections** — Add node, add connection, delete, resize
- **Formatting popups** — Node properties, connection formatting
- **Light/dark mode** — Theme detection, 5 color palettes
- **Drilldown + tooltips** — Click nodes for drilldown, hover for info
- **HiDPI support** — devicePixelRatio scaling
- **Event handling fixes** — stopPropagation for Splunk panel drag prevention
- **Node pinning** — All nodes pinned on first drag to prevent layout shift
