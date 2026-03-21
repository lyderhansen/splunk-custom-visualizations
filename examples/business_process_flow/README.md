# Business Process Flow — Splunk Custom Visualization

An interactive business process flow visualization with editable nodes and connections. Renders data as a sequential flow diagram with configurable palettes, sparklines, and an editor mode for customizing layout and connections.

## Install

1. Copy or symlink the `business_process_flow/` directory into `$SPLUNK_HOME/etc/apps/`
2. Restart Splunk: `splunk restart`
3. The "Business Process Flow" visualization appears in the viz picker.

## Required Columns

| Column | Type | Description |
|--------|------|-------------|
| sourcetype | string | Label for each node in the flow |
| count | number | Numeric value displayed on each node |

## Optional Columns

| Column | Type | Description |
|--------|------|-------------|
| step | number | Order of nodes in the flow |
| subtitle | string | Additional text displayed below the node label |

## Notes

- All column names are configurable via the Format panel (Fields tab)
- Nodes are rendered in the order they appear in results (or by step column if present)
- Edit mode allows repositioning nodes and adding/removing connections

## Example Searches

Simple stats:
```spl
| stats count by sourcetype
| eval step=1
| table sourcetype count step
```

Timechart-based:
```spl
index=main sourcetype IN (syslog, firewall, ids, siem)
| stats count by sourcetype
| sort -count
| streamstats count as step
| table sourcetype count step
```

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| labelField | Column name for node labels | sourcetype |
| valueField | Column name for node values | count |
| subtitleField | Column name for subtitle text | (empty) |
| palette | Color theme (corporate/security/nature/neon/mono) | corporate |
| accentLine | Show colored accent line at top of nodes | false |
| sparklineType | Sparkline type (line/area/bar/none) | area |
| nodeRadius | Border radius in pixels | 8 |
| editMode | Toggle edit mode toolbar | false |
| lock | Lock nodes in view mode | false |
| editorState | Editor state JSON (auto-populated) | (empty) |
| drilldownField | Field name for drilldown events | sourcetype |

## Drilldown

Click a node to fire a drilldown event. In Dashboard Studio, configure the panel's drilldown action:

1. Select the panel, open **Drilldown** settings
2. Click **+ Add Drilldown**, set action to **Link to search**
3. Use `$row.sourcetype.value$` as the drilldown token (where `sourcetype` matches the `drilldownField` setting)

Example drilldown search:
```spl
index=your_index sourcetype="$row.sourcetype.value$"
```

## Build

From the repo root:

```bash
./build.sh business_process_flow
```

The tarball is output to `dist/business_process_flow-1.0.0.tar.gz`.
