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

### Lifecycle Method Responsibilities

- **`getInitialDataParams`**: `count: 10000`. If event volume exceeds 10,000 rows, the graph represents a sample. Consider pre-aggregating transitions in SPL for larger datasets.
- **`formatData`**: Build `colIdx` map from `data.fields`, pass through raw `data.rows` array. Cache result on `_lastGoodData` for real-time robustness. No config reading, no computation.
- **`updateView`**: Read all field settings from config, then run the full pipeline: group by case, sort by time, build transitions, compute KPIs, run layout algorithm, render to Canvas. If `data` is falsy, fall back to `_lastGoodData`.

### Internal Computation (all in updateView)

1. Group rows by `case_id`, sort each group by `_time` (tiebreaker: row order for identical timestamps)
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
- Radius: proportional to count (min 30px, max 60px), with text auto-sized to fit
- Activity names longer than 20 characters truncated with ellipsis
- Color based on most common `status` for that activity — configurable color scale
- Default: grey (`nodeColor` / `#607d8b`) for ok/unknown/no status field, green (`successColor`) for success, red (`errorColor`) for error
- If `statusField` column is absent, all nodes use `nodeColor`
- Start node: dark filled circle (smaller, 20px radius)
- End node: double circle (smaller, 20px radius)

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

- Hit-testing against nodes (point-in-circle) and edges (sample 20 points along bezier, hit if mouse within 6px of any sample)
- Node tooltip: activity name, count, avg duration, most common status, resources
- Edge tooltip: from → to, count, avg/median duration between steps
- Drawn as Canvas rectangle with text (not DOM)

### Hover Effect

- Node: lighter color + thicker border on hover
- Edge: highlight full path (from-node → edge → to-node)
- Cursor changes to pointer over clickable elements

### Drilldown

- Click on node → fire drilldown with activity name:
  ```javascript
  var drilldownData = {};
  drilldownData[drilldownField] = activityName;
  self.drilldown({
      action: SplunkVisualizationBase.FIELD_VALUE_DRILLDOWN,
      data: drilldownData
  }, event);
  ```
- Configurable drilldown field via formatter (`drilldownField`, default = activity field value)
- Edge clicks: no drilldown (edges represent transitions, not individual events)

## KPI Header

Configurable toggle (`showKPIs`, default: `true`). When active, reserves ~60px at top for a row of key metrics.

| KPI | Calculation |
|-----|-------------|
| Cases | Count of unique `case_id` |
| Activities | Count of unique activities |
| Median case duration | Median of (last _time - first _time) per case |
| Avg case duration | Average of same |
| Self-loop % | Percentage of cases that contain at least one consecutive duplicate activity (A→A) |
| Variants | Count of unique path sequences (A→B→C vs A→C→B) |

Drawn evenly distributed across width, each as label + large value. Duration formatted as "Xd Yh Zm" (durations under 1 minute show "< 1m", zero-duration cases counted as 0 in averages).

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

## Edge Cases

- **Empty data (zero rows)**: Throw `VisualizationError('Awaiting data — Process Mining')`. After first successful render, return `_lastGoodData` instead.
- **Single activity across all cases**: Renders normally as Start → A → End.
- **Cases with a single event**: Produces Start → A → End with zero duration. Counted as 0 in avg/median calculations.
- **Missing timestamps**: Rows with null/unparseable `_time` are silently dropped.
- **Duplicate timestamps within a case**: Tiebreaker is row order (index in `data.rows`).
- **Very large graphs (50+ activities)**: Render all nodes but auto-zoom to fit. User can zoom/pan to explore. No artificial truncation.
- **Missing optional columns (status/resource)**: Nodes use `nodeColor`, tooltips omit missing fields.

## Technical Constraints

- ES5 only (var, function, for — no const/let/arrow)
- Pure Canvas 2D rendering, no external dependencies
- Handle HiDPI, null ctx, zero-size canvas
- Transparent CSS background by default
- Never read config in formatData — only in updateView
- JS defaults must match formatter HTML defaults
- All settings documented in savedsearches.conf.spec
- Implement `_lastGoodData` caching in both `formatData` and `updateView` per the standard pattern
- Implement `destroy()` to remove all canvas event listeners (mousemove, mousedown, mouseup, wheel, click)
- `reflow()` calls `invalidateUpdateView()` and preserves current zoom/pan transform
