# Process Mining — Splunk Custom Visualization

A directed graph visualization that renders process mining flows from raw event sequences. It computes transitions between activities, builds a hierarchical layout, and draws an interactive graph with zoom/pan, hover tooltips, drilldown, and optional KPI header.

## Install

1. Copy or symlink the `process_mining/` directory into `$SPLUNK_HOME/etc/apps/`
2. Restart Splunk: `splunk restart`
3. The "Process Mining" visualization appears in the viz picker.

## Required Columns

| Column | Type | Description |
|--------|------|-------------|
| case_id | string | Groups events into a process flow |
| activity | string | The step/activity name (becomes a node) |
| _time | epoch | Event timestamp for ordering and duration |

## Optional Columns

| Column | Type | Description |
|--------|------|-------------|
| status | string | Color-codes nodes (success/error/ok) |
| resource | string | Who/what performed the step (shown in tooltip) |

## Notes

- All column names are configurable via the Format panel (Fields tab)
- The visualization computes transitions internally — no pre-aggregation needed
- Self-loops (A→A transitions) are detected and rendered
- Rows with unparseable timestamps are silently dropped

## Search

```spl
index=fake_tshrt sourcetype IN (fake:access_combined, FAKE:azure:servicebus, FAKE:online:order, FAKE:online:order:registry, FAKE:sap:auditlog)
| eval case_id=tshirtcid, activity=sourcetype, status=coalesce(status, http_status, "ok"), resource=coalesce(user, host)
| table _time case_id activity status resource
| sort case_id _time
```

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| caseField | Column for case/correlation ID | case_id |
| activityField | Column for activity name | activity |
| timeField | Column for timestamp | _time |
| statusField | Column for status color-coding | status |
| resourceField | Column for resource info | resource |
| layoutDirection | Graph flow direction (top-down / left-right) | top-down |
| nodeColor | Default node fill color | #607d8b |
| edgeColor | Edge line color | #90a4ae |
| successColor | Node color for success status | #4caf50 |
| errorColor | Node color for error status | #f44336 |
| showKPIs | Show summary metrics header | true |
| kpiColor | Color for KPI values | #00bcd4 |
| showEdgeLabels | Show transition counts on edges | true |
| showNodeCounts | Show event counts on nodes | true |
| drilldownField | Field name sent on node click | activity |

## Drilldown

Click a node to fire a drilldown event. In Dashboard Studio, configure the panel's drilldown action:

1. Select the panel → open **Drilldown** settings
2. Click **+ Add Drilldown** → set action to **Link to search**
3. Use `$row.activity.value$` as the drilldown token (where `activity` matches the `drilldownField` setting)

Example drilldown search:
```spl
index=your_index activity="$row.activity.value$"
```

## Time Range

`-60m` to `now` for historical, or `rt-1m` to `rt` for real-time.

## Build

From the repo root:

```bash
./build.sh process_mining
```

The tarball is output to `dist/process_mining-1.0.0.tar.gz`.
