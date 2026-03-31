# Splunk Custom Viz Formatter Research

Research conducted 2026-03-31 on formatter capabilities for Splunk custom visualizations.

## Two Types of Custom Visualizations in Splunk

### 1. Classic Custom Viz (AMD/Canvas2D) — What we use
- Uses `formatter.html` with Splunk web components
- Deployed as a standalone Splunk app
- Works in both Classic SimpleXML and Dashboard Studio
- Configuration panel: **static HTML only**

### 2. Dashboard Framework Custom Viz (React) — Different system
- Uses `config` object with `dataContract`, `optionsSchema`, `key`
- React components extending `SplunkVisualization`
- Only works in Dashboard Studio
- Has access to Dashboard Framework's field picker, data configurations, etc.
- Tutorial: https://github.com/splunk/dashboard-simple-table-component/blob/main/tutorial.md

## Classic Formatter Components (formatter.html)

### Available Components
| Component | Description | Key Attributes |
|-----------|-------------|---------------|
| `<splunk-text-input>` | Single-line text field | `name`, `value` |
| `<splunk-text-area>` | Multi-line text field | `name`, `value` |
| `<splunk-radio-input>` | Radio button group | `name`, `value` + `<option>` children |
| `<splunk-select>` | Static dropdown | `name`, `value` + `<option>` children |
| `<splunk-color-picker>` | Color swatch picker | `name`, `value`, `type` (splunkCategorical/splunkSemantic/splunkSequential/custom) + optional `<splunk-color>` children |

### Container
| Component | Description | Key Attributes |
|-----------|-------------|---------------|
| `<splunk-control-group>` | Wraps each input | `label`, `help` |
| `<form class="splunk-formatter-section">` | Groups inputs into tabs | `section-label` |

### NOT Available in Classic Formatter
- **`type="number"` on `splunk-text-input`** — Not documented. May or may not work. Needs testing.
- **Dynamic field picker dropdowns** — Not possible. These are a Dashboard Studio built-in viz feature only.
- **Data-driven dropdowns** — Not possible. `<splunk-select>` only supports static `<option>` children.
- **Spinner/stepper controls** — Not a built-in component.
- **Slider/range controls** — Not a built-in component.

## Why Dashboard Studio Built-in Viz Have Field Pickers

The "Data configurations" section with field dropdowns (showing "count (number)", "sourcetype (string)", etc.) is part of Dashboard Studio's internal visualization framework. Built-in viz types (splunk.singlevalue, splunk.line, splunk.column, etc.) use a React-based configuration system with `optionsSchema` that the framework renders as field pickers.

Classic custom vizs (`formatter.html`) do NOT have access to this system. They appear in the Dashboard Studio configuration panel as static HTML sections below the built-in "Data configurations".

## Recommendation

For our Business Process Flow visualization:
1. **Keep `formatter.html` as-is** — it's the only way to configure in Classic dashboards
2. **Build our own field picker/spinners in the Edit Mode panel** — full control, dynamic dropdowns from search data, already working
3. **If we want Dashboard Studio-native field pickers**, we would need to rebuild the entire viz as a React Dashboard Framework component — major rewrite, different architecture
4. **Test `type="number"` on `splunk-text-input`** — it might work as a progressive enhancement, but it's not documented

## Sources
- https://docs.splunk.com/Documentation/Splunk/latest/AdvancedDev/CustomVizFormatterApiRef (403 — access blocked)
- https://github.com/splunk/step/blob/master/scrimmages/firefire/appserver/static/visualizations/geoheatmap/formatter.html
- https://github.com/splunk/dashboard-simple-table-component/blob/main/tutorial.md
- https://dev.splunk.com/enterprise/docs/developapps/visualizedata
- https://community.splunk.com/t5/Getting-Data-In/Defined-custom-Visualization-in-Dashboard-Studio/td-p/673583
