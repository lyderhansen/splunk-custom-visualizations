# Bugs Discovered — HBO Max Viz Pack Build (2026-05-06)

Session: [HBO Max viz pack build](290eb93e-d8bd-4e89-9f0a-82a19e80e591)

Three bugs were discovered during this build that were not caught by existing skills.
All three have been patched into the relevant skills as of this session.

---

## Bug 1: `outputMode: 'json'` breaks all custom visualizations

**Severity:** FATAL — viz renders "No data" / em-dash with zero console errors

**What happened:**
All 6 visualization source files used `outputMode: 'json'` in `getInitialDataParams()`.
This is not a valid Splunk visualization output mode. The viz framework silently delivers
data in a different structure, so `data.fields` and `data.rows` are undefined. Every
`fieldIndex()` call returns `-1`, and every viz falls through to its "No data" fallback.

**Wrong:**
```javascript
getInitialDataParams: function() {
    return { outputMode: 'json', count: 10000 };
}
```

**Correct:**
```javascript
getInitialDataParams: function() {
    return {
        outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
        count: 10000
    };
}
```

**Valid output modes:**
- `SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE` — `{fields, rows}` (standard)
- `SplunkVisualizationBase.COLUMN_MAJOR_OUTPUT_MODE` — `{fields, columns}`
- `SplunkVisualizationBase.RAW_OUTPUT_MODE` — raw JSON

**Why it wasn't caught:**
- No existing rule in `vp-ref-gotchas` mentioned `outputMode`
- The viz renders without JS errors — it just shows "No data"
- The subagent skeleton template didn't enforce the constant

**Skill patched:** `vp-ref-gotchas` — added as rule F4 (FATAL severity) + pre-commit checklist item

---

## Bug 2: `fontSize` on `splunk.markdown` rejects number values

**Severity:** BROKEN — Dashboard Studio schema validation error, panel may not render

**What happened:**
`splunk.markdown` section labels used numeric fontSize values (`"14"`, `"11"`).
Dashboard Studio's schema only accepts a strict enum of named sizes.

**Wrong:**
```json
{
    "type": "splunk.markdown",
    "options": {
        "fontSize": "14"
    }
}
```

**Correct:**
```json
{
    "type": "splunk.markdown",
    "options": {
        "fontSize": "default"
    }
}
```

**Valid `fontSize` values:**
| Value | Approximate size |
|---|---|
| `"extraSmall"` | ~11px — section labels, footnotes |
| `"small"` | ~12px — descriptions, captions |
| `"default"` | ~14px — body text |
| `"large"` | ~16px — section headers |
| `"extraLarge"` | ~20px — hero titles |

Also accepts DOS expressions (`"> \"small\""`) and token references (`"$tok$"`).

**Schema regex that rejects numbers:**
```
\$(\w+:)?([^$|:]+?)(\|[|\w]+)?\$|^extraSmall$|^small$|^default$|^large$|^extraLarge$|^custom$
```

**Why it wasn't caught:**
- `ds-viz-markdown` documented the enum but didn't list BANNED values
- The always-applied `splunk-dashboard-studio.mdc` rule had no `fontSize` section
- Easy to assume "font size" means a number

**Skills patched:**
- `ds-viz-markdown` — added BANNED values table with wrong→correct mapping
- `splunk-dashboard-studio.mdc` (always-applied rule) — added `fontSize` strict enum section

---

## Bug 3: `&amp;` rendered literally inside CDATA

**Severity:** COSMETIC — text displays wrong but dashboard functions

**What happened:**
A visualization title inside the JSON definition (which lives inside `<![CDATA[...]]>`)
used `&amp;` instead of plain `&`. Inside CDATA, XML entities are NOT interpreted —
`&amp;` is literal text, so "Top Shows &amp; Movies" rendered as-is on screen.

**Wrong (inside CDATA):**
```json
"title": "Top Shows &amp; Movies"
```

**Correct (inside CDATA):**
```json
"title": "Top Shows & Movies"
```

**Rule reminder:**
- Inside `<![CDATA[...]]>` (the JSON): `&` does NOT need escaping
- Inside `<label>` and `<description>` (outside CDATA): `&` MUST be `&amp;`

**Why it wasn't caught:**
- The always-applied rule already documents this distinction, but it wasn't followed
- Easy mistake when switching between XML and JSON context

**Skill already covers this:** `splunk-dashboard-studio.mdc` — "CRITICAL: XML Entity Escaping"
section already documents the rule. No skill update needed, but worth reinforcing in subagent prompts.

---

## Bug 4 (Process): Generic visual output from skipped design steps

**Severity:** DESIGN — dashboard looks identical to every other pack

**What happened:**
The `vp-couture` workflow steps 1-3 (brand research, design context, design direction)
and step 8 (design critique) were rushed. The result:
- Every viz used `theme.drawPanel()` — identical 1px-border rounded rect chrome
- No branded header (no HBO Max logo/wordmark)
- No hero image or visual anchor
- Rendering code was structurally identical to what any other brand would produce
- The shape language (how arcs, numbers, decorations are drawn) was generic

**Root cause:** The vp-couture skill's workflow was advisory, not blocking. Steps could
be skipped without the skill flagging it.

**Skill patched:** `vp-couture` — workflow steps 1-3, 6, and 8 now marked as `[BLOCKING]`
with explicit artifact requirements. Added "Subagent enforcement" section requiring that
subagent prompts include the full design brief, brand-specific chrome, and anti-pattern list.
Added principle: "If time is limited, reduce VIZ COUNT — do NOT reduce DESIGN DEPTH."

---

## Summary of skill updates made

| Skill | File | Change |
|---|---|---|
| `vp-ref-gotchas` | `plugins/splunk-viz-packs/skills/vp-ref-gotchas/SKILL.md` | Added F4 (outputMode FATAL rule) + checklist item |
| `ds-viz-markdown` | `plugins/splunk-dashboards/skills/ds-viz-markdown/SKILL.md` | Added BANNED fontSize values table |
| `splunk-dashboard-studio.mdc` | `.cursor/rules/splunk-dashboard-studio.mdc` | Added fontSize strict enum section |
| `vp-couture` | `plugins/splunk-viz-packs/skills/vp-couture/SKILL.md` | Added [BLOCKING] gates + subagent enforcement |
