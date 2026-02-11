#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
ward_aggregate.py

Fetch wardmap for multiple players from OpenDota, stack heatmaps, compute:
- overall centroid (weighted average) in minimap 256x256 space
- top-N hottest cells (by stacked weight)

Then convert minimap coords -> world (Dota units) using provided bounds, and output JSON.

Endpoint used:
GET https://api.opendota.com/api/players/{account_id}/wardmap
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests


OPENDOTA_BASE = "https://api.opendota.com/api"


MINIMAP_RENDER_SIZE = 512.0
MINIMAP_GRID_SIZE = 127.0
MINIMAP_GRID_OFFSET = 64.0
# Shift source minimap coords to cell center (classic +0.5 for grid bins).
# For sources with already precise fractional x/y you may prefer 0.0.
MINIMAP_SOURCE_CENTER_OFFSET = 0.5
WORLD_BOUNDS_MIN = (-8448.0, -9472.0)
WORLD_BOUNDS_MAX = (8448.0, 8448.0)
CLAMP_RENDER_TO_MAP = True
DEFAULT_Z = 256.0
DEFAULT_OUTPUT_PATH = (
    Path(__file__).resolve().parent
    / "scripts_files"
    / "data"
    / "ward_sources"
    / "wards_aggregated.json"
)
DEFAULT_PLAYERS = [10366616]
DEFAULT_WARD_TYPES = "obs,sen"
DEFAULT_TOP = 0  # 0 means: export all points
DEFAULT_DATE_DAYS: Optional[int] = 30
DEFAULT_PATCH: Optional[str] = None
MERGE_NEARBY_WARDS = True
MERGE_DISTANCE_WORLD = 180.0
KEEP_MOST_POPULAR_NEARBY = True
POPULARITY_DISTANCE_WORLD = 180.0
MIN_POPULARITY_COUNT = 2


def minimap_to_render_xy(mx: float, my: float) -> Tuple[float, float]:
    """
    Convert minimap source coords with the same formula as UI:
      left = (size / 127) * (x - 64)
      top  = (size / 127) * (127 - (y - 64))
    """
    scale = MINIMAP_RENDER_SIZE / MINIMAP_GRID_SIZE
    source_x = float(mx) + MINIMAP_SOURCE_CENTER_OFFSET
    source_y = float(my) + MINIMAP_SOURCE_CENTER_OFFSET
    render_x = (source_x - MINIMAP_GRID_OFFSET) * scale
    render_y = (
        MINIMAP_GRID_SIZE - (source_y - MINIMAP_GRID_OFFSET)
    ) * scale
    return render_x, render_y


def render_to_world_xy(render_x: float, render_y: float) -> Tuple[float, float]:
    if CLAMP_RENDER_TO_MAP:
        render_x = clamp_grid(render_x, 0.0, MINIMAP_RENDER_SIZE)
        render_y = clamp_grid(render_y, 0.0, MINIMAP_RENDER_SIZE)

    size_x = WORLD_BOUNDS_MAX[0] - WORLD_BOUNDS_MIN[0]
    size_y = WORLD_BOUNDS_MAX[1] - WORLD_BOUNDS_MIN[1]
    nx = render_x / MINIMAP_RENDER_SIZE
    ny_top = render_y / MINIMAP_RENDER_SIZE

    world_x = WORLD_BOUNDS_MIN[0] + nx * size_x
    # render_y is CSS top (0 = top of minimap), so Y must be inverted into world space.
    world_y = WORLD_BOUNDS_MAX[1] - ny_top * size_y
    return world_x, world_y


def _flatten_heatmap(obj: Any) -> Dict[Tuple[int, int], float]:
    """
    Robustly parse wardmap structures into {(x,y): weight}.
    OpenDota wardmap historically returns something like:
      {"obs": {"x_y": count, ...}, "sen": {...}}
    or nested dicts, depending on version/client.
    This function attempts to handle:
      - dict of dict
      - dict with "x_y" keys
      - list of points with x/y/count
    """
    out: Dict[Tuple[int, int], float] = {}

    if obj is None:
        return out

    # Case: list of points
    if isinstance(obj, list):
        for it in obj:
            if isinstance(it, dict):
                x = it.get("x")
                y = it.get("y")
                c = it.get("count") or it.get("value") or it.get("n") or 1
                if x is not None and y is not None:
                    try:
                        xi = int(round(float(x)))
                        yi = int(round(float(y)))
                        out[(xi, yi)] = out.get((xi, yi), 0.0) + float(c)
                    except Exception:
                        pass
        return out

    if not isinstance(obj, dict):
        return out

    # If dict has string keys like "122_128"
    for k, v in obj.items():
        if isinstance(k, str) and "_" in k:
            parts = k.split("_")
            if len(parts) == 2:
                try:
                    xi = int(parts[0])
                    yi = int(parts[1])
                    out[(xi, yi)] = out.get((xi, yi), 0.0) + float(v if v is not None else 0.0)
                except Exception:
                    pass

    if out:
        return out

    # If nested dict {x: {y: count}}
    # Keys might be strings.
    nested_like = True
    for vx in obj.values():
        if not isinstance(vx, dict):
            nested_like = False
            break

    if nested_like:
        for xk, inner in obj.items():
            if not isinstance(inner, dict):
                continue
            try:
                xi = int(float(xk))
            except Exception:
                continue
            for yk, cnt in inner.items():
                try:
                    yi = int(float(yk))
                    out[(xi, yi)] = out.get((xi, yi), 0.0) + float(cnt if cnt is not None else 0.0)
                except Exception:
                    pass
        return out

    # Otherwise: unknown format
    return out


def parse_wardmap_by_type(
    payload: Dict[str, Any], *, ward_types: Iterable[str]
) -> Dict[str, Dict[Tuple[int, int], float]]:
    out: Dict[str, Dict[Tuple[int, int], float]] = {}
    for wt in ward_types:
        out[wt] = _flatten_heatmap(payload.get(wt))
    return out


def fetch_player_wardmap(
    session: requests.Session,
    account_id: int,
    *,
    timeout: float = 20.0,
    sleep_s: float = 0.0,
    date_days: Optional[int] = None,
    patch: Optional[int] = None,
) -> Dict[str, Any]:
    url = f"{OPENDOTA_BASE}/players/{account_id}/wardmap"
    params: Dict[str, Any] = {}
    if date_days is not None and date_days > 0:
        params["date"] = int(date_days)
    if patch is not None:
        params["patch"] = int(patch)
    r = session.get(url, params=params or None, timeout=timeout)
    r.raise_for_status()
    if sleep_s > 0:
        time.sleep(sleep_s)
    return r.json()


def top_cells(points: Dict[Tuple[int, int], float], n: int) -> List[Tuple[int, int, float]]:
    items = [(x, y, w) for (x, y), w in points.items() if w > 0]
    items.sort(key=lambda t: t[2], reverse=True)
    if n <= 0:
        return items
    return items[:n]


def resolve_patch_id(session: requests.Session, patch_arg: Optional[str], timeout: float) -> Optional[int]:
    if patch_arg is None:
        return None
    raw = patch_arg.strip()
    if raw == "":
        return None
    if raw.isdigit():
        return int(raw)

    # Allow human-friendly input like "7.40" by resolving through OpenDota constants.
    url = f"{OPENDOTA_BASE}/constants/patch"
    response = session.get(url, timeout=timeout)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError(f"Unexpected patch constants response type: {type(payload)}")

    best_id: Optional[int] = None
    for key, value in payload.items():
        try:
            patch_id = int(key)
        except Exception:
            continue
        name = ""
        if isinstance(value, dict):
            name = str(value.get("name") or "").strip()
        if not name:
            continue
        if name == raw or name.startswith(raw):
            if best_id is None or patch_id > best_id:
                best_id = patch_id
    if best_id is None:
        raise ValueError(
            f"Patch '{patch_arg}' not found in OpenDota constants. "
            "Use numeric id or version like 7.40."
        )
    return best_id


def clamp_grid(x: float, lo: float = 0.0, hi: float = MINIMAP_RENDER_SIZE) -> float:
    return max(lo, min(hi, x))


def squared_distance_world_3d(a: Dict[str, Any], b: Dict[str, Any]) -> float:
    dx = float(a["x"]) - float(b["x"])
    dy = float(a["y"]) - float(b["y"])
    dz = float(a.get("z", DEFAULT_Z)) - float(b.get("z", DEFAULT_Z))
    return dx * dx + dy * dy + dz * dz


def merge_nearby_rows(rows: List[Dict[str, Any]], max_distance_world: float) -> List[Dict[str, Any]]:
    if max_distance_world <= 0 or len(rows) <= 1:
        return rows

    threshold_sq = max_distance_world * max_distance_world
    used = [False] * len(rows)
    merged: List[Dict[str, Any]] = []

    for i in range(len(rows)):
        if used[i]:
            continue

        # Build connected component by distance threshold (single-link clustering).
        component_indices: List[int] = []
        queue = [i]
        used[i] = True
        while queue:
            idx = queue.pop()
            component_indices.append(idx)
            for j in range(len(rows)):
                if used[j]:
                    continue
                if squared_distance_world_3d(rows[idx], rows[j]) <= threshold_sq:
                    used[j] = True
                    queue.append(j)

        # Weighted average by count so frequent points influence center more.
        total_weight = 0.0
        sx = sy = sz = 0.0
        srx = sry = 0.0
        smx = smy = 0.0
        teams: set[str] = set()
        ward_type = rows[component_indices[0]]["type"]
        total_count = 0

        for idx in component_indices:
            row = rows[idx]
            weight = float(max(1, int(row.get("count", 1))))
            total_weight += weight
            sx += float(row["x"]) * weight
            sy += float(row["y"]) * weight
            sz += float(row.get("z", DEFAULT_Z)) * weight
            srx += float(row.get("renderX", 0.0)) * weight
            sry += float(row.get("renderY", 0.0)) * weight
            smx += float(row.get("minimapX", 0.0)) * weight
            smy += float(row.get("minimapY", 0.0)) * weight
            total_count += int(row.get("count", 1))
            for team in row.get("teams", []):
                if isinstance(team, str):
                    teams.add(team)

        if total_weight <= 0:
            continue

        merged.append(
            {
                "teams": sorted(teams) if teams else ["Radiant", "Dire"],
                "type": ward_type,
                "x": float(round(sx / total_weight, 3)),
                "y": float(round(sy / total_weight, 3)),
                "z": float(round(sz / total_weight, 3)),
                "renderX": float(round(srx / total_weight, 3)),
                "renderY": float(round(sry / total_weight, 3)),
                "minimapX": float(round(smx / total_weight, 3)),
                "minimapY": float(round(smy / total_weight, 3)),
                "count": int(total_count),
            }
        )

    return merged


def keep_most_popular_nearby(
    rows: List[Dict[str, Any]], max_distance_world: float
) -> List[Dict[str, Any]]:
    if max_distance_world <= 0 or len(rows) <= 1:
        return rows

    threshold_sq = max_distance_world * max_distance_world
    ranked = sorted(
        rows,
        key=lambda item: (
            -int(item.get("count", 1)),
            str(item.get("type", "")),
        ),
    )
    kept: List[Dict[str, Any]] = []
    for candidate in ranked:
        if all(
            squared_distance_world_3d(candidate, existing) > threshold_sq
            for existing in kept
        ):
            kept.append(candidate)
    return kept


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Aggregate OpenDota wardmaps and convert to minimap render + world (3D) coords."
    )
    ap.add_argument(
        "--players",
        nargs="+",
        type=int,
        default=DEFAULT_PLAYERS,
        help="Account IDs to aggregate.",
    )
    ap.add_argument(
        "--ward-types",
        default=DEFAULT_WARD_TYPES,
        help="Comma-separated: obs,sen.",
    )
    ap.add_argument(
        "--top",
        type=int,
        default=DEFAULT_TOP,
        help="Top cells per ward type. Use 0 to export all points.",
    )
    ap.add_argument(
        "--date-days",
        type=int,
        default=DEFAULT_DATE_DAYS,
        help="Filter OpenDota wardmap to recent N days. Use 0 to disable.",
    )
    ap.add_argument(
        "--patch",
        default=DEFAULT_PATCH,
        help="Patch filter: numeric OpenDota patch id or version text like '7.40'.",
    )
    ap.add_argument(
        "--out",
        default=str(DEFAULT_OUTPUT_PATH),
        help="Output JSON file path.",
    )
    ap.add_argument("--sleep", type=float, default=0.2, help="Sleep between requests seconds (default: 0.2).")
    ap.add_argument("--timeout", type=float, default=20.0, help="HTTP timeout seconds (default: 20).")
    args = ap.parse_args()

    ward_types = [s.strip() for s in args.ward_types.split(",") if s.strip()]
    valid = {"obs", "sen"}
    for wt in ward_types:
        if wt not in valid:
            raise SystemExit(f"Unknown ward type: {wt}. Use obs and/or sen.")

    session = requests.Session()
    session.headers.update({"User-Agent": "ward-aggregate/1.0 (+https://chatgpt)"})
    try:
        patch_id = resolve_patch_id(session, args.patch, args.timeout)
    except Exception as error:
        raise SystemExit(f"Failed to resolve patch '{args.patch}': {error}")

    stacked_by_type: Dict[str, Dict[Tuple[int, int], float]] = {wt: {} for wt in ward_types}

    for pid in args.players:
        payload = fetch_player_wardmap(
            session,
            pid,
            timeout=args.timeout,
            sleep_s=args.sleep,
            date_days=(args.date_days if args.date_days and args.date_days > 0 else None),
            patch=patch_id,
        )
        hm_by_type = parse_wardmap_by_type(payload, ward_types=ward_types)
        for wt in ward_types:
            dest = stacked_by_type[wt]
            src = hm_by_type.get(wt, {})
            for key, w in src.items():
                dest[key] = dest.get(key, 0.0) + float(w)

    type_label = {"obs": "Observer", "sen": "Sentry"}
    raw_out: List[Dict[str, Any]] = []
    for wt in ward_types:
        top_points = top_cells(stacked_by_type.get(wt, {}), args.top)
        for x, y, w in top_points:
            minimap_x = float(x)
            minimap_y = float(y)
            render_x, render_y = minimap_to_render_xy(minimap_x, minimap_y)
            world_x, world_y = render_to_world_xy(render_x, render_y)
            if CLAMP_RENDER_TO_MAP:
                render_x = clamp_grid(render_x, 0.0, MINIMAP_RENDER_SIZE)
                render_y = clamp_grid(render_y, 0.0, MINIMAP_RENDER_SIZE)
            raw_out.append(
                {
                    "teams": ["Radiant", "Dire"],
                    "type": type_label.get(wt, wt),
                    "x": float(round(world_x, 3)),
                    "y": float(round(world_y, 3)),
                    "z": float(DEFAULT_Z),
                    "renderX": float(round(render_x, 3)),
                    "renderY": float(round(render_y, 3)),
                    "minimapX": minimap_x,
                    "minimapY": minimap_y,
                    "count": int(round(w)),
                }
            )

    if MERGE_NEARBY_WARDS:
        merged_out: List[Dict[str, Any]] = []
        by_type: Dict[str, List[Dict[str, Any]]] = {}
        for row in raw_out:
            by_type.setdefault(str(row["type"]), []).append(row)
        for ward_type, rows in by_type.items():
            _ = ward_type
            merged_out.extend(merge_nearby_rows(rows, MERGE_DISTANCE_WORLD))
    else:
        merged_out = raw_out

    if KEEP_MOST_POPULAR_NEARBY:
        out: List[Dict[str, Any]] = []
        by_type_after_merge: Dict[str, List[Dict[str, Any]]] = {}
        for row in merged_out:
            by_type_after_merge.setdefault(str(row["type"]), []).append(row)
        for ward_type, rows in by_type_after_merge.items():
            _ = ward_type
            out.extend(keep_most_popular_nearby(rows, POPULARITY_DISTANCE_WORLD))
    else:
        out = merged_out

    out = [row for row in out if int(row.get("count", 0)) >= MIN_POPULARITY_COUNT]
    out.sort(key=lambda item: (item["type"], -int(item.get("count", 1))))

    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"OK: wrote {out_path}")
    print(
        json.dumps(
            {
                "ok": True,
                "players": args.players,
                "ward_types": ward_types,
                "date_days": args.date_days,
                "patch": args.patch,
                "patch_id": patch_id,
                "merge_nearby_wards": MERGE_NEARBY_WARDS,
                "merge_distance_world": MERGE_DISTANCE_WORLD,
                "raw_wards": len(raw_out),
                "merged_wards": len(merged_out),
                "keep_most_popular_nearby": KEEP_MOST_POPULAR_NEARBY,
                "popularity_distance_world": POPULARITY_DISTANCE_WORLD,
                "min_popularity_count": MIN_POPULARITY_COUNT,
                "render_size": MINIMAP_RENDER_SIZE,
                "grid_size": MINIMAP_GRID_SIZE,
                "source_center_offset": MINIMAP_SOURCE_CENTER_OFFSET,
                "bounds_min": [WORLD_BOUNDS_MIN[0], WORLD_BOUNDS_MIN[1]],
                "bounds_max": [WORLD_BOUNDS_MAX[0], WORLD_BOUNDS_MAX[1]],
                "clamp_render_to_map": CLAMP_RENDER_TO_MAP,
                "wards": len(out),
                "out": str(out_path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
