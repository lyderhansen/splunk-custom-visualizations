# Dashboard Framework Custom Viz — Future Project Research

Research conducted 2026-03-31.

## Summary

Dashboard Framework React custom visualizations **do NOT work in normal Dashboard Studio dashboards**. They only work on **custom pages** built with the Splunk UI Toolkit / Dashboard Framework. This is a critical limitation.

## How It Works

### Architecture
- You build a React component that extends `SplunkVisualization`
- Define `config` with `dataContract`, `optionsSchema`, `key`
- Build a custom page (not a Dashboard Studio dashboard) using `@splunk/dashboard-core`
- The custom page renders the dashboard JSON definition with your custom preset

### Project Structure
```
packages/
  my-viz/
    src/
      MyViz.jsx          # React component
  my-dashboard/
    src/main/webapp/pages/dashboard/
      definition.json     # Dashboard JSON
      DashboardExample.jsx # React wrapper using DashboardCore
      index.jsx           # Entry point via @splunk/react-page
```

### Component Registration
```javascript
MyViz.config = {
  dataContract: {},       // Expected data shape
  optionsSchema: {},      // Configurable settings (gives native field pickers)
  key: 'custom.MyViz',   // Unique ID
  name: 'MyViz',
};

MyViz.propTypes = {
  ...SplunkVisualization.propTypes,
};
```

### Dashboard Rendering
```jsx
import DashboardCore from "@splunk/dashboard-core";
import { DashboardContextProvider } from "@splunk/dashboard-context";

// Custom preset includes your viz
const customPreset = {
  ...EnterpriseViewOnlyPreset,
  visualizations: {
    ...EnterpriseViewOnlyPreset.visualizations,
    'custom.MyViz': MyViz,
  }
};

<DashboardContextProvider preset={customPreset}>
  <DashboardCore definition={definition} />
</DashboardContextProvider>
```

## Critical Limitation

**React custom viz CANNOT be used in normal Dashboard Studio dashboards.**

From Splunk Community:
> "React JS cannot be used in Dashboard Studio."
> "By default in Dashboard Studio, you can only choose from the available Splunk Visualizations."

This means:
- You can't pick a React custom viz from the Dashboard Studio viz picker
- You can't use it in any dashboard created through the normal Studio UI
- You must build a **custom page** that renders the dashboard programmatically
- Users can't create/edit dashboards visually — they must edit JSON definitions

## Comparison

| Feature | Classic Custom Viz (AMD) | Dashboard Framework (React) |
|---------|-------------------------|----------------------------|
| Works in Classic Dashboards | YES | No |
| Works in Dashboard Studio | YES (via viz picker) | **NO** |
| Works in Custom Pages | No | YES |
| Visual dashboard editor | YES (Studio) | **NO** (JSON only) |
| Native field pickers | No | YES (but only on custom pages) |
| Native spinners/config | No | YES (but only on custom pages) |
| End-user can create dashboards | YES | No (developer-built pages only) |
| React/modern JS | No (ES5 only) | YES |
| Canvas 2D | YES | Possible but unusual |
| Build complexity | Low (webpack AMD) | High (React + Splunk UI Toolkit) |

## Verdict for Business Process Flow

**Not worth migrating.** The Dashboard Framework approach would give us native field pickers and spinners in the config panel, BUT:

1. **Users can't use it in Dashboard Studio** — the whole point of our viz is that users drag it onto any dashboard
2. **No visual editor** — users would need to edit JSON, which defeats the purpose
3. **Complete rewrite** — 10k+ lines of Canvas 2D ES5 to React
4. **Custom page only** — each dashboard using it needs a developer to build the page

Our current approach (Classic AMD viz + rich edit mode panel with dynamic dropdowns) is the right architecture for a viz that end-users should be able to drop into any dashboard.

## What We Could Do Instead

1. **Keep Classic AMD viz** as the primary delivery
2. **Improve our edit mode panel** to cover all the UX gaps (field pickers, spinners, settings) — already doing this
3. **Optionally** build a React wrapper page for power users who want the full Dashboard Framework experience — separate project, not a replacement

## Sources
- https://github.com/splunk/dashboard-simple-table-component/blob/main/tutorial.md
- https://github.com/splunk/dashboard-react-google-maps/blob/main/tutorial.md
- https://community.splunk.com/t5/Splunk-Dev/How-to-use-custom-react-visualization-in-Dashboard-Studio/m-p/614835
- https://community.splunk.com/t5/Getting-Data-In/Defined-custom-Visualization-in-Dashboard-Studio/td-p/673583
- https://community.splunk.com/t5/Dashboards-Visualizations/Custom-Javascript-Visualization-in-Dashboard/m-p/699746
- https://dev.splunk.com/enterprise/docs/developapps/visualizedata
