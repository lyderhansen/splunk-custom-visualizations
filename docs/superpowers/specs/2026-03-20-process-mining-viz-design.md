# Process Mining Visualization — Design Spec

## Overview

A Splunk custom visualization that renders process mining graphs from raw event sequences. Users provide rows with a case ID, activity name, timestamp, status, and resource — the visualization computes transitions, builds a directed graph, and renders it on Canvas 2D with interactive zoom/pan, hover tooltips, drilldown, and an optional KPI header.

App name: `process_mining`
Display label: "Process Mining"

## Data Model

### Input Columns (all configurable via formatter)

| Column | Formatter Setting | Default | Required | Description |
|--------|------------------|---------|----------|-------------|
| case_id | `caseField` | `case_id` | Yes | Groups events into a process flow |
| activity | `activityField` | `activity` | Yes | The step/activity name (node label) |
| _time | `timeField` | `_time` | Yes | Event timestamp for ordering and duration |
| status | `statusField` | `status` | No | Color-codes nodes (success/error/ok) |
| resource | `resourceField` | `resource` | No | Who/what performed the step (shown in tooltip) |

### Internal Computation (in visualization JS)

1. Group rows by `case_id`, sort each group by `_time`
2. Build transitions: for each case, consecutive activity pairs → `(A → B)`
3. Aggregate: count per node, count per edge, avg/median duration per edge
4. Add synthetic `Start` node (before first activity per case) and `End` node (after last activity per case)
5. Compute KPIs: case count, activity count, median/avg case duration, self-loop %, variant count

### Example SPL

```spl
index=fake_tshrt sourcetype IN (fake:access_combined, FAKE:azure:servicebus, FAKE:online:order, FAKE:online:order:registry, FAKE:sap:auditlog)
| eval case_id=tshirtcid, activity=sourcetype, status=coalesce(status, http_status, "ok"), resource=coalesce(user, host)
| table _time case_id activity status resource
| sort case_id _time
```

## Graph Layout Algorithm (Pure Canvas 2D)

Layered layout algorithm (Sugiyama-inspired), implemented from scratch with no external dependencies:

1. **Build graph** — nodes = unique activities + Start/End, edges = transitions with count
2. **Cycle breaking** — detect back-edges (cycles) via DFS, temporarily reverse them to produce a DAG
3. **Level assignment** — BFS from Start, each step = one level down (top-down) or right (left-right)
4. **Crossing minimization** — for each level, sort nodes to minimize crossing edges (barycenter heuristic)
5. **Positioning** — distribute nodes evenly within each level, center relative to neighbors
6. **Edge routing** — quadratic bezier curves between nodes with arrowheads. Self-loops drawn as a small arc back to the same node.

### Node Rendering

- Circle with activity name and count inside (e.g., "133 Invoice Entry")
- Color based on most common `status` for that activity — configurable color scale
- Default: grey (`#607d8b`) for ok, green (`#4caf50`) for success, red (`#f44336`) for error
- Start node: dark filled circle
- End node: double circle

### Edge Rendering

- Quadratic bezier curves with arrowhead
- Thickness proportional to count (min 1px, max 6px)
- Count label at midpoint of edge
- Color: configurable (default `#90a4ae`)

### Layout Direction

Configurable via formatter: `top-down` (default) or `left-right`.

## Interactions

### Zoom/Pan

- Scroll wheel for zoom (centered on mouse position)
- Click-and-drag on empty background for pan
- Internal transform state: `translateX`, `translateY`, `scale`
- Zoom buttons (+/-) bottom-left, "fit to view" button to reset

### Hover Tooltip

- Hit-testing against nodes (circle radius) and edges (proximity to bezier curve)
- Node tooltip: activity name, count, avg duration, most common status, resources
- Edge tooltip: from → to, count, avg/median duration between steps
- Drawn as Canvas rectangle with text (not DOM)

### Hover Effect

- Node: lighter color + thicker border on hover
- Edge: highlight full path (from-node → edge → to-node)
- Cursor changes to pointer over clickable elements

### Drilldown

- Click on node → fire `FIELD_VALUE_DRILLDOWN` with activity name
- Configurable drilldown field via formatter (`drilldownField`, default = activity field value)

## KPI Header

Configurable toggle (`showKPIs`, default: `true`). When active, reserves ~60px at top for a row of key metrics.

| KPI | Calculation |
|-----|-------------|
| Cases | Count of unique `case_id` |
| Activities | Count of unique activities |
| Median case duration | Median of (last _time - first _time) per case |
| Avg case duration | Average of same |
| Self-loop % | Proportion of cases with A→A transitions |
| Variants | Count of unique path sequences (A→B→C vs A→C→B) |

Drawn evenly distributed across width, each as label + large value. Duration formatted as "Xd Yh Zm".

KPI value color configurable (default: `#00bcd4` — cyan).

## Formatter Settings

Six formatter tabs:

### Fields Tab

| Setting | Type | Default |
|---------|------|---------|
| `caseField` | text | `case_id` |
| `activityField` | text | `activity` |
| `timeField` | text | `_time` |
| `statusField` | text | `status` |
| `resourceField` | text | `resource` |

### Layout Tab

| Setting | Type | Default |
|---------|------|---------|
| `layoutDirection` | radio (top-down / left-right) | `top-down` |

### Appearance Tab

| Setting | Type | Default |
|---------|------|---------|
| `nodeColor` | color-picker | `#607d8b` |
| `edgeColor` | color-picker | `#90a4ae` |
| `successColor` | color-picker | `#4caf50` |
| `errorColor` | color-picker | `#f44336` |

### KPIs Tab

| Setting | Type | Default |
|---------|------|---------|
| `showKPIs` | radio (true/false) | `true` |
| `kpiColor` | color-picker | `#00bcd4` |

### Labels Tab

| Setting | Type | Default |
|---------|------|---------|
| `showEdgeLabels` | radio (true/false) | `true` |
| `showNodeCounts` | radio (true/false) | `true` |

### Drilldown Tab

| Setting | Type | Default |
|---------|------|---------|
| `drilldownField` | text | `activity` |

## Technical Constraints

- ES5 only (var, function, for — no const/let/arrow)
- Pure Canvas 2D rendering, no external dependencies
- Handle HiDPI, null ctx, zero-size canvas
- Transparent CSS background by default
- Never read config in formatData — only in updateView
- JS defaults must match formatter HTML defaults
- All settings documented in savedsearches.conf.spec
