#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
render_ward_reco_map.py

Визуальная карта рекомендаций вардов из ward_reco_dataset.runtime.json (schema v5).

Строит контактную сетку: строки = тайм-бакеты, столбцы = (team x ward type).
В каждой ячейке поверх map.png:
  - все споты группы рисуются тускло (радиус ~ score),
  - топ-N, который реально выбрал бы рантайм-селектор (сортировка по score +
    пространственный declutter), подсвечивается ярко с номером ранга.

Это оффлайн-зеркало логики VisibleWardSelector (фильтр time_bucket+team -> score
-> spacing dedupe -> topN), чтобы глазами понять, что именно мы рекомендуем.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
DEFAULT_DATASET = HERE / "scripts_files" / "data" / "ward_reco_dataset.runtime.json"
DEFAULT_MAP = HERE / "map.png"
DEFAULT_OUT_DIR = HERE / "scripts_files" / "data" / "debug" / "reco_map"

# Те же константы, что в build_ward_reco_runtime.py / OpenDota wardmap grid.
GRID_OFFSET = 64.0
GRID_SIZE = 127.0
WORLD_CELL_SIZE = 128.0
WORLD_ORIGIN_OFFSET = 16384.0

BUCKET_ORDER = ["0_12", "12_25", "25_50", "50_plus"]
BUCKET_LABEL = {
    "0_12": "0-12 min",
    "12_25": "12-25 min",
    "25_50": "25-50 min",
    "50_plus": "50+ min",
}
# (team, type) -> (column title, base RGB)
COLUMNS = [
    ("radiant", "Observer", "Radiant Observer", (90, 220, 120)),
    ("radiant", "Sentry", "Radiant Sentry", (120, 180, 255)),
    ("dire", "Observer", "Dire Observer", (245, 200, 70)),
    ("dire", "Sentry", "Dire Sentry", (255, 120, 120)),
]


def world_to_px(wx: float, wy: float, w: int, h: int) -> tuple[float, float]:
    mx = (float(wx) + WORLD_ORIGIN_OFFSET) / WORLD_CELL_SIZE
    my = (float(wy) + WORLD_ORIGIN_OFFSET) / WORLD_CELL_SIZE
    px = (mx - GRID_OFFSET) * (w / GRID_SIZE)
    py = (GRID_SIZE - (my - GRID_OFFSET)) * (h / GRID_SIZE)
    return px, py


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for candidate in (
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        try:
            return ImageFont.truetype(candidate, size)
        except Exception:
            continue
    return ImageFont.load_default()


def cell_distance(a: dict[str, Any], b: dict[str, Any]) -> float:
    ax, ay = a["cell"]["x"], a["cell"]["y"]
    bx, by = b["cell"]["x"], b["cell"]["y"]
    return ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5


def select_top(
    spots: list[dict[str, Any]], top_n: int, min_cell_dist: float
) -> list[dict[str, Any]]:
    """Зеркало рантайма: сортировка по score, жадный spacing-dedup, topN."""
    ranked = sorted(spots, key=lambda s: -float(s["stats"]["score"]))
    out: list[dict[str, Any]] = []
    for spot in ranked:
        if any(cell_distance(spot, kept) < min_cell_dist for kept in out):
            continue
        out.append(spot)
        if len(out) >= top_n:
            break
    return out


def draw_panel(
    base_map: Image.Image,
    spots: list[dict[str, Any]],
    selected: list[dict[str, Any]],
    color: tuple[int, int, int],
    font_small: ImageFont.FreeTypeFont,
) -> Image.Image:
    w, h = base_map.size
    panel = base_map.copy().convert("RGBA")
    # затемняем фон, чтобы точки читались
    dark = Image.new("RGBA", (w, h), (0, 0, 0, 90))
    panel = Image.alpha_composite(panel, dark)
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    selected_ids = {s["spot_id"] for s in selected}
    max_score = max((float(s["stats"]["score"]) for s in spots), default=1.0) or 1.0

    # все споты — тускло
    for spot in spots:
        if spot["spot_id"] in selected_ids:
            continue
        px, py = world_to_px(spot["world_avg"]["x"], spot["world_avg"]["y"], w, h)
        score = float(spot["stats"]["score"])
        r = 2.0 + 4.0 * (score / max_score)
        draw.ellipse(
            [px - r, py - r, px + r, py + r],
            fill=(color[0], color[1], color[2], 70),
        )

    # топ-N — ярко, с рангом
    for rank, spot in enumerate(selected, start=1):
        px, py = world_to_px(spot["world_avg"]["x"], spot["world_avg"]["y"], w, h)
        score = float(spot["stats"]["score"])
        r = 5.0 + 7.0 * (score / max_score)
        draw.ellipse(
            [px - r, py - r, px + r, py + r],
            fill=(color[0], color[1], color[2], 235),
            outline=(255, 255, 255, 255),
            width=2,
        )
        label = str(rank)
        tb = draw.textbbox((0, 0), label, font=font_small)
        tw, th = tb[2] - tb[0], tb[3] - tb[1]
        draw.text(
            (px - tw / 2, py - th / 2 - tb[1]),
            label,
            font=font_small,
            fill=(15, 15, 15, 255),
        )

    return Image.alpha_composite(panel, overlay)


def group_key(spot: dict[str, Any]) -> tuple[str, str, str]:
    return (str(spot["team"]), str(spot["type"]), str(spot["time_bucket"]))


def build_contact_sheet(
    dataset: dict[str, Any],
    base_map: Image.Image,
    top_n: int,
    min_cell_dist: float,
    panel_size: int,
) -> Image.Image:
    spots = dataset["spots"]
    groups: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for spot in spots:
        groups.setdefault(group_key(spot), []).append(spot)

    map_panel = base_map.resize((panel_size, panel_size))
    font_small = load_font(max(11, panel_size // 26))
    font_title = load_font(max(14, panel_size // 18))
    font_head = load_font(max(16, panel_size // 15))

    margin_left = panel_size // 2
    margin_top = panel_size // 5
    gap = 14
    cols = len(COLUMNS)
    rows = len(BUCKET_ORDER)
    sheet_w = margin_left + cols * (panel_size + gap)
    sheet_h = margin_top + rows * (panel_size + gap) + margin_top
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (18, 18, 22, 255))
    sdraw = ImageDraw.Draw(sheet)

    title = (
        f"Ward recommendations — {dataset.get('source', {}).get('matches_used', '?')} matches "
        f"(schema v{dataset.get('schema_version', '?')}) — bright+numbered = top-{top_n} selected"
    )
    sdraw.text((gap, gap), title, font=font_head, fill=(235, 235, 235, 255))

    # заголовки столбцов
    for ci, (_, _, col_title, color) in enumerate(COLUMNS):
        x = margin_left + ci * (panel_size + gap)
        sdraw.text(
            (x + 6, margin_top - font_title.size - 4),
            col_title,
            font=font_title,
            fill=(color[0], color[1], color[2], 255),
        )

    for ri, bucket in enumerate(BUCKET_ORDER):
        y = margin_top + ri * (panel_size + gap)
        sdraw.text(
            (gap, y + panel_size // 2),
            BUCKET_LABEL[bucket],
            font=font_title,
            fill=(220, 220, 220, 255),
        )
        for ci, (team, wtype, _, color) in enumerate(COLUMNS):
            x = margin_left + ci * (panel_size + gap)
            grp = groups.get((team, wtype, bucket), [])
            selected = select_top(grp, top_n, min_cell_dist)
            panel = draw_panel(map_panel, grp, selected, color, font_small)
            sheet.paste(panel, (x, y), panel)
            sdraw.text(
                (x + 4, y + 2),
                f"{len(grp)} spots / top {len(selected)}",
                font=font_small,
                fill=(255, 255, 255, 220),
            )

    return sheet.convert("RGB")


def print_summary(dataset: dict[str, Any], top_n: int, min_cell_dist: float) -> None:
    spots = dataset["spots"]
    groups: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for spot in spots:
        groups.setdefault(group_key(spot), []).append(spot)
    print(f"total spots: {len(spots)}")
    for team, wtype, _, _ in COLUMNS:
        for bucket in BUCKET_ORDER:
            grp = groups.get((team, wtype, bucket), [])
            sel = select_top(grp, top_n, min_cell_dist)
            top = sel[0] if sel else None
            top_str = (
                f"top score={float(top['stats']['score']):.3f} "
                f"@({top['world_avg']['x']:.0f},{top['world_avg']['y']:.0f})"
                if top
                else "—"
            )
            print(
                f"  {team:7} {wtype:8} {bucket:7}: {len(grp):3} spots, "
                f"selected {len(sel)} | {top_str}"
            )


def main() -> int:
    ap = argparse.ArgumentParser(description="Render ward recommendation map from runtime dataset.")
    ap.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    ap.add_argument("--map", type=Path, default=DEFAULT_MAP)
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    ap.add_argument("--top", type=int, default=8, help="Top-N selected per group.")
    ap.add_argument(
        "--min-cell-dist",
        type=float,
        default=3.0,
        help="Min minimap-cell distance between selected spots (declutter).",
    )
    ap.add_argument("--panel-size", type=int, default=380)
    args = ap.parse_args()

    dataset = json.loads(args.dataset.read_text(encoding="utf-8"))
    base_map = Image.open(args.map).convert("RGBA")
    args.out_dir.mkdir(parents=True, exist_ok=True)

    sheet = build_contact_sheet(
        dataset, base_map, args.top, args.min_cell_dist, args.panel_size
    )
    out_path = args.out_dir / "ward_reco_overview.png"
    sheet.save(out_path)
    print(f"OK: wrote {out_path} ({sheet.size[0]}x{sheet.size[1]})")
    print_summary(dataset, args.top, args.min_cell_dist)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
