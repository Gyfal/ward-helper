#!/usr/bin/env python3

from __future__ import annotations

import argparse
import bisect
import re
import json
import math
import os
import shutil
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable

import requests

API_BASE = "https://api.opendota.com/api"
DEFAULT_OUTPUT_PATH = (
    Path(__file__).resolve().parent
    / "scripts_files"
    / "data"
    / "ward_reco_dataset.runtime.json"
)
DEFAULT_CACHE_DIR = (
    Path(__file__).resolve().parent
    / "scripts_files"
    / "data"
    / "ward_reco_match_cache_files"
)
DEFAULT_DAILY_CACHE_DIR = (
    Path(__file__).resolve().parent
    / "scripts_files"
    / "data"
    / "ward_reco_match_cache_daily"
)
DEFAULT_CLUSTER_RADIUS_WORLD = 192.0
DEFAULT_MATCH_LIMIT = 1000
# Matches the production 5-day rolling window (workflow passes 5 explicitly).
DEFAULT_DAILY_BATCH_RETENTION_DAYS = 5
DEFAULT_MIN_PLACEMENTS = 2
DEFAULT_MIN_MATCHES = 2
DEFAULT_MAX_SPOTS_PER_GROUP = 80
DEFAULT_WORKERS = 8
DEFAULT_REQUEST_TIMEOUT = 35.0
DEFAULT_REQUEST_DELAY_SEC = 5.0
DEFAULT_RETRIES = 12
DEFAULT_RETRY_BASE_DELAY_SEC = 5.0
DEFAULT_RETRY_MAX_DELAY_SEC = 60.0
DEFAULT_QUICK_DEWARD_SEC = 180
DEFAULT_SUCCESS_LIFETIME_SEC = 300
DEFAULT_RECENT_MATCH_BATCH_SIZE = 1000
WORLD_CELL_SIZE = 128.0
WORLD_ORIGIN_OFFSET = 16384.0
MAX_WARD_LIFETIME_BY_TYPE = {
    "Observer": 420.0,
    "Sentry": 480.0
}
# Counter-sentry: boost a sentry spot's score by proximity to popular enemy
# observer spots in the same bucket. Precomputed here so the runtime just reads
# the final score (mirrors the old VisibleWardSelector exp falloff in cells).
COUNTER_SENTRY_DISTANCE_FALLOFF = 6.0


@dataclass(frozen=True)
class TimeBucket:
    id: str
    min_sec: int
    max_sec: int | None


TIME_BUCKETS: tuple[TimeBucket, ...] = (
    TimeBucket("0_12", 0, 12 * 60),
    TimeBucket("12_25", 12 * 60, 25 * 60),
    TimeBucket("25_50", 25 * 60, 50 * 60),
    TimeBucket("50_plus", 50 * 60, None)
)
VALID_TIME_BUCKET_IDS: frozenset[str] = frozenset(bucket.id for bucket in TIME_BUCKETS)
PlacementRecord = tuple[str, str, str, "PlacementSample"]
FETCH_PROGRESS_EVERY = 25
REQUEST_THROTTLER: "RequestThrottler | None" = None


@dataclass
class PlacementSample:
    match_id: int
    event_time_sec: float
    time_bucket: str
    minimap_x: float
    minimap_y: float
    world_x: float
    world_y: float
    lifetime_sec: float | None


class RequestThrottler:
    def __init__(self, delay_sec: float) -> None:
        self.delay_sec = max(0.0, float(delay_sec))
        self._lock = threading.Lock()
        self._next_allowed_at = 0.0

    def run(self, action: "Callable[[], requests.Response]") -> requests.Response:
        with self._lock:
            if self.delay_sec > 0:
                now = time.monotonic()
                if now < self._next_allowed_at:
                    time.sleep(self._next_allowed_at - now)
            try:
                return action()
            finally:
                self._next_allowed_at = time.monotonic() + self.delay_sec


@dataclass
class SpotAccumulator:
    ward_type: str
    team: str
    time_bucket: str
    samples: list[PlacementSample] = field(default_factory=list)
    match_ids: set[int] = field(default_factory=set)
    sum_world_x: float = 0.0
    sum_world_y: float = 0.0
    sum_minimap_x: float = 0.0
    sum_minimap_y: float = 0.0
    lifetime_samples: list[float] = field(default_factory=list)
    quick_deward_count: int = 0
    success_count: int = 0

    def add(
        self,
        sample: PlacementSample,
        quick_deward_sec: int,
        success_lifetime_sec: int
    ) -> None:
        self.samples.append(sample)
        self.match_ids.add(sample.match_id)
        self.sum_world_x += sample.world_x
        self.sum_world_y += sample.world_y
        self.sum_minimap_x += sample.minimap_x
        self.sum_minimap_y += sample.minimap_y
        if sample.lifetime_sec is not None:
            self.lifetime_samples.append(sample.lifetime_sec)
            if sample.lifetime_sec <= quick_deward_sec:
                self.quick_deward_count += 1
            if sample.lifetime_sec >= success_lifetime_sec:
                self.success_count += 1

    @property
    def placements(self) -> int:
        return len(self.samples)

    @property
    def matches_seen(self) -> int:
        return len(self.match_ids)

    @property
    def centroid(self) -> tuple[float, float]:
        if self.placements == 0:
            return 0.0, 0.0
        return self.sum_world_x / self.placements, self.sum_world_y / self.placements


class SpatialGroupIndex:
    def __init__(
        self,
        ward_type: str,
        team: str,
        time_bucket: str,
        cluster_radius_world: float,
        quick_deward_sec: int,
        success_lifetime_sec: int
    ) -> None:
        self.ward_type = ward_type
        self.team = team
        self.time_bucket = time_bucket
        self.cluster_radius_world = max(1.0, cluster_radius_world)
        self.cluster_radius_sq = self.cluster_radius_world * self.cluster_radius_world
        self.quick_deward_sec = quick_deward_sec
        self.success_lifetime_sec = success_lifetime_sec
        self.spots: list[SpotAccumulator] = []
        self.bin_to_indices: dict[tuple[int, int], list[int]] = defaultdict(list)

    def add(self, sample: PlacementSample) -> None:
        nearest_index = self._find_nearest_index(sample.world_x, sample.world_y)
        if nearest_index is None:
            spot = SpotAccumulator(
                ward_type=self.ward_type,
                team=self.team,
                time_bucket=self.time_bucket
            )
            spot.add(sample, self.quick_deward_sec, self.success_lifetime_sec)
            self.spots.append(spot)
            self.bin_to_indices[self._bin_key(sample.world_x, sample.world_y)].append(
                len(self.spots) - 1
            )
            return

        spot = self.spots[nearest_index]
        old_bin = self._bin_key(*spot.centroid)
        spot.add(sample, self.quick_deward_sec, self.success_lifetime_sec)
        new_bin = self._bin_key(*spot.centroid)
        if new_bin != old_bin:
            self.bin_to_indices[new_bin].append(nearest_index)

    def _find_nearest_index(self, world_x: float, world_y: float) -> int | None:
        base_bin = self._bin_key(world_x, world_y)
        candidate_indices: set[int] = set()
        for offset_x in (-1, 0, 1):
            for offset_y in (-1, 0, 1):
                candidate_indices.update(
                    self.bin_to_indices.get(
                        (base_bin[0] + offset_x, base_bin[1] + offset_y),
                        ()
                    )
                )

        nearest_index: int | None = None
        nearest_distance_sq = self.cluster_radius_sq
        for index in candidate_indices:
            centroid_x, centroid_y = self.spots[index].centroid
            dx = centroid_x - world_x
            dy = centroid_y - world_y
            distance_sq = dx * dx + dy * dy
            if distance_sq <= nearest_distance_sq:
                nearest_index = index
                nearest_distance_sq = distance_sq
        return nearest_index

    def _bin_key(self, world_x: float, world_y: float) -> tuple[int, int]:
        return (
            int(math.floor(world_x / self.cluster_radius_world)),
            int(math.floor(world_y / self.cluster_radius_world))
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build ward_reco_dataset.runtime.json from OpenDota match API."
    )
    parser.add_argument(
        "-o",
        "--output",
        default=str(DEFAULT_OUTPUT_PATH),
        help="Output path for ward_reco_dataset.runtime.json."
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=DEFAULT_CACHE_DIR,
        help=(
            "Directory with one JSON file per cached match. "
            "This is the preferred cache storage."
        )
    )
    parser.add_argument(
        "--daily-cache-dir",
        type=Path,
        default=DEFAULT_DAILY_CACHE_DIR,
        help=(
            "Directory with one daily JSON file per build, named YYYY-MM-DD.json."
        )
    )
    parser.add_argument(
        "--daily-cache-date",
        type=str,
        default="",
        help=(
            "Date for daily cache filename in YYYY-MM-DD format. "
            "Defaults to current UTC date."
        )
    )
    parser.add_argument(
        "--daily-batch-retention",
        type=int,
        default=DEFAULT_DAILY_BATCH_RETENTION_DAYS,
        help=(
            "How many daily cache files to keep. Runtime can be built from a rolling window."
        )
    )
    parser.add_argument(
        "--build-from-daily-batches",
        action="store_true",
        help="Build runtime from last N daily cache files and skip OpenDota fetching."
    )
    parser.add_argument(
        "--daily-batches-for-runtime",
        type=int,
        default=None,
        help="Override number of latest daily files used when building runtime."
    )
    parser.add_argument(
        "--emit-daily-batch",
        action="store_true",
        help=(
            "Write fetched matches of this run to a dated JSON file in --daily-cache-dir."
        )
    )
    parser.add_argument(
        "--skip-match-cache",
        action="store_true",
        help=(
            "Do not read/write --cache-dir match files. Useful when source of truth "
            "is daily cache files."
        )
    )
    parser.add_argument(
        "--skip-runtime-build",
        action="store_true",
        help="Skip runtime dataset generation step and exit after daily batch emission."
    )
    parser.add_argument(
        "--dedup-from-daily-cache",
        action="store_true",
        help=(
            "Use daily cache files for match deduplication when collecting fresh matches."
        )
    )
    parser.add_argument(
        "--daily-dedup-retention",
        type=int,
        default=DEFAULT_DAILY_BATCH_RETENTION_DAYS,
        help="How many latest daily files to inspect for deduplication."
    )
    parser.add_argument(
        "--reset-cache",
        action="store_true",
        help="Ignore existing cache content and rebuild the local match base from scratch."
    )
    parser.add_argument(
        "--matches",
        type=int,
        default=DEFAULT_MATCH_LIMIT,
        help="How many uncached recent matches to add to the local cache."
    )
    parser.add_argument(
        "--match-ids-file",
        type=Path,
        default=None,
        help="Optional JSON file with match_id rows, same shape as dnw_reply_test.py output."
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help="Parallel match fetch workers."
    )
    parser.add_argument(
        "--cluster-radius-world",
        type=float,
        default=DEFAULT_CLUSTER_RADIUS_WORLD,
        help="World-space radius for grouping nearby placements into a single spot."
    )
    parser.add_argument(
        "--min-placements",
        type=int,
        default=DEFAULT_MIN_PLACEMENTS,
        help="Minimum placements required to keep a spot."
    )
    parser.add_argument(
        "--min-matches",
        type=int,
        default=DEFAULT_MIN_MATCHES,
        help="Minimum distinct matches required to keep a spot."
    )
    parser.add_argument(
        "--max-spots-per-group",
        type=int,
        default=DEFAULT_MAX_SPOTS_PER_GROUP,
        help="Maximum spots per (team, type, time_bucket). Use 0 for no limit."
    )
    parser.add_argument(
        "--quick-deward-sec",
        type=int,
        default=DEFAULT_QUICK_DEWARD_SEC,
        help="Observer ward lifetime threshold considered a quick deward."
    )
    parser.add_argument(
        "--success-lifetime-sec",
        type=int,
        default=DEFAULT_SUCCESS_LIFETIME_SEC,
        help="Ward lifetime threshold treated as a successful placement."
    )
    parser.add_argument(
        "--observer-max-quick-deward-rate",
        type=float,
        default=0.35,
        help="Observers above this quick-deward rate are marked risky."
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_REQUEST_TIMEOUT,
        help="HTTP timeout in seconds."
    )
    parser.add_argument(
        "--request-delay-sec",
        type=float,
        default=DEFAULT_REQUEST_DELAY_SEC,
        help="Minimum delay between outgoing OpenDota requests across all workers."
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=DEFAULT_RETRIES,
        help="HTTP retries for explorer and match endpoints."
    )
    return parser.parse_args()


def round_metric(value: float, digits: int = 4) -> float:
    return round(float(value), digits)


def log(message: str) -> None:
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print(f"[ward-build] {timestamp} | {message}", file=sys.stderr, flush=True)


def build_api_params(extra: dict[str, Any] | None = None) -> dict[str, Any]:
    params: dict[str, Any] = {}
    api_key = os.getenv("OPENDOTA_API_KEY")
    if api_key:
        params["api_key"] = api_key
    if extra:
        params.update(extra)
    return params


def _retry_delay(attempt_number: int, retry_after: str | None = None) -> float:
    # Retry-After may also be an HTTP date; fall back to backoff instead of crashing.
    if retry_after:
        try:
            return max(1.0, float(retry_after))
        except ValueError:
            pass
    return min(
        DEFAULT_RETRY_BASE_DELAY_SEC * attempt_number,
        DEFAULT_RETRY_MAX_DELAY_SEC
    )


def request_json(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    timeout: float,
    retries: int
) -> Any:
    headers = {
        "Accept": "application/json",
        "User-Agent": "ward-helper-runtime-builder/2.0"
    }
    current_params = build_api_params(params)
    total_attempts = max(1, int(retries))
    for attempt in range(total_attempts):
        attempt_number = attempt + 1
        try:
            if REQUEST_THROTTLER is not None:
                response = REQUEST_THROTTLER.run(
                    lambda: requests.get(
                        url,
                        params=current_params or None,
                        headers=headers,
                        timeout=timeout
                    )
                )
            else:
                response = requests.get(
                    url,
                    params=current_params or None,
                    headers=headers,
                    timeout=timeout
                )
        except requests.RequestException as exc:
            if attempt_number >= total_attempts:
                raise
            delay = _retry_delay(attempt_number)
            log(
                f"request failed ({attempt_number}/{total_attempts}) for {url}: "
                f"{type(exc).__name__}: {exc}; retry in {delay:.1f}s"
            )
            time.sleep(delay)
            continue

        if response.status_code == 429 or response.status_code >= 500:
            if attempt_number >= total_attempts:
                response.raise_for_status()
            delay = _retry_delay(attempt_number, response.headers.get("Retry-After"))
            log(
                f"http {response.status_code} ({attempt_number}/{total_attempts}) "
                f"for {url}; retry in {delay:.1f}s"
            )
            time.sleep(delay)
            continue

        response.raise_for_status()
        return response.json()

    raise RuntimeError(f"Unable to fetch JSON after {total_attempts} attempts: {url}")


def load_match_ids_from_file(path: Path, limit: int) -> list[int]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    out: list[int] = []
    if isinstance(payload, list):
        for row in payload:
            if isinstance(row, dict) and "match_id" in row:
                value = row.get("match_id")
            else:
                value = row
            try:
                match_id = int(value)
            except (TypeError, ValueError):
                continue
            out.append(match_id)
            if limit > 0 and len(out) >= limit:
                break
    return out


def fetch_recent_match_ids(
    limit: int,
    offset: int,
    timeout: float,
    retries: int
) -> list[int]:
    safe_limit = max(1, int(limit))
    safe_offset = max(0, int(offset))
    # Only parsed matches carry obs_log/sen_log; version IS NOT NULL filters out
    # unparsed matches so we don't spend the API budget on payloads with no wards.
    sql = (
        "SELECT match_id FROM matches "
        "WHERE version IS NOT NULL "
        f"ORDER BY match_id DESC LIMIT {safe_limit} OFFSET {safe_offset}"
    )
    payload = request_json(
        f"{API_BASE}/explorer",
        params={"sql": sql},
        timeout=timeout,
        retries=retries
    )
    rows = payload.get("rows") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    out: list[int] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            out.append(int(row["match_id"]))
        except (KeyError, TypeError, ValueError):
            continue
    return out


def collect_recent_uncached_match_ids(
    target_count: int,
    cached_match_ids: set[int],
    timeout: float,
    retries: int
) -> tuple[list[int], int]:
    target = max(1, int(target_count))
    batch_size = max(1, min(DEFAULT_RECENT_MATCH_BATCH_SIZE, target))
    fresh_match_ids: list[int] = []
    seen_match_ids: set[int] = set()
    scanned_candidates = 0
    offset = 0

    while len(fresh_match_ids) < target:
        batch = fetch_recent_match_ids(batch_size, offset, timeout, retries)
        if not batch:
            break
        scanned_candidates += len(batch)
        offset += len(batch)
        for match_id in batch:
            if match_id in seen_match_ids:
                continue
            seen_match_ids.add(match_id)
            if match_id in cached_match_ids:
                continue
            fresh_match_ids.append(match_id)
            if len(fresh_match_ids) >= target:
                break
        if len(batch) < batch_size:
            break

    return fresh_match_ids, scanned_candidates


def fetch_match_payload(
    match_id: int,
    timeout: float,
    retries: int
) -> tuple[int, dict[str, Any] | None]:
    try:
        payload = request_json(
            f"{API_BASE}/matches/{match_id}",
            timeout=timeout,
            retries=retries
        )
    except requests.RequestException:
        return match_id, None
    except RuntimeError:
        return match_id, None
    if not isinstance(payload, dict):
        return match_id, None
    return match_id, payload


def team_from_player_slot(player_slot: Any) -> str:
    try:
        value = int(player_slot)
    except (TypeError, ValueError):
        return "radiant"
    return "radiant" if value < 128 else "dire"


def minimap_to_world_xy(minimap_x: float, minimap_y: float) -> tuple[float, float]:
    return (
        float(minimap_x) * WORLD_CELL_SIZE - WORLD_ORIGIN_OFFSET,
        float(minimap_y) * WORLD_CELL_SIZE - WORLD_ORIGIN_OFFSET
    )


def classify_time_bucket(event_time: float) -> str | None:
    if event_time < 0:
        return None
    for bucket in TIME_BUCKETS:
        if event_time < bucket.min_sec:
            continue
        if bucket.max_sec is None or event_time < bucket.max_sec:
            return bucket.id
    return None


def _bucket_midpoint_sec(bucket_id: str) -> float:
    """Representative time (sec) for a bucket id, used only to re-bucket legacy
    cache records that predate stored event_time_sec. Parses ids like
    "0_12", "25_50" or "50_plus" (start_end minutes)."""
    parts = bucket_id.split("_")
    try:
        start_min = int(parts[0])
    except (IndexError, ValueError):
        return 0.0
    tail = parts[1] if len(parts) > 1 else ""
    if tail == "plus" or tail == "":
        return (start_min + 5) * 60.0
    try:
        end_min = int(tail)
    except ValueError:
        return start_min * 60.0
    return (start_min + end_min) / 2.0 * 60.0


def build_left_time_lookup(
    player: dict[str, Any],
    log_name: str
) -> tuple[dict[int, list[float]], dict[tuple[int, int], list[float]]]:
    events = player.get(log_name)
    by_ehandle: dict[int, list[float]] = defaultdict(list)
    by_coords: dict[tuple[int, int], list[float]] = defaultdict(list)
    if not isinstance(events, list):
        return by_ehandle, by_coords

    for event in events:
        if not isinstance(event, dict):
            continue
        try:
            event_time = float(event.get("time"))
        except (TypeError, ValueError):
            continue
        x = event.get("x")
        y = event.get("y")
        if x is not None and y is not None:
            try:
                by_coords[(int(round(float(x))), int(round(float(y))))].append(event_time)
            except (TypeError, ValueError):
                pass
        try:
            ehandle = int(event.get("ehandle"))
        except (TypeError, ValueError):
            ehandle = None
        if ehandle is not None:
            by_ehandle[ehandle].append(event_time)

    for values in by_ehandle.values():
        values.sort()
    for values in by_coords.values():
        values.sort()
    return by_ehandle, by_coords


def consume_matching_left_time(
    event: dict[str, Any],
    place_time: float,
    ward_type: str,
    by_ehandle: dict[int, list[float]],
    by_coords: dict[tuple[int, int], list[float]]
) -> float | None:
    max_lifetime = MAX_WARD_LIFETIME_BY_TYPE.get(ward_type, 600.0)
    try:
        ehandle_key = int(event.get("ehandle"))
    except (TypeError, ValueError):
        ehandle_key = None
    if ehandle_key is not None:
        values = by_ehandle.get(ehandle_key)
        if values:
            index = bisect.bisect_left(values, place_time)
            if index < len(values):
                candidate = values[index]
                delta = candidate - place_time
                if 0 <= delta <= max_lifetime:
                    del values[index]
                    return delta

    try:
        coord_key = (
            int(round(float(event.get("x")))),
            int(round(float(event.get("y"))))
        )
    except (TypeError, ValueError):
        return None
    values = by_coords.get(coord_key)
    if not values:
        return None
    index = bisect.bisect_left(values, place_time)
    if index >= len(values):
        return None
    candidate = values[index]
    delta = candidate - place_time
    if 0 <= delta <= max_lifetime:
        del values[index]
        return delta
    return None


def compute_percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    rank = (len(ordered) - 1) * percentile
    lower = int(math.floor(rank))
    upper = int(math.ceil(rank))
    if lower == upper:
        return float(ordered[lower])
    weight = rank - lower
    return float(ordered[lower] * (1 - weight) + ordered[upper] * weight)


def compute_quality_score(
    *,
    placements: int,
    matches_seen: int,
    total_matches: int,
    quick_deward_rate: float,
    success_rate: float,
    spread_score: float
) -> float:
    coverage = matches_seen / max(1, total_matches)
    pick_rate = placements / max(1, matches_seen)
    normalized_pick_rate = min(1.0, pick_rate / 3.0)
    support_score = math.log1p(max(0, placements))
    safety_multiplier = 1.0 - min(0.85, quick_deward_rate * 0.85)
    success_multiplier = 0.6 + 0.4 * max(0.0, min(1.0, success_rate))
    coverage_multiplier = 0.25 + 0.75 * coverage
    spread_multiplier = 0.35 + 0.65 * max(0.0, min(1.0, spread_score))
    return (
        support_score
        * coverage_multiplier
        * (0.45 + 0.55 * normalized_pick_rate)
        * success_multiplier
        * spread_multiplier
        * safety_multiplier
    )


def build_spot_payload(
    spot: SpotAccumulator,
    *,
    total_matches: int,
    observer_max_quick_deward_rate: float
) -> dict[str, Any]:
    centroid_x, centroid_y = spot.centroid
    placements = spot.placements
    matches_seen = spot.matches_seen
    avg_minimap_x = spot.sum_minimap_x / max(1, placements)
    avg_minimap_y = spot.sum_minimap_y / max(1, placements)
    distances = [
        math.hypot(sample.world_x - centroid_x, sample.world_y - centroid_y)
        for sample in spot.samples
    ]
    radius_p50 = compute_percentile(distances, 0.5)
    radius_p90 = compute_percentile(distances, 0.9)

    lifetime_count = len(spot.lifetime_samples)
    quick_deward_rate = (
        spot.quick_deward_count / lifetime_count
        if spot.ward_type == "Observer" and lifetime_count > 0
        else 0.0
    )
    success_rate = (
        spot.success_count / lifetime_count
        if lifetime_count > 0
        else (1.0 if spot.ward_type == "Sentry" else 0.0)
    )
    spread_score = 1.0 / (1.0 + radius_p50 / 1800.0)
    score = compute_quality_score(
        placements=placements,
        matches_seen=matches_seen,
        total_matches=total_matches,
        quick_deward_rate=quick_deward_rate,
        success_rate=success_rate,
        spread_score=spread_score
    )

    spot_id = (
        f"{spot.ward_type}:{spot.team}:{spot.time_bucket}:"
        f"{int(round(centroid_x))}:{int(round(centroid_y))}"
    )
    return {
        "spot_id": spot_id,
        "type": spot.ward_type,
        "team": spot.team,
        "time_bucket": spot.time_bucket,
        "cell": {
            "x": int(round(avg_minimap_x)),
            "y": int(round(avg_minimap_y))
        },
        "world_avg": {
            "x": round_metric(centroid_x, 3),
            "y": round_metric(centroid_y, 3)
        },
        "stats": {
            "matches_seen": matches_seen,
            "placements": placements,
            "match_coverage": round_metric(matches_seen / max(1, total_matches)),
            "quick_deward_rate": round_metric(quick_deward_rate),
            "success_rate": round_metric(success_rate),
            "score": round_metric(score, 6),
            "radius_p50": round_metric(radius_p50, 3),
            "radius_p90": round_metric(radius_p90, 3)
        },
        "flags": {
            "observer_risky_quick_deward": bool(
                spot.ward_type == "Observer"
                and lifetime_count > 0
                and quick_deward_rate >= observer_max_quick_deward_rate
            )
        }
    }


def compute_counter_sentry_boost(
    sentry_payload: dict[str, Any],
    enemy_observer_payloads: list[dict[str, Any]]
) -> float:
    cell = sentry_payload.get("cell") or {}
    try:
        sentry_x = float(cell["x"])
        sentry_y = float(cell["y"])
    except (KeyError, TypeError, ValueError):
        return 0.0
    best = 0.0
    for observer in enemy_observer_payloads:
        observer_cell = observer.get("cell") or {}
        try:
            observer_x = float(observer_cell["x"])
            observer_y = float(observer_cell["y"])
            observer_score = float(observer["stats"]["score"])
        except (KeyError, TypeError, ValueError):
            continue
        distance = math.hypot(sentry_x - observer_x, sentry_y - observer_y)
        signal = observer_score * math.exp(-distance / COUNTER_SENTRY_DISTANCE_FALLOFF)
        if signal > best:
            best = signal
    return best


def apply_counter_sentry_scores(
    group_payloads: dict[tuple[str, str, str], list[dict[str, Any]]]
) -> None:
    observers_by_team_bucket: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for (ward_type, team, time_bucket), payloads in group_payloads.items():
        if ward_type == "Observer":
            observers_by_team_bucket[(team, time_bucket)].extend(payloads)

    for (ward_type, team, time_bucket), payloads in group_payloads.items():
        if ward_type != "Sentry":
            continue
        enemy_team = "dire" if team == "radiant" else "radiant"
        enemy_observers = observers_by_team_bucket.get((enemy_team, time_bucket))
        if not enemy_observers:
            continue
        for sentry_payload in payloads:
            boost = compute_counter_sentry_boost(sentry_payload, enemy_observers)
            if boost <= 0:
                continue
            stats = sentry_payload["stats"]
            stats["score"] = round_metric(float(stats["score"]) + boost, 6)


def serialize_placement_record(record: PlacementRecord) -> dict[str, Any]:
    ward_type, team, time_bucket, sample = record
    return {
        "ward_type": ward_type,
        "team": team,
        "time_bucket": time_bucket,
        "event_time_sec": round_metric(sample.event_time_sec, 2),
        "minimap_x": round_metric(sample.minimap_x, 4),
        "minimap_y": round_metric(sample.minimap_y, 4),
        "world_x": round_metric(sample.world_x, 4),
        "world_y": round_metric(sample.world_y, 4),
        "lifetime_sec": round_metric(sample.lifetime_sec, 4)
        if sample.lifetime_sec is not None
        else None
    }


def deserialize_placement_record(
    match_id: int,
    value: Any
) -> PlacementRecord | None:
    if not isinstance(value, dict):
        return None
    try:
        ward_type = str(value["ward_type"])
        team = str(value["team"])
        time_bucket = str(value["time_bucket"])
        minimap_x = float(value["minimap_x"])
        minimap_y = float(value["minimap_y"])
        world_x = float(value["world_x"])
        world_y = float(value["world_y"])
    except (KeyError, TypeError, ValueError):
        return None

    lifetime_raw = value.get("lifetime_sec")
    lifetime_sec: float | None
    if lifetime_raw is None:
        lifetime_sec = None
    else:
        try:
            lifetime_sec = float(lifetime_raw)
        except (TypeError, ValueError):
            lifetime_sec = None

    # event_time_sec is the source of truth for re-bucketing. Older cache files
    # (pre slim schema) lack it; fall back to the bucket midpoint so the record
    # still lands in a sane bucket when re-derived at runtime-build time.
    event_raw = value.get("event_time_sec")
    try:
        event_time_sec = float(event_raw)
    except (TypeError, ValueError):
        event_time_sec = _bucket_midpoint_sec(time_bucket)

    sample = PlacementSample(
        match_id=match_id,
        event_time_sec=event_time_sec,
        time_bucket=time_bucket,
        minimap_x=minimap_x,
        minimap_y=minimap_y,
        world_x=world_x,
        world_y=world_y,
        lifetime_sec=lifetime_sec
    )
    return ward_type, team, time_bucket, sample


def load_match_cache_entry(row: Any) -> tuple[int, list[PlacementRecord]] | None:
    if not isinstance(row, dict):
        return None
    try:
        match_id = int(row["match_id"])
    except (KeyError, TypeError, ValueError):
        return None
    samples_raw = row.get("samples")
    samples: list[PlacementRecord] = []
    if isinstance(samples_raw, list):
        for sample_raw in samples_raw:
            parsed = deserialize_placement_record(match_id, sample_raw)
            if parsed is not None:
                samples.append(parsed)
    return match_id, samples


def load_match_cache_dir(path: Path) -> dict[int, list[PlacementRecord]]:
    if not path.exists():
        return {}

    out: dict[int, list[PlacementRecord]] = {}
    for file_path in sorted(path.glob("*.json")):
        if file_path.name == "index.json":
            continue
        try:
            payload = json.loads(file_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        parsed = load_match_cache_entry(payload)
        if parsed is None:
            continue
        match_id, records = parsed
        out[match_id] = records
    return out


def _safe_parse_date(raw: str) -> date | None:
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def _iter_daily_cache_files(path: Path) -> list[tuple[date, Path]]:
    if not path.exists():
        return []
    out: list[tuple[date, Path]] = []
    for file_path in sorted(path.glob("*.json")):
        file_name = file_path.name
        match = re.fullmatch(r"(\d{4}-\d{2}-\d{2})\.json", file_name)
        if match is None:
            continue
        parsed = _safe_parse_date(match.group(1))
        if parsed is None:
            continue
        out.append((parsed, file_path))
    out.sort(key=lambda item: item[0], reverse=True)
    return out


def _write_daily_batch_file(
    cache_dir: Path,
    daily_date: str,
    batch_entries: dict[int, list[PlacementRecord]],
    source: str
) -> Path | None:
    if not batch_entries:
        return None
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{daily_date}.json"
    payload = {
        "schema_version": 1,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "matches": []
    }
    for match_id in sorted(batch_entries.keys(), reverse=True):
        payload["matches"].append(
            {
                "match_id": match_id,
                "samples": [
                    serialize_placement_record(record)
                    for record in batch_entries[match_id]
                ]
            }
        )
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8"
    )
    return path


def _enforce_daily_cache_retention(cache_dir: Path, retention: int) -> None:
    if retention <= 0:
        return
    files = _iter_daily_cache_files(cache_dir)
    if len(files) <= retention:
        return
    for _, file_path in files[retention:]:
        try:
            file_path.unlink(missing_ok=True)
        except OSError:
            pass


def _load_match_cache_batch(path: Path) -> dict[int, list[PlacementRecord]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    raw_matches: Any
    if isinstance(payload, dict) and isinstance(payload.get("matches"), list):
        raw_matches = payload.get("matches", [])
    elif isinstance(payload, list):
        raw_matches = payload
    else:
        return {}
    out: dict[int, list[PlacementRecord]] = {}
    if isinstance(raw_matches, list):
        for entry in raw_matches:
            parsed = load_match_cache_entry(entry)
            if parsed is None:
                continue
            match_id, records = parsed
            out[match_id] = records
    return out


def load_match_cache_from_daily_files(
    path: Path,
    max_files: int
) -> tuple[dict[int, list[PlacementRecord]], list[str]]:
    files = _iter_daily_cache_files(path)
    limit = max(0, int(max_files))
    selected = files[:limit] if limit > 0 else []
    out: dict[int, list[PlacementRecord]] = {}
    used: list[str] = []
    for _, file_path in selected:
        entries = _load_match_cache_batch(file_path)
        for match_id in sorted(entries.keys(), reverse=True):
            if match_id in out:
                continue
            out[match_id] = entries[match_id]
        used.append(file_path.name)
    return out, used


def build_match_cache_index_payload(
    cache_entries: dict[int, list[PlacementRecord]]
) -> dict[str, Any]:
    sorted_match_ids = sorted(cache_entries.keys(), reverse=True)
    return {
        "schema_version": 1,
        "updated_at_utc": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "processed_matches": len(sorted_match_ids),
            "matches_with_samples": sum(
                1 for match_id in sorted_match_ids if cache_entries[match_id]
            ),
            "placement_samples": sum(
                len(cache_entries[match_id]) for match_id in sorted_match_ids
            )
        },
        "processed_match_ids": sorted_match_ids
    }


def write_match_cache_entry(
    cache_dir: Path,
    match_id: int,
    records: list[PlacementRecord]
) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "match_id": match_id,
        "samples": [
            serialize_placement_record(record)
            for record in records
        ]
    }
    (cache_dir / f"{match_id}.json").write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8"
    )


def write_match_cache_index(
    cache_dir: Path,
    cache_entries: dict[int, list[PlacementRecord]]
) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    index_payload = build_match_cache_index_payload(cache_entries)
    (cache_dir / "index.json").write_text(
        json.dumps(index_payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8"
    )


def iter_player_place_samples(
    match_id: int,
    player: dict[str, Any]
) -> list[tuple[str, str, str, PlacementSample]]:
    team = team_from_player_slot(player.get("player_slot"))
    placed_events: list[tuple[float, str, dict[str, Any]]] = []
    for log_name, ward_type in (("obs_log", "Observer"), ("sen_log", "Sentry")):
        raw_events = player.get(log_name)
        if not isinstance(raw_events, list):
            continue
        for event in raw_events:
            if not isinstance(event, dict):
                continue
            if event.get("x") is None or event.get("y") is None or event.get("time") is None:
                continue
            try:
                placed_events.append((float(event["time"]), ward_type, event))
            except (TypeError, ValueError):
                continue
    if not placed_events:
        return []

    placed_events.sort(key=lambda item: item[0])
    obs_left_by_ehandle, obs_left_by_coords = build_left_time_lookup(player, "obs_left_log")
    sen_left_by_ehandle, sen_left_by_coords = build_left_time_lookup(player, "sen_left_log")

    out: list[tuple[str, str, str, PlacementSample]] = []
    for event_time, ward_type, event in placed_events:
        bucket_id = classify_time_bucket(event_time)
        if bucket_id is None:
            continue
        minimap_x = float(event["x"])
        minimap_y = float(event["y"])
        world_x, world_y = minimap_to_world_xy(minimap_x, minimap_y)
        if ward_type == "Observer":
            lifetime_sec = consume_matching_left_time(
                event,
                event_time,
                ward_type,
                obs_left_by_ehandle,
                obs_left_by_coords
            )
        else:
            lifetime_sec = consume_matching_left_time(
                event,
                event_time,
                ward_type,
                sen_left_by_ehandle,
                sen_left_by_coords
            )
        sample = PlacementSample(
            match_id=match_id,
            event_time_sec=float(event_time),
            time_bucket=bucket_id,
            minimap_x=minimap_x,
            minimap_y=minimap_y,
            world_x=world_x,
            world_y=world_y,
            lifetime_sec=lifetime_sec
        )
        out.append((ward_type, team, bucket_id, sample))
    return out


def extract_match_samples(
    match_id: int,
    payload: dict[str, Any]
) -> list[PlacementRecord] | None:
    players = payload.get("players")
    if not isinstance(players, list) or len(players) == 0:
        return None

    out: list[PlacementRecord] = []
    for player in players:
        if not isinstance(player, dict):
            continue
        out.extend(iter_player_place_samples(match_id, player))
    return out


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8"
    )


def main() -> int:
    global REQUEST_THROTTLER
    args = parse_args()
    REQUEST_THROTTLER = RequestThrottler(args.request_delay_sec)
    output_path = Path(args.output).expanduser().resolve()
    cache_dir = Path(args.cache_dir).expanduser().resolve()
    daily_cache_dir = Path(args.daily_cache_dir).expanduser().resolve()
    log(
        f"start build: output={output_path} "
        f"cache_dir={cache_dir} "
        f"daily_cache_dir={daily_cache_dir} "
        f"matches={args.matches} reset_cache={bool(args.reset_cache)} "
        f"workers={args.workers} request_delay_sec={args.request_delay_sec:.3f}"
    )
    runtime_cache_entries: dict[int, list[PlacementRecord]]
    runtime_source_mode = ""
    runtime_used_daily_batches: list[str] = []
    cache_entries: dict[int, list[PlacementRecord]] = {}
    daily_window_size = (
        args.daily_batches_for_runtime
        if args.daily_batches_for_runtime is not None
        else args.daily_batch_retention
    )

    if args.build_from_daily_batches:
        runtime_cache_entries, runtime_used_daily_batches = load_match_cache_from_daily_files(
            daily_cache_dir,
            daily_window_size
        )
        if not runtime_cache_entries:
            raise RuntimeError(
                f"no daily cache entries found in {daily_cache_dir} for window={daily_window_size}"
            )
        cache_entries = dict(runtime_cache_entries)
        runtime_source_mode = "daily_cache_window"
        log(
            "runtime source: daily batches "
            f"(files={len(runtime_used_daily_batches)}, matches={len(runtime_cache_entries)})"
        )
    else:
        if args.skip_match_cache:
            cache_entries = {}
            if args.reset_cache:
                log("skip-match-cache requested, reset-cache flag ignored")
            else:
                log("skip-match-cache requested, cache-dir will not be read")
        else:
            if args.reset_cache:
                cache_entries = {}
                if cache_dir.exists():
                    shutil.rmtree(cache_dir)
                log("cache reset requested, starting from empty local base")
            else:
                if cache_dir.exists():
                    cache_entries = load_match_cache_dir(cache_dir)
                    log(f"loaded cache dir entries: {len(cache_entries)} matches")
                else:
                    cache_entries = {}
                    log("no cache found, starting from empty local base")

    if args.build_from_daily_batches:
        source_mode = runtime_source_mode
        scanned_candidates = 0
        match_ids = []
        fresh_match_ids = []
        new_matches_added = 0
    else:
        source_mode = "cache_dir_default"
        dedup_match_ids = set(cache_entries.keys())
        if args.dedup_from_daily_cache:
            dedup_window = max(1, int(args.daily_dedup_retention))
            dedup_entries, used_daily_cache_files = load_match_cache_from_daily_files(
                daily_cache_dir,
                dedup_window
            )
            dedup_match_ids.update(dedup_entries.keys())
            if used_daily_cache_files:
                log(
                    "dedup source: daily cache "
                    f"files={len(used_daily_cache_files)} matches={len(dedup_entries)}"
                )
        if args.match_ids_file is not None:
            match_ids = load_match_ids_from_file(args.match_ids_file, args.matches)
            source_mode = "match_ids_file+opendota_match_api"
            log(f"loaded candidate match ids from file: {len(match_ids)}")
        else:
            if args.matches <= 0:
                raise RuntimeError(
                    "--matches must be > 0 when fetching from OpenDota "
                    "(use --build-from-daily-batches or --match-ids-file instead)"
                )
            log(
                f"requesting up to {args.matches} uncached recent matches "
                "from OpenDota explorer"
            )
            match_ids, scanned_candidates = collect_recent_uncached_match_ids(
                args.matches,
                cached_match_ids=dedup_match_ids,
                timeout=args.timeout,
                retries=args.retries
            )
            source_mode = "opendota_match_api_recent_matches"
            log(
                f"received uncached recent match ids: {len(match_ids)} "
                f"(scanned_candidates={scanned_candidates})"
            )

        if not match_ids:
            raise RuntimeError("No match ids found. Cannot build ward runtime dataset.")

        cached_match_ids = set(cache_entries.keys())
        fresh_match_ids = [
            match_id for match_id in match_ids if match_id not in cached_match_ids
        ]
        log(
            f"cache filter: cached_hits={len(match_ids) - len(fresh_match_ids)} "
            f"new_matches={len(fresh_match_ids)}"
        )
        workers = max(1, int(args.workers))
        fetched_matches: dict[int, dict[str, Any]] = {}
        if fresh_match_ids:
            log(f"fetching {len(fresh_match_ids)} new match payloads with workers={workers}")
            with ThreadPoolExecutor(max_workers=workers) as executor:
                futures = {
                    executor.submit(fetch_match_payload, match_id, args.timeout, args.retries): match_id
                    for match_id in fresh_match_ids
                }
                completed_fetches = 0
                fetched_ok = 0
                for future in as_completed(futures):
                    match_id, payload = future.result()
                    completed_fetches += 1
                    if payload is not None:
                        fetched_matches[match_id] = payload
                        fetched_ok += 1
                    if (
                        completed_fetches == len(fresh_match_ids)
                        or completed_fetches % FETCH_PROGRESS_EVERY == 0
                    ):
                        log(
                            f"fetch progress: {completed_fetches}/{len(fresh_match_ids)} "
                            f"(ok={fetched_ok}, failed={completed_fetches - fetched_ok})"
                        )
        else:
            log("all requested matches already exist in cache, skipping network fetch")

        new_matches_added = 0
        parsed_with_samples = 0
        batch_match_entries: dict[int, list[PlacementRecord]] = {}
        for match_id in fresh_match_ids:
            payload = fetched_matches.get(match_id)
            if payload is None:
                continue
            extracted = extract_match_samples(match_id, payload)
            if extracted is None:
                continue
            if not args.skip_match_cache:
                cache_entries[match_id] = extracted
                write_match_cache_entry(cache_dir, match_id, extracted)
            batch_match_entries[match_id] = extracted
            new_matches_added += 1
            if extracted:
                parsed_with_samples += 1
            if (
                new_matches_added == len(fresh_match_ids)
                or new_matches_added % FETCH_PROGRESS_EVERY == 0
            ):
                log(
                    f"parse progress: added={new_matches_added}/{len(fresh_match_ids)} "
                    f"matches_with_samples={parsed_with_samples}"
                )

        if not args.skip_match_cache and not cache_entries:
            raise RuntimeError("No cached matches available. Cannot build ward runtime dataset.")
        if args.skip_match_cache:
            cache_entries = dict(batch_match_entries)

        if not args.skip_match_cache:
            log(f"writing cache index: {cache_dir}")
            write_match_cache_index(cache_dir, cache_entries)
            log(f"cache dir ready: total_cached_matches={len(cache_entries)}")

        if args.emit_daily_batch:
            daily_date = (
                _safe_parse_date(args.daily_cache_date)
                or datetime.now(timezone.utc).date()
            )
            written_batch_path = _write_daily_batch_file(
                daily_cache_dir,
                daily_date.isoformat(),
                batch_match_entries,
                source="opendota_api_fetch"
            )
            if written_batch_path is not None:
                log(f"wrote daily batch: {written_batch_path}")
            _enforce_daily_cache_retention(daily_cache_dir, args.daily_batch_retention)
        if args.skip_runtime_build:
            return 0


    groups: dict[tuple[str, str, str], SpatialGroupIndex] = {}
    total_observer_placements = 0
    total_sentry_placements = 0
    successful_matches = len(cache_entries)
    runtime_matches_for_source = len(runtime_cache_entries) if args.build_from_daily_batches else len(cache_entries)
    log(f"rebuilding runtime dataset from cached base: matches={runtime_matches_for_source}")

    cache_for_runtime = (
        runtime_cache_entries if args.build_from_daily_batches else cache_entries
    )

    for match_id in sorted(cache_for_runtime.keys(), reverse=True):
        for ward_type, team, _stored_bucket, sample in cache_for_runtime[match_id]:
            # Re-derive the bucket from raw event time so a change of TIME_BUCKETS
            # only needs a rebuild, and legacy cache records land in the new scheme.
            bucket_id = classify_time_bucket(sample.event_time_sec)
            if bucket_id is None:
                continue
            sample.time_bucket = bucket_id
            key = (ward_type, team, bucket_id)
            group = groups.get(key)
            if group is None:
                group = SpatialGroupIndex(
                    ward_type=ward_type,
                    team=team,
                    time_bucket=bucket_id,
                    cluster_radius_world=args.cluster_radius_world,
                    quick_deward_sec=args.quick_deward_sec,
                    success_lifetime_sec=args.success_lifetime_sec
                )
                groups[key] = group
            group.add(sample)
            if ward_type == "Observer":
                total_observer_placements += 1
            else:
                total_sentry_placements += 1

    max_spots_per_group = max(0, int(args.max_spots_per_group))
    # Pass 1: build payloads per group (thresholds only, no sort/cap yet).
    group_payloads: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for key in sorted(groups.keys()):
        payloads: list[dict[str, Any]] = []
        for spot in groups[key].spots:
            if spot.placements < max(1, args.min_placements):
                continue
            if spot.matches_seen < max(1, args.min_matches):
                continue
            payloads.append(
                build_spot_payload(
                    spot,
                    total_matches=successful_matches,
                    observer_max_quick_deward_rate=args.observer_max_quick_deward_rate
                )
            )
        group_payloads[key] = payloads

    # Pass 2: fold the counter-sentry signal into sentry scores before cap/sort,
    # so the runtime ranks sentries by a final score with no extra computation.
    apply_counter_sentry_scores(group_payloads)

    # Pass 3: sort each group by final score and apply the per-group cap.
    spots: list[dict[str, Any]] = []
    for key in sorted(group_payloads.keys()):
        group_spots = group_payloads[key]
        group_spots.sort(
            key=lambda item: (
                -float(item["stats"]["score"]),
                -int(item["stats"]["placements"]),
                item["spot_id"]
            )
        )
        if max_spots_per_group > 0:
            group_spots = group_spots[:max_spots_per_group]
        spots.extend(group_spots)

    log(f"writing runtime dataset: {output_path} (spots={len(spots)})")
    payload = {
        "schema_version": 5,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "dataset_type": "runtime",
        "source": {
            "matches_used": successful_matches,
            "mode": source_mode,
            "recent_matches_requested": len(match_ids),
            "new_matches_added": new_matches_added,
            "cached_matches": len(cache_for_runtime),
            "daily_cache_files_used": runtime_used_daily_batches,
            "cache_dir": str(cache_dir)
        },
        "config": {
            "grouping_mode": "spatial_cluster_centroid",
            "cluster_radius_world": round_metric(args.cluster_radius_world, 3),
            "min_spot_placements": max(1, int(args.min_placements)),
            "min_spot_matches": max(1, int(args.min_matches)),
            "time_buckets": [
                {
                    "id": bucket.id,
                    "min_sec": bucket.min_sec,
                    "max_sec": bucket.max_sec
                }
                for bucket in TIME_BUCKETS
            ]
        },
        "summary": {
            "total_placements": total_observer_placements + total_sentry_placements,
            "observer_placements": total_observer_placements,
            "sentry_placements": total_sentry_placements,
            "spots_count": len(spots)
        },
        "spots": spots
    }
    write_json(output_path, payload)
    log(
        "build complete: "
        f"new_matches_added={new_matches_added} cached_matches={len(cache_entries)} "
        f"observer_placements={total_observer_placements} "
        f"sentry_placements={total_sentry_placements} spots={len(spots)}"
    )
    print(
        json.dumps(
            {
                "ok": True,
                "output": str(output_path),
                "cache_dir": str(cache_dir),
                "matches_requested": len(match_ids),
                "new_matches_requested": len(fresh_match_ids),
                "new_matches_added": new_matches_added,
                "cached_matches": len(cache_entries),
                "matches_used": successful_matches,
                "spots": len(spots),
                "observer_placements": total_observer_placements,
                "sentry_placements": total_sentry_placements
            },
            ensure_ascii=False,
            indent=2
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
