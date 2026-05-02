#!/usr/bin/env python3
"""
expand_formatters.py — Re-expand compact single-line formatter.html files
to the multi-line format Splunk's editor parser actually understands.

The Splunk Classic format-panel renderer is whitespace-sensitive. Compacted
formatter HTML (multiple <splunk-control-group> chained on one line) breaks
control rendering — radios become unclickable, color pickers freeze.

This script keeps every viz in a single <form> tab but rewrites the inner
markup with the canonical multi-line layout used by the existing examples
in this repo (custom_single_value, line_trend_chart, etc).

Skips single_value_tile because that one is hand-tuned with multiple tabs.
"""

from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VIZ_ROOT = ROOT / "appserver" / "static" / "visualizations"
SKIP = {"single_value_tile"}

GROUP_RE = re.compile(
    r'<splunk-control-group([^>]*)>(.*?)</splunk-control-group>',
    re.DOTALL,
)
ATTR_RE = re.compile(r'(\w+)="([^"]*)"')


def parse_group(opening_attrs: str, body: str) -> str | None:
    """Re-emit a control group with multi-line layout. Returns None if it
    contains a control type we don't recognise."""
    attrs = dict(ATTR_RE.findall(opening_attrs))
    label = attrs.get("label", "")
    help_text = attrs.get("help", "")
    open_tag = f'    <splunk-control-group label="{label}"'
    if help_text:
        open_tag += f' help="{help_text}"'
    open_tag += ">"

    # Detect inner control.
    radio = re.search(r'<splunk-radio-input\s+name="([^"]+)"\s+value="([^"]*)"\s*>(.*?)</splunk-radio-input>', body, re.DOTALL)
    if radio:
        name, default, options = radio.group(1), radio.group(2), radio.group(3)
        opt_lines = []
        for ov, ol in re.findall(r'<option\s+value="([^"]*)"\s*>([^<]*)</option>', options):
            opt_lines.append(f'            <option value="{ov}">{ol}</option>')
        return (
            f'{open_tag}\n'
            f'        <splunk-radio-input name="{name}" value="{default}">\n'
            + "\n".join(opt_lines) + "\n"
            f'        </splunk-radio-input>\n'
            f'    </splunk-control-group>'
        )

    select = re.search(r'<splunk-select\s+name="([^"]+)"\s+value="([^"]*)"\s*>(.*?)</splunk-select>', body, re.DOTALL)
    if select:
        name, default, options = select.group(1), select.group(2), select.group(3)
        opt_lines = []
        for ov, ol in re.findall(r'<option\s+value="([^"]*)"\s*>([^<]*)</option>', options):
            opt_lines.append(f'            <option value="{ov}">{ol}</option>')
        return (
            f'{open_tag}\n'
            f'        <splunk-select name="{name}" value="{default}">\n'
            + "\n".join(opt_lines) + "\n"
            f'        </splunk-select>\n'
            f'    </splunk-control-group>'
        )

    color = re.search(
        r'<splunk-color-picker\s+name="([^"]+)"(?:\s+type="([^"]*)")?\s+value="([^"]*)"\s*>(.*?)</splunk-color-picker>',
        body, re.DOTALL,
    )
    if color:
        name, ptype, default, swatches = color.group(1), color.group(2) or "splunkCategorical", color.group(3), color.group(4)
        sw_lines = []
        for sw in re.findall(r'<splunk-color>([^<]+)</splunk-color>', swatches):
            sw_lines.append(f'            <splunk-color>{sw}</splunk-color>')
        return (
            f'{open_tag}\n'
            f'        <splunk-color-picker name="{name}" type="{ptype}" value="{default}">\n'
            + "\n".join(sw_lines) + "\n"
            f'        </splunk-color-picker>\n'
            f'    </splunk-control-group>'
        )

    text = re.search(r'<splunk-text-input\s+name="([^"]+)"\s+value="([^"]*)"\s*>\s*</splunk-text-input>', body, re.DOTALL)
    if text:
        name, default = text.group(1), text.group(2)
        return (
            f'{open_tag}\n'
            f'        <splunk-text-input name="{name}" value="{default}">\n'
            f'        </splunk-text-input>\n'
            f'    </splunk-control-group>'
        )

    textarea = re.search(r'<splunk-text-area\s+name="([^"]+)"\s*>([^<]*)</splunk-text-area>', body, re.DOTALL)
    if textarea:
        name, default = textarea.group(1), textarea.group(2)
        return (
            f'{open_tag}\n'
            f'        <splunk-text-area name="{name}">{default}</splunk-text-area>\n'
            f'    </splunk-control-group>'
        )
    return None


def section_label(formatter_html: str) -> str:
    m = re.search(r'section-label="([^"]+)"', formatter_html)
    return m.group(1) if m else "Settings"


def expand(formatter_html: str) -> str:
    label = section_label(formatter_html)
    out_groups: list[str] = []
    for m in GROUP_RE.finditer(formatter_html):
        rebuilt = parse_group(m.group(1), m.group(2))
        if rebuilt is None:
            print(f"    !! Could not parse control group, leaving original")
            out_groups.append("    " + m.group(0))
        else:
            out_groups.append(rebuilt)
    return (
        f'<form class="splunk-formatter-section" section-label="{label}">\n'
        + "\n\n".join(out_groups) + "\n"
        f'</form>\n'
    )


def main() -> None:
    for viz_dir in sorted(VIZ_ROOT.iterdir()):
        if not viz_dir.is_dir():
            continue
        name = viz_dir.name
        if name in SKIP:
            continue
        formatter = viz_dir / "formatter.html"
        if not formatter.exists():
            continue
        original = formatter.read_text()
        # Skip if already multi-line (heuristic: more than 30 lines).
        if original.count("\n") > 60:
            print(f"  skipping (already expanded): {name}")
            continue
        expanded = expand(original)
        formatter.write_text(expanded)
        new_lines = expanded.count("\n")
        print(f"  expanded: {name} -> {new_lines} lines")


if __name__ == "__main__":
    main()
