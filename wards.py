import argparse
import asyncio
import json
import os
import socket
import tempfile
from collections import Counter
from pathlib import Path
from typing import Iterable

import aiohttp
from aiohttp.abc import AbstractResolver
from aiohttp.resolver import DefaultResolver

API_HOST = "api.opendota.com"
API = f"https://{API_HOST}/api"
API_FALLBACK_IPS = ("104.21.79.251", "172.67.172.79")
MINIMAP_RENDER_SIZE = 512.0
MINIMAP_GRID_SIZE = 127.0
MINIMAP_GRID_OFFSET = 64.0
WORLD_UNITS_PER_CELL = 64.0
BUCKET_0_12 = "0-12"
BUCKET_12_32 = "12-32"
BUCKET_32_PLUS = "32+"
TIME_BUCKETS = (BUCKET_0_12, BUCKET_12_32, BUCKET_32_PLUS)
DEFAULT_OUTPUT_PATH = (
    Path(__file__).resolve().parent
    / "scripts_files"
    / "data"
    / "ward_sources"
    / "wards.json"
)


def bin_xy(x: float, y: float, step: float = 16.0):
    return (round(float(x) / step) * step, round(float(y) / step) * step)


def minimap_to_render_xy(minimap_x: float, minimap_y: float) -> tuple[float, float]:
    # Mirrors frontend mapping:
    # left = (size / 127) * (x - 64)
    # top = (size / 127) * (127 - (y - 64)) == (size / 127) * (191 - y)
    scale = MINIMAP_RENDER_SIZE / MINIMAP_GRID_SIZE
    render_x = (float(minimap_x) - MINIMAP_GRID_OFFSET) * scale
    render_y = (
        MINIMAP_GRID_SIZE - (float(minimap_y) - MINIMAP_GRID_OFFSET)
    ) * scale
    return render_x, render_y


def build_ward_point(
    team: str,
    ward_type: str,
    minimap_x: float,
    minimap_y: float,
    z_value: float,
    description: str | None = None,
    time_bucket: str | None = None
):
    render_x, render_y = minimap_to_render_xy(minimap_x, minimap_y)
    world_z = float(z_value)
    out = {
        "teams": [team],
        "type": ward_type,
        # Minimap render coordinates in pixels for MINIMAP_RENDER_SIZE x MINIMAP_RENDER_SIZE.
        "x": render_x,
        "y": render_y,
        "z": world_z,
        # Raw minimap grid coordinates from source logs.
        "minimapX": float(minimap_x),
        "minimapY": float(minimap_y)
    }
    if description:
        out["description"] = description
    if time_bucket:
        out["timeBucket"] = time_bucket
    return out


def get_time_bucket(
    event_time: int | float,
    first_split_sec: int,
    second_split_sec: int
) -> str | None:
    if event_time < 0:
        return None
    if event_time < first_split_sec:
        return BUCKET_0_12
    if event_time < second_split_sec:
        return BUCKET_12_32
    return BUCKET_32_PLUS


class StaticFallbackResolver(AbstractResolver):
    def __init__(self):
        self.default = DefaultResolver()

    async def resolve(self, host, port=0, family=socket.AF_INET):
        if host == API_HOST:
            try:
                resolved = await self.default.resolve(host, port, family)
                if resolved:
                    return resolved
            except Exception:
                pass
            return [
                {
                    "hostname": host,
                    "host": ip,
                    "port": port,
                    "family": family,
                    "proto": 0,
                    "flags": socket.AI_NUMERICHOST
                }
                for ip in API_FALLBACK_IPS
            ]
        return await self.default.resolve(host, port, family)

    async def close(self):
        await self.default.close()


async def fetch_json(session: aiohttp.ClientSession, url: str, sem: asyncio.Semaphore, retries: int = 3):
    for attempt in range(retries):
        async with sem:
            try:
                async with session.get(
                    url,
                    timeout=aiohttp.ClientTimeout(total=25)
                ) as r:
                    if r.status == 429:
                        retry_after = int(r.headers.get("Retry-After", "2"))
                        await asyncio.sleep(retry_after)
                        continue
                    if r.status != 200:
                        continue
                    return await r.json()
            except (aiohttp.ClientError, asyncio.TimeoutError):
                if attempt == retries - 1:
                    break
                await asyncio.sleep(0.7 * (attempt + 1))
    return None

async def get_match_ids(session: aiohttp.ClientSession, n: int, sem: asyncio.Semaphore):
    data = await fetch_json(session, f"{API}/proMatches", sem)
    if not data:
        return []
    return [m["match_id"] for m in data[:n]]


def team_from_player_slot(player_slot: int) -> str:
    return "Radiant" if player_slot < 128 else "Dire"


async def process_match(
    mid: int,
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    step: float,
    first_split_sec: int,
    second_split_sec: int
):
    data = await fetch_json(session, f"{API}/matches/{mid}", sem)
    if not data:
        return None

    obs_counts = {
        "Radiant": {bucket: Counter() for bucket in TIME_BUCKETS},
        "Dire": {bucket: Counter() for bucket in TIME_BUCKETS}
    }
    sen_counts = {
        "Radiant": {bucket: Counter() for bucket in TIME_BUCKETS},
        "Dire": {bucket: Counter() for bucket in TIME_BUCKETS}
    }
    obs_counts_all = {
        "Radiant": Counter(),
        "Dire": Counter()
    }
    sen_counts_all = {
        "Radiant": Counter(),
        "Dire": Counter()
    }

    for p in data.get("players", []):
        slot = int(p.get("player_slot", 0))
        team = team_from_player_slot(slot)

        for e in (p.get("obs_log") or []):
            x, y = e.get("x"), e.get("y")
            if x is None or y is None:
                continue
            key = bin_xy(x, y, step)
            obs_counts_all[team][key] += 1
            t = e.get("time")
            if t is None:
                continue
            bucket = get_time_bucket(float(t), first_split_sec, second_split_sec)
            if bucket is None:
                continue
            obs_counts[team][bucket][key] += 1
        for e in (p.get("sen_log") or []):
            x, y = e.get("x"), e.get("y")
            if x is None or y is None:
                continue
            key = bin_xy(x, y, step)
            sen_counts_all[team][key] += 1
            t = e.get("time")
            if t is None:
                continue
            bucket = get_time_bucket(float(t), first_split_sec, second_split_sec)
            if bucket is None:
                continue
            sen_counts[team][bucket][key] += 1

    return obs_counts, sen_counts, obs_counts_all, sen_counts_all


def squared_distance_world_2d(a: tuple[float, float], b: tuple[float, float]) -> float:
    dx = (a[0] - b[0]) * WORLD_UNITS_PER_CELL
    dy = (a[1] - b[1]) * WORLD_UNITS_PER_CELL
    return dx * dx + dy * dy


def select_popular_non_overlapping(
    counts: Counter[tuple[float, float]],
    top_n: int,
    min_distance_world: float,
    min_count: int = 1
) -> list[tuple[tuple[float, float], int]]:
    min_count = max(1, int(min_count))
    limit = top_n if top_n > 0 else None

    ranked_points = [
        (point, count)
        for point, count in counts.most_common()
        if count >= min_count
    ]
    if min_distance_world <= 0:
        return ranked_points if limit is None else ranked_points[:limit]

    min_distance_sq = min_distance_world * min_distance_world
    selected: list[tuple[tuple[float, float], int]] = []

    for point, count in ranked_points:
        if all(
            squared_distance_world_2d(point, kept_point) > min_distance_sq
            for kept_point, _ in selected
        ):
            selected.append((point, count))
            if limit is not None and len(selected) >= limit:
                break

    return selected


def dedup_across_buckets(
    bucket_points: dict[str, list[tuple[tuple[float, float], int]]],
    min_distance_world: float
) -> dict[str, list[tuple[tuple[float, float], int]]]:
    if min_distance_world <= 0:
        return bucket_points

    min_sq = min_distance_world * min_distance_world
    candidates: list[tuple[str, tuple[float, float], int]] = []
    for bucket, points in bucket_points.items():
        for point, count in points:
            candidates.append((bucket, point, count))

    candidates.sort(key=lambda item: item[2], reverse=True)

    kept: list[tuple[str, tuple[float, float], int]] = []
    for bucket, point, count in candidates:
        if all(
            squared_distance_world_2d(point, kept_point) > min_sq
            for _, kept_point, _ in kept
        ):
            kept.append((bucket, point, count))

    result = {bucket: [] for bucket in bucket_points.keys()}
    for bucket, point, count in kept:
        result[bucket].append((point, count))
    return result


def append_team_points(
    out: list[dict],
    team: str,
    ward_type: str,
    ranked_points: Iterable[tuple[tuple[float, float], int]],
    z_value: float,
    description: str | None = None,
    time_bucket: str | None = None
) -> None:
    for (x, y), _ in ranked_points:
        out.append(
            build_ward_point(
                team,
                ward_type,
                x,
                y,
                z_value,
                description=description,
                time_bucket=time_bucket
            )
        )


def print_team_distances(
    team: str,
    ward_type: str,
    points: list[tuple[tuple[float, float], int]],
    bucket_label: str | None = None
) -> None:
    label = f"[{team}][{ward_type}]"
    if bucket_label is not None:
        label += f"[{bucket_label}]"
    print(f"{label} x y dist next")
    for idx, ((x, y), _) in enumerate(points):
        next_dist = "-"
        if idx + 1 < len(points):
            nx, ny = points[idx + 1][0]
            next_dist = f"{(squared_distance_world_2d((x, y), (nx, ny)) ** 0.5):.1f}"
        print(f"{x:.1f} {y:.1f} {next_dist} next")


async def build_top_obs_json(
    n_matches: int = 500,
    top_n_per_team: int = 35,
    min_count: int = 2,
    step: float = 8.0,
    concurrency: int = 15,
    z_obs: float = 256.0,
    min_distance_world: float = 185.0,
    print_distances: bool = False,
    first_split_sec: int = 12 * 60,
    second_split_sec: int = 32 * 60,
    time_bucket_mode: str = "all"
):
    sem = asyncio.Semaphore(concurrency)

    connector = aiohttp.TCPConnector(resolver=StaticFallbackResolver())
    async with aiohttp.ClientSession(
        headers={"User-Agent": "ward-topper/1.0"},
        connector=connector
    ) as session:
        match_ids = await get_match_ids(session, n=n_matches, sem=sem)
        tasks = [
            process_match(mid, session, sem, step, first_split_sec, second_split_sec)
            for mid in match_ids
        ]
        results = await asyncio.gather(*tasks)

    rad_obs = {bucket: Counter() for bucket in TIME_BUCKETS}
    dire_obs = {bucket: Counter() for bucket in TIME_BUCKETS}
    rad_sen = {bucket: Counter() for bucket in TIME_BUCKETS}
    dire_sen = {bucket: Counter() for bucket in TIME_BUCKETS}
    rad_obs_all = Counter()
    dire_obs_all = Counter()
    rad_sen_all = Counter()
    dire_sen_all = Counter()

    for res in results:
        if not res:
            continue
        obs_cnt, sen_cnt, obs_all_cnt, sen_all_cnt = res
        for bucket in TIME_BUCKETS:
            rad_obs[bucket].update(obs_cnt["Radiant"][bucket])
            dire_obs[bucket].update(obs_cnt["Dire"][bucket])
            rad_sen[bucket].update(sen_cnt["Radiant"][bucket])
            dire_sen[bucket].update(sen_cnt["Dire"][bucket])
        rad_obs_all.update(obs_all_cnt["Radiant"])
        dire_obs_all.update(obs_all_cnt["Dire"])
        rad_sen_all.update(sen_all_cnt["Radiant"])
        dire_sen_all.update(sen_all_cnt["Dire"])

    out = []
    if time_bucket_mode in TIME_BUCKETS:
        selected_buckets = [time_bucket_mode]
    else:
        selected_buckets = list(TIME_BUCKETS)

    bucket_selected: dict[str, dict[str, dict[str, list[tuple[tuple[float, float], int]]]]] = {}
    for team in ("Radiant", "Dire"):
        bucket_selected[team] = {}
        for ward_type in ("Observer", "Sentry"):
            bucket_selected[team][ward_type] = {}

    for bucket in selected_buckets:
        bucket_selected["Radiant"]["Observer"][bucket] = select_popular_non_overlapping(
            rad_obs[bucket], top_n_per_team, min_distance_world, min_count=min_count
        )
        bucket_selected["Dire"]["Observer"][bucket] = select_popular_non_overlapping(
            dire_obs[bucket], top_n_per_team, min_distance_world, min_count=min_count
        )
        bucket_selected["Radiant"]["Sentry"][bucket] = select_popular_non_overlapping(
            rad_sen[bucket], top_n_per_team, min_distance_world, min_count=min_count
        )
        bucket_selected["Dire"]["Sentry"][bucket] = select_popular_non_overlapping(
            dire_sen[bucket], top_n_per_team, min_distance_world, min_count=min_count
        )

    for team in ("Radiant", "Dire"):
        for ward_type in ("Observer", "Sentry"):
            bucket_selected[team][ward_type] = dedup_across_buckets(
                bucket_selected[team][ward_type],
                min_distance_world
            )

    for bucket in selected_buckets:
        bucket_label = bucket
        description = f"{bucket_label} min, top by all matches"
        radiant_obs_points = bucket_selected["Radiant"]["Observer"][bucket]
        dire_obs_points = bucket_selected["Dire"]["Observer"][bucket]
        radiant_sen_points = bucket_selected["Radiant"]["Sentry"][bucket]
        dire_sen_points = bucket_selected["Dire"]["Sentry"][bucket]
        if print_distances:
            print_team_distances("Radiant", "Observer", radiant_obs_points, bucket_label)
            print_team_distances("Dire", "Observer", dire_obs_points, bucket_label)
            print_team_distances("Radiant", "Sentry", radiant_sen_points, bucket_label)
            print_team_distances("Dire", "Sentry", dire_sen_points, bucket_label)
        append_team_points(
            out,
            "Radiant",
            "Observer",
            radiant_obs_points,
            z_obs,
            description=description,
            time_bucket=bucket_label
        )
        append_team_points(
            out,
            "Dire",
            "Observer",
            dire_obs_points,
            z_obs,
            description=description,
            time_bucket=bucket_label
        )
        append_team_points(
            out,
            "Radiant",
            "Sentry",
            radiant_sen_points,
            z_obs,
            description=description,
            time_bucket=bucket_label
        )
        append_team_points(
            out,
            "Dire",
            "Sentry",
            dire_sen_points,
            z_obs,
            description=description,
            time_bucket=bucket_label
        )

    if len(out) == 0:
        fallback_description = "all-time, top by all matches (fallback when timed buckets are empty)"
        fallback_rad_obs = select_popular_non_overlapping(
            rad_obs_all, top_n_per_team, min_distance_world, min_count=min_count
        )
        fallback_dire_obs = select_popular_non_overlapping(
            dire_obs_all, top_n_per_team, min_distance_world, min_count=min_count
        )
        fallback_rad_sen = select_popular_non_overlapping(
            rad_sen_all, top_n_per_team, min_distance_world, min_count=min_count
        )
        fallback_dire_sen = select_popular_non_overlapping(
            dire_sen_all, top_n_per_team, min_distance_world, min_count=min_count
        )
        if print_distances:
            print("[fallback] timed buckets are empty; using all-time ward logs.")
            print_team_distances("Radiant", "Observer", fallback_rad_obs, "all")
            print_team_distances("Dire", "Observer", fallback_dire_obs, "all")
            print_team_distances("Radiant", "Sentry", fallback_rad_sen, "all")
            print_team_distances("Dire", "Sentry", fallback_dire_sen, "all")
        append_team_points(
            out,
            "Radiant",
            "Observer",
            fallback_rad_obs,
            z_obs,
            description=fallback_description,
            time_bucket="all"
        )
        append_team_points(
            out,
            "Dire",
            "Observer",
            fallback_dire_obs,
            z_obs,
            description=fallback_description,
            time_bucket="all"
        )
        append_team_points(
            out,
            "Radiant",
            "Sentry",
            fallback_rad_sen,
            z_obs,
            description=fallback_description,
            time_bucket="all"
        )
        append_team_points(
            out,
            "Dire",
            "Sentry",
            fallback_dire_sen,
            z_obs,
            description=fallback_description,
            time_bucket="all"
        )

    return out


def write_text_atomic(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix=f"{path.name}.",
        suffix=".tmp",
        dir=path.parent
    )
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        os.replace(temp_path, path)
    except Exception:
        if temp_path.exists():
            temp_path.unlink()
        raise


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch top observer/sentry ward positions from OpenDota."
    )
    parser.add_argument(
        "-o",
        "--output",
        default=str(DEFAULT_OUTPUT_PATH),
        help="Output file path. Use '-' to print JSON to stdout."
    )
    parser.add_argument("--matches", type=int, default=350, help="Number of pro matches to process.")
    parser.add_argument(
        "--top-per-team",
        type=int,
        default=40,
        help="Top wards to keep for each team and each ward type. Use 0 for no hard limit."
    )
    parser.add_argument(
        "--min-count",
        type=int,
        default=2,
        help="Keep only points that were placed at least this many times."
    )
    parser.add_argument("--step", type=float, default=1.0, help="Binning step for ward coordinates.")
    parser.add_argument(
        "--min-distance",
        type=float,
        default=185.0,
        help=(
            "Minimum distance between selected ward points in world units. "
            "If points are closer, only the more popular one is kept."
        )
    )
    parser.add_argument(
        "--print-distances",
        action="store_true",
        help="Print selected minimap points as: x y dist next (for both teams)."
    )
    parser.add_argument(
        "--first-split-sec",
        type=int,
        default=12 * 60,
        help="First split in seconds (default: 720 for 0-12)."
    )
    parser.add_argument(
        "--second-split-sec",
        type=int,
        default=32 * 60,
        help="Second split in seconds (default: 1920 for 12-32 and 32+)."
    )
    parser.add_argument(
        "--time-bucket",
        choices=("all", BUCKET_0_12, BUCKET_12_32, BUCKET_32_PLUS),
        default="all",
        help="Which time bucket to export: all, 0-12, 12-32, or 32+."
    )
    parser.add_argument("--concurrency", type=int, default=20, help="Concurrent requests limit.")
    parser.add_argument("--z", type=float, default=256.0, help="Z value for generated ward points.")
    parser.add_argument(
        "--attempts",
        type=int,
        default=5,
        help="Full generation attempts before giving up on empty results."
    )
    parser.add_argument(
        "--allow-empty",
        action="store_true",
        help="Allow writing an empty array when no wards were generated."
    )
    return parser.parse_args()


async def main():
    args = parse_args()
    first_split_sec = max(1, args.first_split_sec)
    second_split_sec = max(1, args.second_split_sec)
    if second_split_sec <= first_split_sec:
        raise ValueError(
            f"--second-split-sec ({second_split_sec}) must be greater than "
            f"--first-split-sec ({first_split_sec})."
        )
    data = []
    attempts = max(1, args.attempts)
    for attempt in range(1, attempts + 1):
        data = await build_top_obs_json(
            n_matches=args.matches,
            top_n_per_team=args.top_per_team,
            min_count=max(1, args.min_count),
            step=args.step,
            concurrency=args.concurrency,
            z_obs=args.z,
            min_distance_world=max(0.0, args.min_distance),
            print_distances=(args.print_distances and attempt == attempts),
            first_split_sec=first_split_sec,
            second_split_sec=second_split_sec,
            time_bucket_mode=args.time_bucket
        )
        if data or args.allow_empty or args.top_per_team <= 0:
            break
        if attempt < attempts:
            await asyncio.sleep(min(2 * attempt, 8))

    payload = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if args.output == "-":
        print(payload, end="")
        return

    if len(data) == 0 and args.top_per_team > 0 and not args.allow_empty:
        output_path = Path(args.output).expanduser().resolve()
        if output_path.exists():
            print(
                f"No wards were generated in {attempts} attempts. "
                f"Keeping existing file unchanged: {output_path}"
            )
            return
        raise RuntimeError(
            f"No wards were generated in {attempts} attempts and output file does not exist. "
            "Use --allow-empty to write an empty array."
        )

    output_path = Path(args.output).expanduser().resolve()
    write_text_atomic(output_path, payload)
    print(f"Wrote {len(data)} wards to {output_path}")


if __name__ == "__main__":
    asyncio.run(main())
