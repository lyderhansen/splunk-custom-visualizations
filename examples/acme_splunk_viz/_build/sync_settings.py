#!/usr/bin/env python3
"""
sync_settings.py — Read each viz's formatter.html and:
  1. Regenerate README/savedsearches.conf.spec with all settings
  2. Update each appserver/.../harness.json to expose every formatter
     control as a harness control

Run from the acme_splunk_viz/ directory.
"""

from __future__ import annotations
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VIZ_ROOT = ROOT / "appserver" / "static" / "visualizations"
SPEC_PATH = ROOT / "README" / "savedsearches.conf.spec"
APP_NAME = "acme_splunk_viz"

# Map formatter element types to harness JSON shapes + spec types.
SPEC_TYPE_MAP = {
    "color": "<string>",
    "text": "<string>",
    "textarea": "<string>",
    "radio": "<string>",
    "select": "<string>",
}


def parse_formatter(formatter_html: str) -> list[dict]:
    """Pull every <splunk-control-group> + inner control out of a formatter file."""
    settings = []
    # Find each control-group block.
    group_re = re.compile(
        r'<splunk-control-group[^>]*?label="([^"]+)"(?:[^>]*?help="([^"]*)")?[^>]*?>(.*?)</splunk-control-group>',
        re.DOTALL,
    )
    for m in group_re.finditer(formatter_html):
        label, help_text, body = m.group(1), m.group(2) or "", m.group(3)
        # Find the input inside.
        for kind, pattern in [
            ("text", r'<splunk-text-input\s+name="\{\{VIZ_NAMESPACE\}\}\.(\w+)"\s+value="([^"]*)"'),
            ("textarea", r'<splunk-text-area\s+name="\{\{VIZ_NAMESPACE\}\}\.(\w+)"[^>]*>([^<]*)</splunk-text-area>'),
            ("radio", r'<splunk-radio-input\s+name="\{\{VIZ_NAMESPACE\}\}\.(\w+)"\s+value="([^"]*)"'),
            ("select", r'<splunk-select\s+name="\{\{VIZ_NAMESPACE\}\}\.(\w+)"\s+value="([^"]*)"'),
            ("color", r'<splunk-color-picker\s+name="\{\{VIZ_NAMESPACE\}\}\.(\w+)"[^>]*?value="([^"]*)"'),
        ]:
            mm = re.search(pattern, body, re.DOTALL)
            if mm:
                name, default = mm.group(1), mm.group(2)
                entry = {
                    "name": name,
                    "label": label,
                    "type": kind,
                    "default": default,
                }
                if kind == "radio" or kind == "select":
                    options = re.findall(r'<option\s+value="([^"]*)"[^>]*>', body)
                    entry["options"] = options
                if help_text:
                    entry["help"] = help_text
                settings.append(entry)
                break
    return settings


def harness_field(setting: dict) -> dict:
    """Convert a parsed setting into a harness.json formatter entry."""
    out = {"name": setting["name"], "label": setting["label"]}
    if setting["type"] == "radio" or setting["type"] == "select":
        out["type"] = "radio" if setting["type"] == "radio" else "select"
        out["options"] = setting.get("options", [])
    elif setting["type"] == "color":
        out["type"] = "color"
    else:
        out["type"] = "text"
    out["default"] = setting["default"]
    return out


def update_harness(viz_dir: Path, settings: list[dict]) -> None:
    h_path = viz_dir / "harness.json"
    if not h_path.exists():
        return
    h = json.loads(h_path.read_text())
    h["formatter"] = [harness_field(s) for s in settings]
    h_path.write_text(json.dumps(h, indent=2) + "\n")


def write_spec(per_viz: dict[str, list[dict]]) -> None:
    lines = []
    for viz_name, settings in per_viz.items():
        lines.append(f"# ─── {viz_name} ─" + "─" * (60 - len(viz_name) - 8))
        for s in settings:
            kind = SPEC_TYPE_MAP.get(s["type"], "<string>")
            lines.append(f"display.visualizations.custom.{APP_NAME}.{viz_name}.{s['name']} = {kind}")
        lines.append("")
    SPEC_PATH.write_text("\n".join(lines))


def main() -> None:
    per_viz: dict[str, list[dict]] = {}
    for viz_dir in sorted(VIZ_ROOT.iterdir()):
        if not viz_dir.is_dir():
            continue
        formatter_path = viz_dir / "formatter.html"
        if not formatter_path.exists():
            continue
        settings = parse_formatter(formatter_path.read_text())
        per_viz[viz_dir.name] = settings
        update_harness(viz_dir, settings)
        print(f"  {viz_dir.name}: {len(settings)} settings")
    write_spec(per_viz)
    total = sum(len(v) for v in per_viz.values())
    print(f"\nTotal: {total} settings across {len(per_viz)} visualizations")
    print(f"Updated: {SPEC_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
