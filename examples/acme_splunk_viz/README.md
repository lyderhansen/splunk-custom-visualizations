# ACME Splunk Visualizations — One App, 16 Custom Vizs

A single installable Splunk app that ships sixteen production-grade custom
visualizations sharing one design system: the ACME palette, Inter for UI text,
IBM Plex Mono for technical strings, dark- and light-mode tokens, and identical
chart conventions across the lot.

## What's inside

| # | Stanza | Purpose |
|---|--------|---------|
| 1 | `single_value_tile` | Headline KPI with delta arrow + optional sparkline |
| 2 | `sparkline` | Chrome-free micro-trend |
| 3 | `area_chart` | Multi-series time-series with annotation marker |
| 4 | `column_chart` | Vertical bars with optional highlighted index |
| 5 | `h_bar_list` | Top-N row list with value suffix and tiered colours |
| 6 | `heatmap` | Categorical-Y by time-X density grid |
| 7 | `ring_gauge` | Radial gauge — full ring or half arc |
| 8 | `donut` | Part-to-whole donut with right legend |
| 9 | `funnel` | Conversion funnel with step-conversion percentage |
| 10 | `status_chip` | Header / badge / service pill |
| 11 | `data_table` | Splunk signature table with column type system |
| 12 | `pop_grid` | 4×4 multi-site status grid |
| 13 | `app_bar` | Top-level Splunk navigation shell |
| 14 | `filter_strip` | Dropdown chips + Run-search CTA |
| 15 | `dashboard_frame` | Full canvas — app bar, breadcrumb, status, footer |
| 16 | `wordmark` | Reusable inline `›splunk` brand lockup |

## Install

1. Run `./build-acme.sh` from the repo root — this produces
   `dist/acme_splunk_viz-1.0.0.tar.gz`.
2. Splunk → **Manage Apps** → **Install app from file** → pick the tarball.
3. Restart Splunk if prompted.
4. All sixteen visualizations now appear in the dashboard editor's viz picker
   under their `ACME …` labels.

## Usage in a dashboard

Each viz is selected by `display.visualizations.custom.type =
acme_splunk_viz.<stanza>`. See `default/savedsearches.conf` for one ready-to-run
example per visualization — every one renders against deterministic
`makeresults` data so you can verify the install on a fresh Splunk before
wiring them up to real searches.

## Build

```bash
./build-acme.sh
```

The build performs one `npm install` inside `_build/`, runs a single multi-entry
webpack pass that emits `visualization.js` next to each viz folder, then
packages the app excluding `_build/` and every viz `src/` directory.

## Design system

All sixteen vizs read the same token set from `shared/theme.js` — colours, fonts,
spacing, chart conventions. Switching `theme = light` flips every token through
its light-mode pair. Every visible string in every viz is configurable via the
formatter — there are no hard-coded labels in the rendered output.

The full design contract — typography, palette, panel chrome, chart conventions —
is documented in the brief at the repo root. Each viz follows the conventions
literally: 1 px `edge` borders, 6 px panel radius, horizontal gridlines only,
1.75 px primary line stroke, sentence-case labels, tabular numerics, etc.

## Time range

Every example saved search uses a fixed historical window so you can see results
without configuring real-time access. Switch the dispatch times (or the
underlying SPL) freely once you wire each viz up to live data.
