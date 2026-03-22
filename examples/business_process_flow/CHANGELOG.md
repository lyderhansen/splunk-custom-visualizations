# Business Process Flow — Changelog

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
