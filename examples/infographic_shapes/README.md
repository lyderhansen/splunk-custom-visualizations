# Infographic Shapes — Splunk Custom Visualization

A PowerPoint-style shape toolkit for Splunk Dashboard Studio. Renders 37 shapes with rich styling: gradients, glow, drop shadow, reflection, dashed strokes, embedded custom fonts, animations, and data-driven colouring from search results.

Use it to add decorative elements, status indicators, labels, arrows, process flow markers, and branded design elements that elevate your dashboards beyond the built-in `splunk.rectangle` and `splunk.ellipse`.

## Install

1. Copy or symlink the `infographic_shapes/` directory into `$SPLUNK_HOME/etc/apps/`
2. Restart Splunk: `splunk restart`
3. The "Infographic Shapes" visualization appears in the viz picker.

## Shapes (37)

| Category | Shapes |
|----------|--------|
| **Rectangles** | `rectangle`, `rounded_rectangle`, `pill` |
| **Circles** | `circle`, `ellipse`, `ring`, `arc` |
| **Polygons** | `triangle`, `right_triangle`, `diamond`, `pentagon`, `hexagon`, `octagon` |
| **Stars** | `star_4`, `star_5`, `star_6` |
| **Icons** | `heart`, `cross`, `lightning`, `cloud`, `sun`, `moon` |
| **Arrows** | `arrow_right`, `arrow_left`, `arrow_up`, `arrow_down`, `arrow_double`, `chevron` |
| **Geometric** | `parallelogram`, `trapezoid` |
| **Brackets** | `bracket_left`, `bracket_right`, `curly_left`, `curly_right` |
| **Lines** | `line_horizontal`, `line_vertical`, `line_diagonal` |

## Effects

| Effect | Description |
|--------|-------------|
| **Gradient fill** | Linear (H/V/diagonal) or radial gradient between two colours |
| **Drop shadow** | Offset shadow with configurable blur, colour, and position |
| **Glow** | Symmetrical light halo around the shape |
| **Reflection** | Fading reflection below the shape |
| **Dashed stroke** | Solid, dashed, dotted, or dash-dot outlines |
| **Rotation** | Rotate any shape 0-360 degrees |
| **Animation** | Pulse (opacity), glow pulse, breathe (scale), or spin |
| **Custom Fonts** | Locally embedded fonts — no external network requests |

## Required Columns

None — this viz works as a static decoration with no search data. All columns are optional.

## Optional Columns

| Column | Type | Description |
|--------|------|-------------|
| value | number | Numeric value for threshold-based colouring |
| color | string | Hex colour code to override the fill colour |
| text | string | Dynamic text to display on the shape |

Column names are configurable via formatter settings (Field Name, Colour Field, Text Field).

## Search Examples

### Static shape (no data needed)

Any minimal search works — the shape renders from formatter settings:

```spl
index=_internal | head 1 | eval value=1
```

### Data-driven colour from search

```spl
index=_internal sourcetype=splunkd component=Metrics
| stats count as value
| eval color=if(value>5000, "#22C55E", if(value>1000, "#F59E0B", "#EF4444")),
       text=tostring(value, "commas")." events"
```

### Threshold-based colouring

Set **Value Field** = `cpu`, **Warning Threshold** = `70`, **Critical Threshold** = `90`:

```spl
index=os sourcetype=cpu
| stats latest(cpu_pct) as cpu by host
| head 1
```

## Configuration

### Shape & Layout

| Setting | Description | Default |
|---------|-------------|---------|
| shape | Shape type (see list above) | `rounded_rectangle` |
| cornerRadius | Corner radius for rounded rectangles (px) | `12` |
| rotation | Rotation angle in degrees | `0` |
| padding | Inner padding from panel edge (px) | `8` |
| opacity | Overall opacity (0-100) | `100` |

### Fill & Stroke

| Setting | Description | Default |
|---------|-------------|---------|
| fillType | `solid`, `gradient`, or `none` | `solid` |
| fillColor | Primary fill colour | `#1E3A5F` |
| gradientColor | Second gradient colour | `#06B6D4` |
| gradientDirection | `horizontal`, `vertical`, `diagonal`, `diagonal_rev`, `radial` | `vertical` |
| strokeColor | Outline colour | `#06B6D4` |
| strokeWidth | Outline width in px (0 = none) | `0` |
| strokeDash | `solid`, `dashed`, `dotted`, `dash_dot` | `solid` |

### Effects

| Setting | Description | Default |
|---------|-------------|---------|
| shadowEnabled | Drop shadow on/off | `false` |
| shadowColor | Shadow colour | `#000000` |
| shadowBlur | Shadow blur radius (px) | `12` |
| shadowOffsetX | Shadow horizontal offset (px) | `4` |
| shadowOffsetY | Shadow vertical offset (px) | `4` |
| glowEnabled | Glow effect on/off | `false` |
| glowColor | Glow colour | `#06B6D4` |
| glowSize | Glow halo size (px) | `15` |
| reflectionEnabled | Reflection on/off | `false` |
| reflectionOpacity | Reflection opacity (0.0-1.0) | `0.15` |
| animationType | `none`, `pulse`, `glow_pulse`, `breathe`, `spin` | `none` |

### Text & Font

| Setting | Description | Default |
|---------|-------------|---------|
| text | Static text on the shape | *(empty)* |
| fontFamily | Locally embedded font name | *(system font)* |
| fontSize | Font size in px (0 = auto-scale) | `0` |
| fontWeight | `bold`, `normal`, or `light` | `bold` |
| textColor | Text colour | `#FFFFFF` |
| textAlign | `left`, `center`, `right` | `center` |

### Data Binding

| Setting | Description | Default |
|---------|-------------|---------|
| field | Numeric field for threshold colouring | *(empty)* |
| colorField | Field with hex colour to override fill | *(empty)* |
| textField | Field for dynamic text | *(empty)* |
| warningThreshold | Value >= this turns warning colour | *(empty)* |
| criticalThreshold | Value >= this turns critical colour | *(empty)* |
| normalColor | Colour below all thresholds | `#22C55E` |
| warningColor | Colour at warning level | `#F59E0B` |
| criticalColor | Colour at critical level | `#EF4444` |

## Fonts

All fonts are loaded **locally** — the viz makes **zero external network requests**, safe for air-gapped and security-hardened Splunk deployments.

### Built-in fonts

| Font | Style |
|------|-------|
| *(empty / system)* | Browser sans-serif |
| `serif` | Browser serif |
| `monospace` | Browser monospace |
| `Press Start 2P` | Retro pixel font (embedded via `shared/fonts.css`) |
| `Formula1` | Motorsport display font (embedded via `shared/fonts.css`) |

### Adding custom fonts

To add your own fonts, download the `.woff2` file from Google Fonts or elsewhere, base64-encode it, and add an `@font-face` rule to `visualization.css`:

```css
@font-face {
  font-family: 'Orbitron';
  font-style: normal;
  font-weight: 400 900;
  src: url(data:font/woff2;base64,<BASE64_DATA_HERE>) format('woff2');
}
```

Then add the font name to the `<splunk-select>` in `formatter.html` so it appears in the settings dropdown.

## Dashboard Studio Usage

In Dashboard Studio v2 JSON, reference as:

```json
"viz_my_shape": {
  "type": "infographic_shapes.infographic_shapes",
  "dataSources": { "primary": "ds_shape_data" },
  "options": {
    "shape": "hexagon",
    "fillType": "gradient",
    "fillColor": "#1E3A5F",
    "gradientColor": "#06B6D4",
    "glowEnabled": "true",
    "glowColor": "#06B6D4",
    "text": "STATUS",
    "fontFamily": "Press Start 2P"
  }
}
```

## Time Range

Not time-sensitive — use any time range appropriate for your search. For static shapes, any minimal search works.

## Build

From the repo root:

```bash
./build.sh infographic_shapes
```

The tarball is output to `dist/infographic_shapes-1.0.0.tar.gz`.
