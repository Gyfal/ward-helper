#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import sys
import time
import argparse
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

MATCH_ID = 8686842880
HERO_ID: Optional[int] = None  # None = все герои
AUTO_REQUEST_PARSE = False
API_KEY: Optional[str] = None

# Карта и сетка
MINIMAP_RENDER_SIZE = 512.0
MINIMAP_GRID_SIZE = 127.0
MINIMAP_GRID_OFFSET = 64.0
# Shift source minimap coords to cell center (classic +0.5 for grid bins).
# For OpenDota match logs with fractional x/y you may prefer 0.0.
MINIMAP_SOURCE_CENTER_OFFSET = 0.5
WORLD_BOUNDS_MIN = (-8448.0, -9472.0)
WORLD_BOUNDS_MAX = (8448.0, 8448.0)
CLAMP_RENDER_TO_MAP = True
DEFAULT_Z = 256.0

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch placed wards from an OpenDota match, optionally filtered by hero."
    )
    parser.add_argument("--match-id", type=int, default=MATCH_ID, help="OpenDota match id.")
    parser.add_argument(
        "--hero-id",
        type=int,
        default=HERO_ID,
        help="Filter wards by hero id (e.g. Alchemist=73). Omit to include all heroes.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Custom output path. Default: scripts_files/data/ward_sources/opendota_match_<match-id>_wards.json",
    )
    return parser.parse_args()


def build_out_path(match_id: int, out: Optional[Path]) -> Path:
    if out is not None:
        return out
    return (
        Path(__file__).resolve().parent
        / "scripts_files"
        / "data"
        / "ward_sources"
        / f"opendota_match_{match_id}_wards.json"
    )


def http_json(url: str, method: str = "GET", body: Optional[bytes] = None) -> Any:
    headers = {
        "User-Agent": "ward-fetcher/3.0",
        "Accept": "application/json",
    }
    req = Request(url, data=body, method=method, headers=headers)
    with urlopen(req, timeout=30) as resp:
        data = resp.read()
    return json.loads(data.decode("utf-8"))


def build_url(path: str) -> str:
    base = "https://api.opendota.com/api"
    url = f"{base}{path}"
    if API_KEY:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}api_key={API_KEY}"
    return url


def team_from_slot(player_slot: Any) -> str:
    try:
        return "Radiant" if int(player_slot) < 128 else "Dire"
    except Exception:
        return "Radiant"


def minimap_to_render_xy(minimap_x: float, minimap_y: float) -> Tuple[float, float]:
    """
    Формула как в UI:
      left = (size / 127) * (x - 64)
      top  = (size / 127) * (127 - (y - 64))
    По умолчанию size = 512.
    """
    scale = MINIMAP_RENDER_SIZE / MINIMAP_GRID_SIZE
    source_x = float(minimap_x) + MINIMAP_SOURCE_CENTER_OFFSET
    source_y = float(minimap_y) + MINIMAP_SOURCE_CENTER_OFFSET
    render_x = (source_x - MINIMAP_GRID_OFFSET) * scale
    render_y = (MINIMAP_GRID_SIZE - (source_y - MINIMAP_GRID_OFFSET)) * scale
    return render_x, render_y


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def render_to_world_xy(render_x: float, render_y: float) -> Tuple[float, float]:
    if CLAMP_RENDER_TO_MAP:
        render_x = clamp(render_x, 0.0, MINIMAP_RENDER_SIZE)
        render_y = clamp(render_y, 0.0, MINIMAP_RENDER_SIZE)

    size_x = WORLD_BOUNDS_MAX[0] - WORLD_BOUNDS_MIN[0]
    size_y = WORLD_BOUNDS_MAX[1] - WORLD_BOUNDS_MIN[1]
    nx = render_x / MINIMAP_RENDER_SIZE
    ny_top = render_y / MINIMAP_RENDER_SIZE

    world_x = WORLD_BOUNDS_MIN[0] + nx * size_x
    # render_y is CSS top (0 = top of minimap), so Y must be inverted into world space.
    world_y = WORLD_BOUNDS_MAX[1] - ny_top * size_y
    return world_x, world_y


def iter_player_ward_events(player: Dict[str, Any]) -> Iterable[Tuple[str, float, float]]:
    for e in player.get("obs_log") or []:
        if isinstance(e, dict) and e.get("x") is not None and e.get("y") is not None:
            yield "Observer", float(e["x"]), float(e["y"])
    for e in player.get("sen_log") or []:
        if isinstance(e, dict) and e.get("x") is not None and e.get("y") is not None:
            yield "Sentry", float(e["x"]), float(e["y"])


def main() -> int:
    args = parse_args()
    match_id = int(args.match_id)
    hero_id = args.hero_id
    out_path = build_out_path(match_id, args.out)

    match_url = build_url(f"/matches/{match_id}")
    try:
        match = http_json(match_url)
    except HTTPError as e:
        print(json.dumps({"error": f"HTTPError {e.code}", "url": match_url}, ensure_ascii=False, indent=2))
        return 2
    except URLError as e:
        print(json.dumps({"error": f"URLError {e.reason}", "url": match_url}, ensure_ascii=False, indent=2))
        return 2
    except Exception as e:
        print(json.dumps({"error": f"Exception: {e}", "url": match_url}, ensure_ascii=False, indent=2))
        return 2

    players = match.get("players") or []
    if not players:
        print(json.dumps({"match_id": match_id, "error": "No players[] in response."}, ensure_ascii=False, indent=2))
        return 3

    if hero_id is not None:
        players = [p for p in players if p.get("hero_id") == hero_id]
        if not players:
            print(
                json.dumps(
                    {"match_id": match_id, "hero_id": hero_id, "error": "No player with hero_id found."},
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return 4

    total_events = sum(len(p.get("obs_log") or []) + len(p.get("sen_log") or []) for p in players)
    if total_events == 0 and AUTO_REQUEST_PARSE:
        req_url = build_url(f"/request/{match_id}")
        try:
            _ = http_json(req_url, method="POST", body=b"")
            time.sleep(3)
            match = http_json(match_url)
            players = match.get("players") or []
            if hero_id is not None:
                players = [p for p in players if p.get("hero_id") == hero_id]
        except Exception:
            pass

    # Агрегация одинаковых точек, как в stratz_monthly_wards_pro.json
    counts: Dict[Tuple[str, float, float], int] = {}
    for p in players:
        for ward_type, mx, my in iter_player_ward_events(p):
            key = (ward_type, mx, my)
            counts[key] = counts.get(key, 0) + 1

    ward_rows = []
    for (ward_type, mx, my), count in sorted(
        counts.items(),
        key=lambda kv: (-kv[1], kv[0][0], kv[0][1], kv[0][2]),
    ):
        render_x, render_y = minimap_to_render_xy(mx, my)
        world_x, world_y = render_to_world_xy(render_x, render_y)
        ward_rows.append(
            {
                "teams": ["Radiant", "Dire"],
                "type": ward_type,
                # 3D world coordinates (Z is fixed default in this script).
                "x": float(round(world_x, 3)),
                "y": float(round(world_y, 3)),
                "z": float(DEFAULT_Z),
                # Keep 2D render coordinates for debugging/visual matching.
                "renderX": float(round(render_x, 3)),
                "renderY": float(round(render_y, 3)),
                "minimapX": float(mx),
                "minimapY": float(my),
                "count": int(count),
            }
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(ward_rows, f, ensure_ascii=False, indent=2)

    print(
        json.dumps(
            {
                "ok": True,
                "match_id": match_id,
                "hero_id": hero_id,
                "render_size": MINIMAP_RENDER_SIZE,
                "grid_size": MINIMAP_GRID_SIZE,
                "bounds_min": [WORLD_BOUNDS_MIN[0], WORLD_BOUNDS_MIN[1]],
                "bounds_max": [WORLD_BOUNDS_MAX[0], WORLD_BOUNDS_MAX[1]],
                "clamp_render_to_map": CLAMP_RENDER_TO_MAP,
                "wards": len(ward_rows),
                "out": str(out_path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
