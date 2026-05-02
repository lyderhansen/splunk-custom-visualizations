#!/usr/bin/env python3
"""
generate_assets.py — Build app icons + per-viz preview thumbnails.

Splunk apps need four icons in `static/`:
    appIcon.png       — 36x36 RGB PNG
    appIcon_2x.png    — 72x72 RGB PNG
    appIconAlt.png    — 36x36 RGB PNG (used inside the app launcher)
    appIconAlt_2x.png — 72x72 RGB PNG

Each custom viz needs a 256x144 RGB PNG preview at:
    appserver/static/visualizations/<name>/preview.png

This script renders ALL of those from scratch using Pillow so the app
ships with brand-consistent placeholders. Replace any of them with hand-designed
artwork at the same path/size whenever you want — Splunk just reads the PNGs.

Run:
    python3 _build/generate_assets.py
from inside the acme_splunk_viz/ directory.
"""

from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import math
import sys

ROOT = Path(__file__).resolve().parent.parent  # acme_splunk_viz/
STATIC = ROOT / "static"
VIZ_ROOT = ROOT / "appserver" / "static" / "visualizations"

ORANGE = (255, 102, 0)
BG_DARK = (23, 29, 39)
PANEL = (31, 39, 52)
EDGE = (255, 255, 255, 20)
TEXT = (229, 234, 242)
DIM = (160, 168, 180)
S2 = (43, 191, 184)
S3 = (92, 225, 230)
S4 = (126, 177, 255)
S5 = (167, 139, 250)


def find_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        # macOS
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        # Linux
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        if bold
        else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for c in candidates:
        if Path(c).exists():
            try:
                return ImageFont.truetype(c, size)
            except Exception:
                pass
    return ImageFont.load_default()


def app_icon(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size), BG_DARK)
    d = ImageDraw.Draw(img)
    # Orange chevron block in lower-left.
    pad = max(2, size // 9)
    inner = size - pad * 2
    # Background panel.
    d.rounded_rectangle(
        (pad, pad, size - pad, size - pad),
        radius=max(4, size // 8),
        fill=PANEL,
    )
    # Chevron — drawn as a triangle pointing right.
    cx = size // 2 - size // 12
    cy = size // 2
    cw = size // 3
    ch = size // 2
    d.polygon(
        [
            (cx - cw // 2, cy - ch // 2),
            (cx + cw // 2, cy),
            (cx - cw // 2, cy + ch // 2),
        ],
        fill=ORANGE,
    )
    # Bottom orange accent bar.
    bar_h = max(2, size // 14)
    d.rectangle((pad, size - pad - bar_h, size - pad, size - pad), fill=ORANGE)
    return img


def app_icon_alt(size: int) -> Image.Image:
    """Inverse — orange backdrop, dark chevron."""
    img = Image.new("RGB", (size, size), ORANGE)
    d = ImageDraw.Draw(img)
    cx = size // 2 - size // 12
    cy = size // 2
    cw = size // 3
    ch = size // 2
    d.polygon(
        [
            (cx - cw // 2, cy - ch // 2),
            (cx + cw // 2, cy),
            (cx - cw // 2, cy + ch // 2),
        ],
        fill=BG_DARK,
    )
    return img


# ── Per-viz preview renderers ────────────────────────────────────────
def panel(d: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int):
    d.rounded_rectangle((x, y, x + w, y + h), radius=6, fill=PANEL)


def render_sparkline(d: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, color):
    n = 24
    pts = []
    for i in range(n):
        v = math.sin(i / 3.0) + 0.4 * math.cos(i / 1.7)
        pts.append(
            (
                x + int(w * i / (n - 1)),
                y + int(h * (1 - (v + 1.5) / 3)),
            )
        )
    d.line(pts, fill=color, width=2, joint="curve")


def render_value_tile(d, x, y, w, h):
    panel(d, x, y, w, h)
    d.text((x + 12, y + 12), "Notable events (24h)", fill=DIM, font=find_font(11))
    d.text((x + 12, y + 30), "247", fill=ORANGE, font=find_font(28, bold=True))
    d.text((x + 12, y + h - 22), "↓ -12  vs prev 24h", fill=(17, 136, 50), font=find_font(11))
    render_sparkline(d, x + w - 70, y + h - 28, 60, 18, ORANGE)


def render_sparkline_card(d, x, y, w, h):
    panel(d, x, y, w, h)
    render_sparkline(d, x + 8, y + 8, w - 16, h - 16, S2)


def render_area(d, x, y, w, h):
    panel(d, x, y, w, h)
    px, py = x + 36, y + 14
    pw, ph = w - 50, h - 36
    # gridlines
    for i in range(5):
        gy = py + int(ph * i / 4)
        d.line((px, gy, px + pw, gy), fill=EDGE[:3], width=1)
    # series
    for color, phase in [(S2, 0), (ORANGE, 1.2), (S4, 2.4)]:
        pts = []
        for i in range(24):
            v = (math.sin(i / 4 + phase) + 1) / 2
            pts.append((px + int(pw * i / 23), py + int(ph * (1 - v))))
        d.line(pts, fill=color, width=2, joint="curve")


def render_column(d, x, y, w, h):
    panel(d, x, y, w, h)
    px, py = x + 36, y + 14
    pw, ph = w - 50, h - 36
    n = 16
    bw = max(3, pw // (n * 2))
    for i in range(n):
        v = (math.sin(i / 2.0) + 1) / 2 * 0.85 + 0.1
        bx = px + int(pw * i / n) + 2
        bh = int(ph * v)
        color = ORANGE if i == 7 else S2
        d.rounded_rectangle(
            (bx, py + ph - bh, bx + bw, py + ph),
            radius=2,
            fill=color,
        )


def render_h_bar(d, x, y, w, h):
    panel(d, x, y, w, h)
    rows = [
        ("firewall", 0.95, ORANGE),
        ("proxy", 0.66, S2),
        ("edr", 0.55, S2),
        ("auth", 0.44, S3),
        ("dns", 0.38, S3),
        ("vpn", 0.30, S4),
    ]
    pad = 12
    rh = (h - pad * 2) / len(rows)
    for i, (lbl, frac, color) in enumerate(rows):
        ry = y + pad + i * rh + rh / 2
        d.text((x + pad, ry - 5), lbl, fill=TEXT, font=find_font(10))
        track_x = x + pad + 60
        track_w = w - pad - 60 - 30 - pad
        d.rounded_rectangle(
            (track_x, ry - 3, track_x + track_w, ry + 3), radius=3, fill=(50, 60, 75)
        )
        d.rounded_rectangle(
            (track_x, ry - 3, track_x + int(track_w * frac), ry + 3),
            radius=3,
            fill=color,
        )


def render_heatmap(d, x, y, w, h):
    panel(d, x, y, w, h)
    rows = 6
    cols = 10
    pad = 14
    cw = (w - pad * 2 - 60) // cols
    rh = (h - pad * 2 - 14) // rows
    for r in range(rows):
        for c in range(cols):
            v = ((math.sin(r * 0.7 + c * 0.5) + 1) / 2)
            if v < 0.25:
                col = (40, 50, 65)
            elif v < 0.5:
                col = S4
            elif v < 0.75:
                col = S2
            else:
                col = ORANGE
            cx = x + pad + 60 + c * cw
            cy = y + pad + r * rh
            d.rectangle((cx + 1, cy + 1, cx + cw - 1, cy + rh - 1), fill=col)


def render_ring(d, x, y, w, h):
    panel(d, x, y, w, h)
    cx, cy = x + w // 2, y + h // 2
    r = min(w, h) // 2 - 18
    # Track.
    d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(50, 60, 75), width=10)
    # Arc — Pillow doesn't do thick arcs nicely, fake it with arc.
    d.arc((cx - r, cy - r, cx + r, cy + r), -90, -90 + 360 * 0.62, fill=ORANGE, width=10)
    d.text((cx - 12, cy - 10), "62", fill=TEXT, font=find_font(20, bold=True))


def render_donut(d, x, y, w, h):
    panel(d, x, y, w, h)
    cx, cy = x + w // 3, y + h // 2
    r = min(w, h) // 2 - 18
    segs = [(0.40, S2), (0.30, S3), (0.20, S4), (0.10, S5)]
    a0 = -90
    for frac, color in segs:
        a1 = a0 + 360 * frac
        d.arc((cx - r, cy - r, cx + r, cy + r), a0, a1, fill=color, width=14)
        a0 = a1
    d.text((cx - 28, cy - 6), "$10.9M", fill=TEXT, font=find_font(11, bold=True))


def render_funnel(d, x, y, w, h):
    panel(d, x, y, w, h)
    stages = [1.0, 0.62, 0.50, 0.36, 0.28, 0.18]
    pad = 14
    rh = (h - pad * 2) / len(stages)
    track_x = x + pad + 50
    track_w = w - pad * 2 - 50 - 40
    for i, frac in enumerate(stages):
        ry = y + pad + i * rh + rh / 2
        d.rounded_rectangle(
            (track_x, ry - 8, track_x + int(track_w * frac), ry + 8),
            radius=3,
            fill=S2,
        )


def render_status_chip(d, x, y, w, h):
    panel(d, x, y, w, h)
    cy = y + h // 2
    d.rounded_rectangle((x + 30, cy - 14, x + w - 30, cy + 14), radius=4, fill=(40, 50, 65))
    d.ellipse((x + 38, cy - 5, x + 48, cy + 5), fill=ORANGE)
    d.text((x + 56, cy - 7), "Notables  1247", fill=TEXT, font=find_font(12))


def render_data_table(d, x, y, w, h):
    panel(d, x, y, w, h)
    pad = 12
    d.text((x + pad, y + pad), "SEVERITY  EVENT  SOURCE  TIME", fill=DIM, font=find_font(9))
    rows = [("High", S2), ("Crit", ORANGE), ("Med", (203, 167, 0)), ("Low", S4)]
    for i, (sev, col) in enumerate(rows):
        ry = y + pad + 22 + i * 16
        d.rounded_rectangle((x + pad, ry, x + pad + 36, ry + 12), radius=2, fill=col)
        d.text((x + pad + 50, ry), "Event " + str(i), fill=TEXT, font=find_font(10))


def render_pop_grid(d, x, y, w, h):
    panel(d, x, y, w, h)
    pad = 8
    cols = 4
    rows = 2
    cw = (w - pad * 2) // cols
    ch = (h - pad * 2) // rows
    statuses = [(17, 136, 50), (203, 167, 0), (212, 31, 31)]
    for r in range(rows):
        for c in range(cols):
            cx = x + pad + c * cw + 2
            cy = y + pad + r * ch + 2
            d.rounded_rectangle(
                (cx, cy, cx + cw - 4, cy + ch - 4), radius=3, fill=(42, 51, 66)
            )
            color = statuses[(r * cols + c) % 3]
            d.ellipse((cx + cw - 18, cy + 6, cx + cw - 12, cy + 12), fill=color)


def render_app_bar(d, x, y, w, h):
    panel(d, x, y, w, h)
    cy = y + h // 2
    d.text((x + 12, cy - 8), "›", fill=ORANGE, font=find_font(16, bold=True))
    d.text((x + 24, cy - 7), "splunk", fill=TEXT, font=find_font(13, bold=True))
    items = ["Apps", "Search", "Dash", "Alerts"]
    nx = x + 100
    for i, it in enumerate(items):
        d.text((nx, cy - 6), it, fill=TEXT if i == 2 else DIM, font=find_font(10))
        if i == 2:
            d.rectangle((nx, cy + 8, nx + 28, cy + 10), fill=ORANGE)
        nx += 38


def render_filter_strip(d, x, y, w, h):
    panel(d, x, y, w, h)
    cy = y + h // 2
    nx = x + 14
    for lbl in ["Time: 24h", "Env: Prod", "Index: notable"]:
        d.rounded_rectangle((nx, cy - 12, nx + 70, cy + 12), radius=4, fill=(40, 50, 65))
        d.text((nx + 6, cy - 5), lbl, fill=TEXT, font=find_font(10))
        nx += 78
    d.rounded_rectangle((x + w - 80, cy - 12, x + w - 12, cy + 12), radius=4, fill=ORANGE)
    d.text((x + w - 70, cy - 5), "Run search", fill=(255, 255, 255), font=find_font(10, bold=True))


def render_dashboard_frame(d, x, y, w, h):
    # Bigger composition.
    d.rectangle((x, y, x + w, y + h), fill=BG_DARK)
    # App bar.
    bar_h = 18
    d.rectangle((x, y, x + w, y + bar_h), fill=PANEL)
    d.text((x + 8, y + 4), "› splunk", fill=TEXT, font=find_font(10, bold=True))
    # Title.
    d.text((x + 12, y + bar_h + 8), "Security ops", fill=TEXT, font=find_font(14, bold=True))
    # Pills.
    d.rounded_rectangle(
        (x + w - 50, y + bar_h + 10, x + w - 12, y + bar_h + 22), radius=3, fill=PANEL
    )
    # Body grid.
    by = y + bar_h + 36
    for r in range(2):
        for c in range(3):
            cx = x + 12 + c * (w - 24) // 3
            cy = by + r * 30
            d.rounded_rectangle(
                (cx + 2, cy, cx + (w - 24) // 3 - 4, cy + 26), radius=4, fill=PANEL
            )


def render_wordmark(d, x, y, w, h):
    d.rectangle((x, y, x + w, y + h), fill=BG_DARK)
    cy = y + h // 2
    d.text((x + w // 2 - 50, cy - 10), "›", fill=ORANGE, font=find_font(20, bold=True))
    d.text((x + w // 2 - 36, cy - 9), "splunk", fill=TEXT, font=find_font(18, bold=True))


VIZ_RENDERERS = {
    "single_value_tile": render_value_tile,
    "sparkline": render_sparkline_card,
    "area_chart": render_area,
    "column_chart": render_column,
    "h_bar_list": render_h_bar,
    "heatmap": render_heatmap,
    "ring_gauge": render_ring,
    "donut": render_donut,
    "funnel": render_funnel,
    "status_chip": render_status_chip,
    "data_table": render_data_table,
    "pop_grid": render_pop_grid,
    "app_bar": render_app_bar,
    "filter_strip": render_filter_strip,
    "dashboard_frame": render_dashboard_frame,
    "wordmark": render_wordmark,
}


def write_preview(viz_name: str) -> None:
    img = Image.new("RGB", (256, 144), BG_DARK)
    d = ImageDraw.Draw(img)
    renderer = VIZ_RENDERERS.get(viz_name)
    if renderer is None:
        # Generic placeholder.
        d.text((20, 60), viz_name, fill=TEXT, font=find_font(14, bold=True))
    else:
        renderer(d, 0, 0, 256, 144)
    out = VIZ_ROOT / viz_name / "preview.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "PNG")
    print(f"  preview: {out.relative_to(ROOT)}")


def main() -> int:
    STATIC.mkdir(parents=True, exist_ok=True)
    print("App icons:")
    app_icon(36).save(STATIC / "appIcon.png", "PNG")
    print(f"  {STATIC.name}/appIcon.png")
    app_icon(72).save(STATIC / "appIcon_2x.png", "PNG")
    print(f"  {STATIC.name}/appIcon_2x.png")
    app_icon_alt(36).save(STATIC / "appIconAlt.png", "PNG")
    print(f"  {STATIC.name}/appIconAlt.png")
    app_icon_alt(72).save(STATIC / "appIconAlt_2x.png", "PNG")
    print(f"  {STATIC.name}/appIconAlt_2x.png")

    print("\nViz previews (256×144):")
    for viz_name in sorted(VIZ_RENDERERS.keys()):
        write_preview(viz_name)

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
