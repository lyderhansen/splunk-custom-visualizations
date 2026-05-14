# H&M Viz Pack — custom visualization settings for savedsearches.conf (hm_viz host app).

# ─── kpi_card ───────────────────────────────────────────────
display.visualizations.custom.hm_viz.kpi_card.field = <string>
* SPL column bound to the headline KPI magnitude.

display.visualizations.custom.hm_viz.kpi_card.labelField = <string>
* SPL column for the KPI title or row label rendered under or beside the value.

display.visualizations.custom.hm_viz.kpi_card.deltaField = <string>
* SPL column for period-over-period or variance numeric shown as the delta ribbon.

display.visualizations.custom.hm_viz.kpi_card.unitField = <string>
* SPL column supplying unit tokens such as currency symbols or percent signs.

display.visualizations.custom.hm_viz.kpi_card.sparklineField = <string>
* SPL column feeding the miniature trend series plotted in-panel.

display.visualizations.custom.hm_viz.kpi_card.decimals = <string>
* Fixed decimal precision for the value; use -1 to delegate to compact grouping rules.

display.visualizations.custom.hm_viz.kpi_card.compactNumber = <string>
* Boolean string (true|false) controlling K, M, B style abbreviation of large numbers.

display.visualizations.custom.hm_viz.kpi_card.unitPosition = <string>
* Placement of the unit token relative to the value (before | after).

display.visualizations.custom.hm_viz.kpi_card.theme = <string>
* Panel chrome palette (light | dark).

display.visualizations.custom.hm_viz.kpi_card.showDelta = <string>
* Boolean string (true|false) toggling visibility of the delta affordance.

display.visualizations.custom.hm_viz.kpi_card.showSparkline = <string>
* Boolean string (true|false) toggling the inline sparkline strip.

display.visualizations.custom.hm_viz.kpi_card.accentColor = <string>
* Hex brand accent driving bars, sparks, and positive emphasis elements.

display.visualizations.custom.hm_viz.kpi_card.accentIntensity = <string>
* Numeric string 0-100 adjusting how strongly accents are blended into neutrals.


# ─── ring_gauge ─────────────────────────────────────────────
display.visualizations.custom.hm_viz.ring_gauge.field = <string>
* SPL column representing progress toward target on the radial scale.

display.visualizations.custom.hm_viz.ring_gauge.labelField = <string>
* SPL column containing the descriptive title anchored under the gauge.

display.visualizations.custom.hm_viz.ring_gauge.targetField = <string>
* SPL column referencing the goal value used when computing completeness.

display.visualizations.custom.hm_viz.ring_gauge.decimals = <string>
* Decimal precision for centered numeric readouts inside the gauge.

display.visualizations.custom.hm_viz.ring_gauge.maxValue = <string>
* Upper bound on the radial scale whenever the SPL row does not define it implicitly.

display.visualizations.custom.hm_viz.ring_gauge.theme = <string>
* Panel chrome palette (light | dark).

display.visualizations.custom.hm_viz.ring_gauge.accentColor = <string>
* Hex tint for arc completion fills and decorative markers.

display.visualizations.custom.hm_viz.ring_gauge.accentIntensity = <string>
* Numeric string 0-100 modulating saturation of accent overlays.


# ─── trend_area ─────────────────────────────────────────────
display.visualizations.custom.hm_viz.trend_area.timeField = <string>
* SPL epoch field aligning samples with the horizontal time axis.

display.visualizations.custom.hm_viz.trend_area.valueField = <string>
* SPL column encoding the plotted magnitude driving the curve height.

display.visualizations.custom.hm_viz.trend_area.seriesField = <string>
* Optional SPL column differentiating stacked or multi-series runs.

display.visualizations.custom.hm_viz.trend_area.lineColor = <string>
* Hex stroke color for foreground lines and spline emphasis.

display.visualizations.custom.hm_viz.trend_area.fillOpacity = <string>
* Numeric string 0.0-1.0 configuring translucency of the area wash.

display.visualizations.custom.hm_viz.trend_area.showAxis = <string>
* Boolean string (true|false) governing axis rulers and captions.

display.visualizations.custom.hm_viz.trend_area.showGrid = <string>
* Boolean string (true|false) toggling orthogonal grid scaffolding.

display.visualizations.custom.hm_viz.trend_area.theme = <string>
* Chart typography and chrome palette (light | dark).

display.visualizations.custom.hm_viz.trend_area.accentColor = <string>
* Supporting accent layered into hover states and overlays.

display.visualizations.custom.hm_viz.trend_area.accentIntensity = <string>
* Numeric string 0-100 scaling accent glare against the neutrals.

display.visualizations.custom.hm_viz.trend_area.decimals = <string>
* Axis and tooltip decimal precision (-1 delegates to heuristic grouping).


# ─── region_rank ────────────────────────────────────────────
display.visualizations.custom.hm_viz.region_rank.regionField = <string>
* SPL categorical column defining each geographic label on the leaderboard.

display.visualizations.custom.hm_viz.region_rank.valueField = <string>
* SPL numeric column proportional to rendered bar extents.

display.visualizations.custom.hm_viz.region_rank.trendField = <string>
* Optional SPL column describing directional deltas shown beside ranks.

display.visualizations.custom.hm_viz.region_rank.maxBars = <string>
* Integer cap trimming how many rows render before truncation.

display.visualizations.custom.hm_viz.region_rank.barColor = <string>
* Base hex tint for nominal bars excluding semantic overlays.

display.visualizations.custom.hm_viz.region_rank.showTrend = <string>
* Boolean string (true|false) toggling trend glyphs or annotations.

display.visualizations.custom.hm_viz.region_rank.compactNumber = <string>
* Boolean string enabling abbreviated tick labels similar to KPI compact mode.

display.visualizations.custom.hm_viz.region_rank.theme = <string>
* Layout chrome palette (light | dark).

display.visualizations.custom.hm_viz.region_rank.accentColor = <string>
* Secondary tint for separators, bullets, or rail cues.

display.visualizations.custom.hm_viz.region_rank.accentIntensity = <string>
* Numeric string 0-100 weighting accent usage through the panel.

display.visualizations.custom.hm_viz.region_rank.decimals = <string>
* Value label decimals (-1 defers to automatic grouping).


# ─── channel_donut ──────────────────────────────────────────
display.visualizations.custom.hm_viz.channel_donut.labelField = <string>
* SPL categorical column powering slice labels and legend entries.

display.visualizations.custom.hm_viz.channel_donut.valueField = <string>
* SPL numeric column determining slice proportional areas.

display.visualizations.custom.hm_viz.channel_donut.colors = <string>
* Comma separated hex palette applied cyclically slice by slice.

display.visualizations.custom.hm_viz.channel_donut.innerRadius = <string>
* Normalized donut hole diameter between 0 (pie) and 1 (narrow ring).

display.visualizations.custom.hm_viz.channel_donut.showLegend = <string>
* Boolean string (true|false) enabling the companion legend ribbon.

display.visualizations.custom.hm_viz.channel_donut.showTotal = <string>
* Boolean string (true|false) filling the donut center with the aggregate headline.

display.visualizations.custom.hm_viz.channel_donut.compactTotal = <string>
* Boolean string enforcing abbreviated typography for center totals.

display.visualizations.custom.hm_viz.channel_donut.theme = <string>
* Typography and donut chrome palette (light | dark).

display.visualizations.custom.hm_viz.channel_donut.accentIntensity = <string>
* Numeric string 0-100 modulating bezel highlights and separators.


# ─── status_pill ────────────────────────────────────────────
display.visualizations.custom.hm_viz.status_pill.labelField = <string>
* SPL column listing each geography or SKU row rendered in the ledger.

display.visualizations.custom.hm_viz.status_pill.statusField = <string>
* SPL categorical column interpreted as semantic performance bands.

display.visualizations.custom.hm_viz.status_pill.valueField = <string>
* SPL column echoing KPI copy shown adjacent to capsules.

display.visualizations.custom.hm_viz.status_pill.growingColor = <string>
* Hex capsule fill for outperforming or expansion states.

display.visualizations.custom.hm_viz.status_pill.stableColor = <string>
* Hex tint for neutral steady-state rows.

display.visualizations.custom.hm_viz.status_pill.decliningColor = <string>
* Hex tint for contraction or risk emphasis states.

display.visualizations.custom.hm_viz.status_pill.maxRows = <string>
* Integer guard limiting simultaneous rows in the status table.

display.visualizations.custom.hm_viz.status_pill.theme = <string>
* Table chrome palette (light | dark).

display.visualizations.custom.hm_viz.status_pill.accentIntensity = <string>
* Numeric string 0-100 controlling border weighting and halation strength.
