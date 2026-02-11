#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests

OPENDOTA_BASE = "https://api.opendota.com/api"

# Rendering/world mapping
MINIMAP_RENDER_SIZE = 512.0
MINIMAP_GRID_SIZE = 127.0
MINIMAP_GRID_OFFSET = 64.0
MINIMAP_SOURCE_CENTER_OFFSET = 0.5
WORLD_BOUNDS_MIN = (-8448.0, -9472.0)
WORLD_BOUNDS_MAX = (8448.0, 8448.0)
CLAMP_RENDER_TO_MAP = True
DEFAULT_Z = 256.0

# Data defaults
# DEFAULT_PLAYERS = [10366616]
DEFAULT_PLAYERS = [10366616, 25907144, 847565596, 108958769]
DEFAULT_WARD_TYPES = "obs,sen"
DEFAULT_DATE_DAYS: Optional[int] = 30
DEFAULT_PATCH: Optional[str] = "59"
DEFAULT_WIN: Optional[int] = 1
DEFAULT_PER_PLAYER_TOP = 0  # 0 = all points from wardmap

# Quality filtering/merge
PER_PLAYER_MIN_COUNT = 2
PER_PLAYER_MERGE_DISTANCE_WORLD = 40.0
PER_PLAYER_POPULARITY_DISTANCE_WORLD = 120.0

OVERLAY_DISTANCE_WORLD = 90.0
MIN_CLUSTER_PLAYER_SUPPORT = 2
INCLUDE_UNSHARED_CLUSTERS = True

DEFAULT_OUTPUT_PATH = (
    Path(__file__).resolve().parent
    / "scripts_files"
    / "data"
    / "ward_sources"
    / "opendota_pro_overlay_wards.json"
)


def minimap_to_render_xy(mx: float, my: float) -> Tuple[float, float]:
    scale = MINIMAP_RENDER_SIZE / MINIMAP_GRID_SIZE
    source_x = float(mx) + MINIMAP_SOURCE_CENTER_OFFSET
    source_y = float(my) + MINIMAP_SOURCE_CENTER_OFFSET
    render_x = (source_x - MINIMAP_GRID_OFFSET) * scale
    render_y = (MINIMAP_GRID_SIZE - (source_y - MINIMAP_GRID_OFFSET)) * scale
    return render_x, render_y


def clamp_grid(x: float, lo: float = 0.0, hi: float = MINIMAP_RENDER_SIZE) -> float:
    return max(lo, min(hi, x))


def render_to_world_xy(render_x: float, render_y: float) -> Tuple[float, float]:
    if CLAMP_RENDER_TO_MAP:
        render_x = clamp_grid(render_x, 0.0, MINIMAP_RENDER_SIZE)
        render_y = clamp_grid(render_y, 0.0, MINIMAP_RENDER_SIZE)

    size_x = WORLD_BOUNDS_MAX[0] - WORLD_BOUNDS_MIN[0]
    size_y = WORLD_BOUNDS_MAX[1] - WORLD_BOUNDS_MIN[1]
    nx = render_x / MINIMAP_RENDER_SIZE
    ny_top = render_y / MINIMAP_RENDER_SIZE

    world_x = WORLD_BOUNDS_MIN[0] + nx * size_x
    world_y = WORLD_BOUNDS_MAX[1] - ny_top * size_y
    return world_x, world_y


def _flatten_heatmap(obj: Any) -> Dict[Tuple[int, int], float]:
    out: Dict[Tuple[int, int], float] = {}
    if obj is None:
        return out

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


def parse_wardmap_by_type(
    payload: Dict[str, Any], *, ward_types: Iterable[str]
) -> Dict[str, Dict[Tuple[int, int], float]]:
    out: Dict[str, Dict[Tuple[int, int], float]] = {}
    for wt in ward_types:
        out[wt] = _flatten_heatmap(payload.get(wt))
    return out


def top_cells(points: Dict[Tuple[int, int], float], n: int) -> List[Tuple[int, int, float]]:
    items = [(x, y, w) for (x, y), w in points.items() if w > 0]
    items.sort(key=lambda t: t[2], reverse=True)
    if n <= 0:
        return items
    return items[:n]


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

        total_weight = 0.0
        sx = sy = sz = 0.0
        srx = sry = 0.0
        smx = smy = 0.0
        teams: set[str] = set()
        ward_type = rows[component_indices[0]]["type"]
        player_id = rows[component_indices[0]]["playerId"]
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
                "playerId": player_id,
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


def keep_most_popular_nearby(rows: List[Dict[str, Any]], max_distance_world: float) -> List[Dict[str, Any]]:
    if max_distance_world <= 0 or len(rows) <= 1:
        return rows

    threshold_sq = max_distance_world * max_distance_world
    ranked = sorted(rows, key=lambda item: -int(item.get("count", 1)))
    kept: List[Dict[str, Any]] = []
    for candidate in ranked:
        if all(squared_distance_world_3d(candidate, existing) > threshold_sq for existing in kept):
            kept.append(candidate)
    return kept


def overlay_across_players(rows: List[Dict[str, Any]], distance_world: float) -> List[Dict[str, Any]]:
    if not rows:
        return []
    if distance_world <= 0:
        return rows

    threshold_sq = distance_world * distance_world
    used = [False] * len(rows)
    out: List[Dict[str, Any]] = []

    for i in range(len(rows)):
        if used[i]:
            continue

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

        total_weight = 0.0
        sx = sy = sz = 0.0
        srx = sry = 0.0
        smx = smy = 0.0
        teams: set[str] = set()
        player_ids: set[int] = set()
        total_count = 0
        ward_type = rows[component_indices[0]]["type"]

        for idx in component_indices:
            row = rows[idx]
            count = int(row.get("count", 1))
            weight = float(max(1, count))
            total_weight += weight
            sx += float(row["x"]) * weight
            sy += float(row["y"]) * weight
            sz += float(row.get("z", DEFAULT_Z)) * weight
            srx += float(row.get("renderX", 0.0)) * weight
            sry += float(row.get("renderY", 0.0)) * weight
            smx += float(row.get("minimapX", 0.0)) * weight
            smy += float(row.get("minimapY", 0.0)) * weight
            total_count += count
            pid = row.get("playerId")
            if isinstance(pid, int):
                player_ids.add(pid)
            for team in row.get("teams", []):
                if isinstance(team, str):
                    teams.add(team)

        if total_weight <= 0:
            continue

        support = len(player_ids)

        out.append(
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
                "playerSupport": support,
                "playerIds": sorted(player_ids),
            }
        )

    out.sort(key=lambda item: (item["type"], -int(item.get("playerSupport", 0)), -int(item.get("count", 0))))
    return out


def resolve_patch_id(session: requests.Session, patch_arg: Optional[str], timeout: float) -> Optional[int]:
    if patch_arg is None:
        return None
    raw = patch_arg.strip()
    if raw == "":
        return None
    if raw.isdigit():
        return int(raw)

    url = f"{OPENDOTA_BASE}/constants/patch"
    response = session.get(url, timeout=timeout)
    response.raise_for_status()
    payload = response.json()

    best_id: Optional[int] = None
    if isinstance(payload, list):
        for item in payload:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            pid = item.get("id")
            if not isinstance(pid, int) or not name:
                continue
            if name == raw or name.startswith(raw):
                if best_id is None or pid > best_id:
                    best_id = pid
    elif isinstance(payload, dict):
        for key, value in payload.items():
            try:
                pid = int(key)
            except Exception:
                continue
            name = ""
            if isinstance(value, dict):
                name = str(value.get("name") or "").strip()
            if name == raw or name.startswith(raw):
                if best_id is None or pid > best_id:
                    best_id = pid

    if best_id is None:
        raise ValueError(
            f"Patch '{patch_arg}' not found in OpenDota constants. "
            "Use numeric id or version like 7.40."
        )
    return best_id


def fetch_player_wardmap(
    session: requests.Session,
    account_id: int,
    *,
    timeout: float,
    sleep_s: float,
    date_days: Optional[int],
    patch: Optional[int],
    win: Optional[int],
) -> Dict[str, Any]:
    url = f"{OPENDOTA_BASE}/players/{account_id}/wardmap"
    params: Dict[str, Any] = {}
    if date_days is not None and date_days > 0:
        params["date"] = int(date_days)
    if patch is not None:
        params["patch"] = int(patch)
    if win is not None:
        params["win"] = int(win)

    r = session.get(url, params=params or None, timeout=timeout)
    r.raise_for_status()
    if sleep_s > 0:
        time.sleep(sleep_s)
    return r.json()


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Build high-quality overlaid pro ward spots from multiple OpenDota player wardmaps."
    )
    ap.add_argument("--players", nargs="+", type=int, default=DEFAULT_PLAYERS)
    ap.add_argument("--ward-types", default=DEFAULT_WARD_TYPES)
    ap.add_argument("--patch", default=DEFAULT_PATCH)
    ap.add_argument("--date-days", type=int, default=DEFAULT_DATE_DAYS)
    ap.add_argument("--win", type=int, default=DEFAULT_WIN)
    ap.add_argument("--per-player-top", type=int, default=DEFAULT_PER_PLAYER_TOP)
    ap.add_argument("--sleep", type=float, default=0.2)
    ap.add_argument("--timeout", type=float, default=20.0)
    ap.add_argument("--out", default=str(DEFAULT_OUTPUT_PATH))
    args = ap.parse_args()

    ward_types = [s.strip() for s in args.ward_types.split(",") if s.strip()]
    valid = {"obs", "sen"}
    for wt in ward_types:
        if wt not in valid:
            raise SystemExit(f"Unknown ward type: {wt}. Use obs and/or sen.")
    if len(args.players) == 0:
        raise SystemExit("Players list is empty.")

    session = requests.Session()
    session.headers.update({"User-Agent": "ward-pro-overlay/1.0"})

    try:
        patch_id = resolve_patch_id(session, args.patch, args.timeout)
    except Exception as error:
        raise SystemExit(f"Failed to resolve patch '{args.patch}': {error}")

    type_label = {"obs": "Observer", "sen": "Sentry"}

    per_player_rows: List[Dict[str, Any]] = []
    per_player_counts: Dict[int, int] = {}

    for pid in args.players:
        payload = fetch_player_wardmap(
            session,
            pid,
            timeout=args.timeout,
            sleep_s=args.sleep,
            date_days=(args.date_days if args.date_days and args.date_days > 0 else None),
            patch=patch_id,
            win=args.win,
        )
        hm_by_type = parse_wardmap_by_type(payload, ward_types=ward_types)

        player_rows: List[Dict[str, Any]] = []
        for wt in ward_types:
            points = top_cells(hm_by_type.get(wt, {}), args.per_player_top)
            for x, y, w in points:
                minimap_x = float(x)
                minimap_y = float(y)
                render_x, render_y = minimap_to_render_xy(minimap_x, minimap_y)
                world_x, world_y = render_to_world_xy(render_x, render_y)
                if CLAMP_RENDER_TO_MAP:
                    render_x = clamp_grid(render_x, 0.0, MINIMAP_RENDER_SIZE)
                    render_y = clamp_grid(render_y, 0.0, MINIMAP_RENDER_SIZE)
                player_rows.append(
                    {
                        "playerId": int(pid),
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

        # Per-player denoise before overlay
        by_type_rows: Dict[str, List[Dict[str, Any]]] = {}
        for row in player_rows:
            by_type_rows.setdefault(str(row["type"]), []).append(row)

        cleaned_player_rows: List[Dict[str, Any]] = []
        for _, rows in by_type_rows.items():
            merged = merge_nearby_rows(rows, PER_PLAYER_MERGE_DISTANCE_WORLD)
            filtered = keep_most_popular_nearby(merged, PER_PLAYER_POPULARITY_DISTANCE_WORLD)
            filtered = [row for row in filtered if int(row.get("count", 0)) >= PER_PLAYER_MIN_COUNT]
            cleaned_player_rows.extend(filtered)

        per_player_rows.extend(cleaned_player_rows)
        per_player_counts[int(pid)] = len(cleaned_player_rows)

    # Overlay all players, but keep only clusters supported by >= MIN_CLUSTER_PLAYER_SUPPORT players.
    out: List[Dict[str, Any]] = []
    by_type_overlay: Dict[str, List[Dict[str, Any]]] = {}
    for row in per_player_rows:
        by_type_overlay.setdefault(str(row["type"]), []).append(row)

    base_min_support = min(
        max(1, MIN_CLUSTER_PLAYER_SUPPORT),
        len(args.players)
    )
    effective_min_support = 1 if INCLUDE_UNSHARED_CLUSTERS else base_min_support
    for _, rows in by_type_overlay.items():
        clustered = overlay_across_players(rows, OVERLAY_DISTANCE_WORLD)
        out.extend(
            row
            for row in clustered
            if int(row.get("playerSupport", 0)) >= effective_min_support
        )

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
                "patch": args.patch,
                "patch_id": patch_id,
                "date_days": args.date_days,
                "win": args.win,
                "per_player_top": args.per_player_top,
                "per_player_min_count": PER_PLAYER_MIN_COUNT,
                "per_player_merge_distance_world": PER_PLAYER_MERGE_DISTANCE_WORLD,
                "per_player_popularity_distance_world": PER_PLAYER_POPULARITY_DISTANCE_WORLD,
                "overlay_distance_world": OVERLAY_DISTANCE_WORLD,
                "min_cluster_player_support": MIN_CLUSTER_PLAYER_SUPPORT,
                "include_unshared_clusters": INCLUDE_UNSHARED_CLUSTERS,
                "base_min_cluster_player_support": base_min_support,
                "effective_min_cluster_player_support": effective_min_support,
                "per_player_rows": per_player_counts,
                "rows_after_overlay": len(out),
                "out": str(out_path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
