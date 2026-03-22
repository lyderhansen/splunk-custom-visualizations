# Business Process Flow v5 Roadmap

## Current State (v4.9.1)
- 206KB source, 74KB bundled
- Node editing: shape, color, value, prefix/suffix, sparkline position, conditional formatting
- Connection editing: 8 endpoint types, waypoints, anchors, flip direction, labels
- Edit mode via DOM button, copy-to-clipboard save, inline JSON editor
- Undo/redo (50 steps), glow hover, draggable anchors/labels/waypoints

## Planned Features (Priority Order)

### 1. Static Properties Panel (Right Side)
Replace canvas-drawn popups with a DOM-based panel on the right side of the viz.
- Shows properties for selected node OR connection
- Scrollable, always visible in edit mode
- When nothing selected: shows global settings
- Similar to Figma/OmniGraffle inspector panel
- Implementation: DOM div, positioned absolute right:0, width ~280px

### 2. Quick Fixes
- **Truncate toggle**: Per-node "Raw Value" option to show 12450 instead of 12K
- **Border radius per node**: Slider/toggles in popup (0, 4, 8, 12, 20, 50)
- **Border radius global**: Formatter setting that applies to all nodes

### 3. Grid & Snap
- Visual grid (dots or lines) in edit mode
- Configurable grid size (10, 20, 50px)
- Snap-to-grid on drag end
- Align buttons in toolbar: align left, center, right, top, middle, bottom
- Distribute evenly horizontal/vertical

### 4. More Shapes (~15)
Canvas-drawn paths:
- rect, rounded-rect, circle, diamond, hexagon, pentagon
- triangle (up/down/left/right), arrow-right, arrow-left
- star, cylinder, cloud, cross/plus, pill/capsule
- parallelogram

### 5. Stroke Patterns
For both nodes and connections:
- Solid (current)
- Dashed (current)
- Dotted
- Dash-dot
- Long dash
- Double line
Implement via setLineDash() with different patterns

### 6. Visual Effects
- **Drop shadow per node**: configurable blur, offset, color
- **Glow per node**: outer glow with configurable color and blur
- **Both stored in editorState**: shadow: {blur, offsetX, offsetY, color}, glow: {blur, color}

### 7. Line Animations
- Marching ants effect (dashed line that moves)
- Direction follows connection flow
- Trigger: always, hover, click
- Speed: slow, medium, fast
- Implementation: setInterval + dash offset animation

### 8. Markdown Text Boxes
- New node type: "textbox" shape
- Supports basic markdown: **bold**, *italic*, ## headings, - lists
- Rendered with Canvas text (parse markdown to styled text spans)
- No data binding — purely manual content

### 9. More Node Properties
- Text alignment (left/center/right)
- Label color override
- Value color override
- Background color override
- Padding (compact/normal/spacious)
- Node content layout modes (already partially implemented with sparkPosition)

## Architecture Notes
- visualization_source.js is ~206KB — consider splitting drawing functions
- DOM panel approach will reduce canvas popup complexity significantly
- Grid rendering should be efficient (only draw visible grid lines)
- Animations need requestAnimationFrame or setInterval with cleanup in destroy()
- All new properties go through computeNodePositions → drawNode pipeline

## File
`examples/business_process_flow/appserver/static/visualizations/business_process_flow/src/visualization_source.js`
