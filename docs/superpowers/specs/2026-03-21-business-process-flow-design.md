# Business Process Flow — Splunk Custom Visualization Design

**Date:** 2026-03-21
**App name:** `business_process_flow`
**Display label:** Business Process Flow

## Purpose

Interactive business process flow visualization for Splunk. Users define process nodes from search data (e.g., sourcetypes with event counts), connect them with editable lines, and arrange them freely — like Visio inside a Splunk dashboard. Node positions, connections, and formatting persist across dashboard reloads.

## Data Format

### Required columns (configurable field names via formatter)

| Column | Type | Description |
|--------|------|-------------|
| label field | string | Node name (e.g., sourcetype) |
| value field | number | Primary numeric value displayed in node |

### Optional columns

| Column | Type | Description |
|--------|------|-------------|
| `step` | integer | Ordering for auto-connections (1→2→3) |
| `connects_to` | string | Comma-separated target node labels (overrides step-based auto-connections) |
| subtitle field | string | Secondary text below value |
| `_time` + series | number | Timechart data for sparklines |

### Connection logic

1. If `step` column exists: auto-connect all step N nodes to all step N+1 nodes
2. If `connects_to` column exists on a node: overrides that node's auto-connections with explicit targets
3. Manual connections (created in edit mode) are stored in viz config, independent of data

### Example SPL (simple)

```spl
| stats count by sourcetype
| eval step=case(sourcetype="syslog",1, sourcetype="firewall",1, sourcetype="ids",2, sourcetype="siem",3)
| table sourcetype count step
```

### Example SPL (with sparkline)

```spl
| tstats count where index=main by sourcetype _time span=10m
| timechart sum(count) as events by sourcetype
```

## Node Design — Minimal Slate

- **Background:** `#1e293b` (dark), `#f1f5f9` (light) with thin border
- **Rounded corners** (configurable radius)
- **Optional accent line** at top (color from palette, togglable in formatter)
- **Content top-to-bottom:**
  - Label (small, muted text)
  - Primary value (large, bold, formatted with `formatCount`)
  - Optional subtitle (secondary field)
  - Optional delta indicator (arrow + change value)
  - Sparkline at bottom — **edge-to-edge** (no side padding), selectable type: line, area, bar
- **Shapes:** rectangle (default), circle, diamond — configurable per node in edit mode
- **Resizable:** drag corners/edges in edit mode to resize

## Connections (Lines)

### Data-driven

- Auto-generated from `step` column (N→N+1)
- Override with `connects_to` column per node

### Manual

- Created in edit mode: click source node → click target node

### Per-line formatting (popup in edit mode)

- Style: straight or curved (bezier)
- Color (from palette or custom)
- Thickness (1-6px)
- Solid / dashed
- Arrow direction: none, forward, backward, both
- Optional label text (e.g., "tcp/9997", "REST API")

## Interaction Model

### View Mode (default)

- Clean rendering of nodes and connections
- Drilldown on node click
- **Lock OFF:** users can drag nodes freely to explore layout (changes NOT saved)
- **Lock ON:** everything locked, view + drilldown only

### Edit Mode (activated via "Edit Mode" toggle in formatter panel)

- Top toolbar appears inside viz panel:
  - **Save** — persists all positions, connections, formatting to viz config
  - **Lock toggle** — controls view mode interactivity
  - **Add Node** — creates empty node (no data) for visual context (e.g., "Internet", "Customer")
  - **Add Connection** — starts draw mode: click source → click target
  - **Delete** — removes selected connection or manual node
  - **Fit to View** — auto-scale and center all nodes
- Drag nodes to reposition
- Resize nodes (drag corners)
- Change shape per node (context menu or property popup)
- Click line → popup for formatting
- All changes require **Save** to persist

## Color Palettes (5, selectable in formatter)

1. **Corporate** — `#3b82f6, #6366f1, #8b5cf6, #0ea5e9, #06b6d4, #14b8a6, #64748b, #475569`
2. **Security/SOC** — `#ef4444, #f97316, #eab308, #22c55e, #06b6d4, #8b5cf6, #ec4899, #64748b`
3. **Earth/Nature** — `#059669, #16a34a, #65a30d, #ca8a04, #d97706, #0d9488, #78716c, #57534e`
4. **Neon/Cyber** — `#00ff88, #00d4ff, #bf5af2, #ff375f, #ffd60a, #ff9f0a, #30d158, #5e5ce6`
5. **Monochrome** — `#f8fafc, #e2e8f0, #94a3b8, #64748b, #475569, #334155, #1e293b, #0f172a`

Nodes auto-assigned colors from selected palette. Individual override per node in edit mode.

## Light / Dark Mode

- Detected via `SplunkVisualizationUtils.getCurrentTheme()`
- **Dark:** dark background, light text, muted borders
- **Light:** light background, dark text, adjusted palette for contrast
- Transparent canvas background — inherits dashboard theme

## State Persistence

All editor state stored as JSON string in viz config (formatter settings):

```json
{
  "nodes": {
    "syslog": { "x": 100, "y": 50, "w": 180, "h": 120, "shape": "rect", "color": "#3b82f6" },
    "manual_1": { "x": 400, "y": 200, "w": 140, "h": 80, "shape": "rect", "label": "Internet", "manual": true }
  },
  "connections": [
    { "from": "syslog", "to": "firewall", "manual": true, "style": "curved", "color": "#475569", "width": 2, "dash": false, "arrow": "forward", "label": "tcp/9997" }
  ],
  "lock": false
}
```

Stored in `display.visualizations.custom.business_process_flow.business_process_flow.editorState`.

Max ~8KB — sufficient for typical business process diagrams (5-30 nodes).

## Formatter Settings Summary

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| labelField | text | sourcetype | Column for node labels |
| valueField | text | count | Column for node values |
| subtitleField | text | (empty) | Column for subtitle text |
| palette | dropdown | corporate | Color palette |
| accentLine | radio | false | Show accent line on top of nodes |
| sparklineType | dropdown | area | Sparkline type: line, area, bar |
| editMode | radio | false | Toggle edit mode toolbar |
| editorState | text (hidden) | {} | JSON blob with all editor state |

## Scope Exclusions (v1)

- No zoom/pan (may add later)
- No undo/redo in edit mode
- No animation on connections
- No grouping/nesting of nodes
- No KV Store persistence (formatter config only)

## Technical Notes

- ES5 only in visualization_source.js (var, function, for loops)
- HiDPI canvas rendering with devicePixelRatio
- Canvas-based hit testing for click/drag interactions
- Follow existing project patterns from process_mining viz for interaction architecture
