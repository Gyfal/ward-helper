import argparse
import json
import os
import ssl
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

DEFAULT_ENDPOINT = "https://api.stratz.com/graphql"
BUCKETS = ("0-12", "12-32", "32+")
MAX_MATCH_IDS_PER_REQUEST = 10
MINIMAP_RENDER_SIZE = 512.0
MINIMAP_GRID_SIZE = 127.0
MINIMAP_GRID_OFFSET = 64.0
WORLD_UNITS_PER_CELL = 64.0
DEFAULT_OUTPUT_DIR = (
    Path(__file__).resolve().parent
    / "scripts_files"
    / "data"
    / "ward_sources"
)


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sample popular ward spots from STRATZ for the last N days. Console output only."
    )
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--token", default=None)
    parser.add_argument("--env-file", default=".env")
    parser.add_argument("--days-back", type=int, default=30)
    parser.add_argument(
        "--match-source",
        choices=("pro", "public"),
        default="pro",
        help="Source for sampled match ids: 'pro' from STRATZ leagues or 'public' from OpenDota publicMatches.",
    )
    parser.add_argument("--max-matches", type=int, default=60)
    parser.add_argument("--league-take", type=int, default=40)
    parser.add_argument("--league-skip", type=int, default=0)
    parser.add_argument("--league-matches-take", type=int, default=30)
    parser.add_argument("--league-matches-skip", type=int, default=0)
    parser.add_argument("--top-per-team", type=int, default=25)
    parser.add_argument(
        "--min-count",
        type=int,
        default=2,
        help="Keep only points that were placed at least this many times.",
    )
    parser.add_argument(
        "--min-distance",
        type=float,
        default=185.0,
        help=(
            "Minimum distance between selected ward points in world units. "
            "If points are closer, only the more popular one is kept."
        ),
    )
    parser.add_argument("--step", type=float, default=1.0)
    parser.add_argument("--first-split-sec", type=int, default=12 * 60)
    parser.add_argument("--second-split-sec", type=int, default=32 * 60)
    parser.add_argument("--type0-label", default="Observer")
    parser.add_argument("--type1-label", default="Sentry")
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--timeout-sec", type=float, default=25.0)
    parser.add_argument("--print-distances", action="store_true")
    parser.add_argument("--show-raw", action="store_true")
    parser.add_argument(
        "--output-file",
        default=None,
        help=(
            "Output filename inside scripts_files/data/ward_sources. "
            "Default: stratz_monthly_wards_<match-source>.json"
        ),
    )
    parser.add_argument(
        "--no-write",
        action="store_true",
        help="Do not write file, only print preview.",
    )
    return parser.parse_args()


def gql_request(
    endpoint: str,
    token: str,
    query: str,
    variables: dict[str, Any] | None,
    timeout_sec: float,
) -> tuple[int, dict[str, str], Any]:
    payload = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Connection": "close",
            "Authorization": f"Bearer {token}",
            "Origin": "https://stratz.com",
            "Referer": "https://stratz.com/",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/123.0.0.0 Safari/537.36"
            ),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            status = resp.status
            headers = dict(resp.headers.items())
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        status = error.code
        headers = dict(error.headers.items()) if error.headers else {}
        raw = error.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError, ssl.SSLError, OSError) as error:
        return 0, {}, {"transportError": f"{type(error).__name__}: {error}"}
    try:
        body = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        body = raw
    return status, headers, body


def is_cloudflare_challenge(body: Any) -> bool:
    if not isinstance(body, str):
        return False
    s = body.lower()
    return "just a moment" in s or "__cf_chl_opt" in s or "cdn-cgi/challenge-platform" in s


def gql_request_retry(
    endpoint: str,
    token: str,
    query: str,
    variables: dict[str, Any] | None,
    timeout_sec: float,
    retries: int,
) -> tuple[int, dict[str, str], Any]:
    max_attempts = max(1, retries + 1)
    for attempt in range(1, max_attempts + 1):
        status, headers, body = gql_request(endpoint, token, query, variables, timeout_sec)
        if status == 200 and isinstance(body, dict) and not body.get("errors"):
            return status, headers, body
        if status == 200 and not is_cloudflare_challenge(body):
            return status, headers, body
        if status == 0 and isinstance(body, dict) and body.get("transportError"):
            if attempt >= max_attempts:
                return status, headers, body
            wait_sec = min(8.0, 1.5 * attempt)
            print(
                f"transport error on attempt={attempt}/{max_attempts}: "
                f"{body['transportError']}; retry in {wait_sec:.1f}s"
            )
            time.sleep(wait_sec)
            continue
        if attempt >= max_attempts:
            return status, headers, body
        retry_after = headers.get("Retry-After")
        wait_sec = 1.2 * attempt
        if retry_after:
            try:
                wait_sec = max(wait_sec, float(retry_after))
            except ValueError:
                pass
        time.sleep(wait_sec)
    return status, headers, body


def print_rate_headers(headers: dict[str, str]) -> None:
    keep = {}
    for key, value in headers.items():
        low = key.lower()
        if "rate" in low or "limit" in low or low == "retry-after":
            keep[key] = value
    if not keep:
        print("rate_headers: none")
        return
    print("rate_headers:")
    for key, value in sorted(keep.items()):
        print(f"  {key}: {value}")


def fetch_public_match_ids(max_matches: int, timeout_sec: float) -> list[int]:
    url = "https://api.opendota.com/api/publicMatches"
    req = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Accept": "application/json",
            "User-Agent": "ward-helper/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except Exception as error:
        print(f"Failed to fetch OpenDota public matches: {error}")
        return []
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(payload, list):
        return []
    out: list[int] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        mid = item.get("match_id")
        if isinstance(mid, int):
            out.append(mid)
            if len(out) >= max_matches:
                break
    return out


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


def ensure_output_path(output_file: str) -> Path:
    output_name = Path(output_file).name
    return (DEFAULT_OUTPUT_DIR / output_name).resolve()


def write_text_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(text, encoding="utf-8", newline="\n")
    temp_path.replace(path)


def has_admin_error(body: Any) -> bool:
    if not isinstance(body, dict):
        return False
    errors = body.get("errors")
    if not isinstance(errors, list):
        return False
    for err in errors:
        if not isinstance(err, dict):
            continue
        msg = err.get("message")
        if isinstance(msg, str) and "not an admin" in msg.lower():
            return True
    return False


def bucket_for_time(t: int, first_split_sec: int, second_split_sec: int) -> str | None:
    if t < 0:
        return None
    if t < first_split_sec:
        return "0-12"
    if t < second_split_sec:
        return "12-32"
    return "32+"


def bin_xy(x: float, y: float, step: float) -> tuple[float, float]:
    return (round(float(x) / step) * step, round(float(y) / step) * step)


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
    ranked = [(point, count) for point, count in counts.most_common() if count >= min_count]
    if min_distance_world <= 0:
        return ranked if limit is None else ranked[:limit]
    out: list[tuple[tuple[float, float], int]] = []
    min_sq = min_distance_world * min_distance_world
    for point, count in ranked:
        if all(squared_distance_world_2d(point, p) > min_sq for p, _ in out):
            out.append((point, count))
            if limit is not None and len(out) >= limit:
                break
    return out


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
        if all(squared_distance_world_2d(point, kept_point) > min_sq for _, kept_point, _ in kept):
            kept.append((bucket, point, count))

    result = {bucket: [] for bucket in bucket_points.keys()}
    for bucket, point, count in kept:
        result[bucket].append((point, count))
    return result


def main() -> int:
    args = parse_args()
    load_env_file(Path(args.env_file))
    token = args.token or os.getenv("STRATZ_TOKEN")
    if not token:
        print("STRATZ_TOKEN not found. Set in env/.env or pass --token.")
        return 2
    if args.second_split_sec <= args.first_split_sec:
        print("--second-split-sec must be greater than --first-split-sec")
        return 2

    now = int(time.time())
    from_ts = now - max(1, args.days_back) * 24 * 60 * 60
    to_ts = now
    print(f"time_window_unix=[{from_ts}, {to_ts}] days_back={args.days_back}")

    leagues_query = """
query Leagues($request: LeagueRequestType!) {
  leagues(request: $request) {
    id
    name
    startDateTime
    endDateTime
    lastMatchDate
    matches(request: { take: 30, skip: 0 }) {
      id
      startDateTime
    }
  }
}
"""
    match_ids: list[int] = []
    if args.match_source == "public":
        match_ids = fetch_public_match_ids(args.max_matches, max(1.0, args.timeout_sec))
        print(f"public_match_ids_count={len(match_ids)}")
    else:
        leagues_request = {
            "betweenStartDateTime": from_ts,
            "betweenEndDateTime": to_ts,
            "take": args.league_take,
            "skip": args.league_skip,
            "leagueEnded": True,
        }
        status, headers, body = gql_request_retry(
            args.endpoint,
            token,
            leagues_query,
            {"request": leagues_request},
            max(1.0, args.timeout_sec),
            max(0, args.retries),
        )
        print(f"leagues_status={status}")
        print_rate_headers(headers)
        if status != 200 or not isinstance(body, dict):
            print("Failed to fetch leagues.")
            print(body)
            return 1
        if body.get("errors"):
            print("leagues_errors:")
            print(json.dumps(body["errors"], ensure_ascii=False, indent=2))
            return 1

        leagues = ((body.get("data") or {}).get("leagues")) or []
        if not isinstance(leagues, list):
            leagues = []
        print(f"leagues_count={len(leagues)}")

        seen = set()
        for league in leagues:
            if not isinstance(league, dict):
                continue
            matches = league.get("matches") or []
            for match in matches:
                if not isinstance(match, dict):
                    continue
                mid = match.get("id")
                start_dt = match.get("startDateTime")
                if not isinstance(mid, int):
                    continue
                if isinstance(start_dt, int):
                    if start_dt < from_ts or start_dt > to_ts:
                        continue
                if mid in seen:
                    continue
                seen.add(mid)
                match_ids.append(mid)
                if len(match_ids) >= args.max_matches:
                    break
            if len(match_ids) >= args.max_matches:
                break

    print(f"sampled_match_ids={len(match_ids)}")
    if len(match_ids) == 0:
        print("No match ids sampled for this window.")
        return 0

    matches_query = """
query Matches($ids: [Long]!) {
  matches(ids: $ids) {
    id
    startDateTime
    players {
      playerSlot
      isRadiant
      stats {
        wards {
          time
          positionX
          positionY
          type
        }
      }
    }
  }
}
"""
    single_match_query = """
query Match($id: Long!) {
  match(id: $id) {
    id
    startDateTime
    players {
      playerSlot
      isRadiant
      stats {
        wards {
          time
          positionX
          positionY
          type
        }
      }
    }
  }
}
"""
    all_matches: list[dict[str, Any]] = []
    batches = [
        match_ids[i: i + MAX_MATCH_IDS_PER_REQUEST]
        for i in range(0, len(match_ids), MAX_MATCH_IDS_PER_REQUEST)
    ]
    for index, batch_ids in enumerate(batches, start=1):
        status, headers, body = gql_request_retry(
            args.endpoint,
            token,
            matches_query,
            {"ids": batch_ids},
            max(1.0, args.timeout_sec),
            max(0, args.retries),
        )
        print(f"matches_batch={index}/{len(batches)} status={status} ids={len(batch_ids)}")
        print_rate_headers(headers)
        if status != 200 or not isinstance(body, dict):
            print("Failed to fetch matches batch.")
            print(body)
            return 1
        if body.get("errors"):
            if has_admin_error(body):
                print("matches(ids) is restricted for this token. Falling back to match(id) per id.")
                all_matches = []
                for idx, mid in enumerate(match_ids, start=1):
                    status1, headers1, body1 = gql_request_retry(
                        args.endpoint,
                        token,
                        single_match_query,
                        {"id": mid},
                        max(1.0, args.timeout_sec),
                        max(0, args.retries),
                    )
                    print(f"match_single={idx}/{len(match_ids)} status={status1} id={mid}")
                    if idx == 1 or idx % 10 == 0:
                        print_rate_headers(headers1)
                    if status1 != 200 or not isinstance(body1, dict):
                        continue
                    if body1.get("errors"):
                        continue
                    item = (body1.get("data") or {}).get("match")
                    if isinstance(item, dict):
                        all_matches.append(item)
                    time.sleep(0.15)
                break
            print("matches_batch_errors:")
            print(json.dumps(body["errors"], ensure_ascii=False, indent=2))
            return 1
        payload_matches = ((body.get("data") or {}).get("matches")) or []
        if isinstance(payload_matches, list):
            for item in payload_matches:
                if isinstance(item, dict):
                    all_matches.append(item)
    matches = all_matches
    print(f"matches_payload_count={len(matches)}")

    type_map = {
        0: args.type0_label,
        1: args.type1_label,
    }
    counts: dict[str, dict[str, dict[str, Counter[tuple[float, float]]]]] = {}
    for team in ("Radiant", "Dire"):
        counts[team] = {}
        for bucket in BUCKETS:
            counts[team][bucket] = {}
            for ward_type in (args.type0_label, args.type1_label):
                counts[team][bucket][ward_type] = Counter()

    total_ward_events = 0
    for match in matches:
        if not isinstance(match, dict):
            continue
        players = match.get("players") or []
        if not isinstance(players, list):
            continue
        for player in players:
            if not isinstance(player, dict):
                continue
            is_radiant = player.get("isRadiant")
            team = "Radiant" if is_radiant else "Dire"
            stats = player.get("stats") or {}
            wards = stats.get("wards") if isinstance(stats, dict) else []
            if not isinstance(wards, list):
                continue
            for ward in wards:
                if not isinstance(ward, dict):
                    continue
                t = ward.get("time")
                x = ward.get("positionX")
                y = ward.get("positionY")
                w_type = ward.get("type")
                if not isinstance(t, int) or not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
                    continue
                bucket = bucket_for_time(t, args.first_split_sec, args.second_split_sec)
                if bucket is None:
                    continue
                label = type_map.get(w_type)
                if label is None:
                    continue
                key = bin_xy(float(x), float(y), args.step)
                counts[team][bucket][label][key] += 1
                total_ward_events += 1

    print(f"total_ward_events_used={total_ward_events}")

    out = []
    bucket_selected: dict[str, dict[str, dict[str, list[tuple[tuple[float, float], int]]]]] = {}
    for team in ("Radiant", "Dire"):
        bucket_selected[team] = {}
        for ward_type in (args.type0_label, args.type1_label):
            bucket_selected[team][ward_type] = {}

    for team in ("Radiant", "Dire"):
        for bucket in BUCKETS:
            for ward_type in (args.type0_label, args.type1_label):
                bucket_selected[team][ward_type][bucket] = select_popular_non_overlapping(
                    counts[team][bucket][ward_type],
                    args.top_per_team,
                    max(0.0, args.min_distance),
                    min_count=max(1, args.min_count),
                )

    for team in ("Radiant", "Dire"):
        for ward_type in (args.type0_label, args.type1_label):
            bucket_selected[team][ward_type] = dedup_across_buckets(
                bucket_selected[team][ward_type],
                max(0.0, args.min_distance),
            )

    for team in ("Radiant", "Dire"):
        for bucket in BUCKETS:
            for ward_type in (args.type0_label, args.type1_label):
                top_points = bucket_selected[team][ward_type][bucket]
                if args.print_distances:
                    print(f"[{team}][{ward_type}][{bucket}] x y dist next")
                    for i, ((x, y), _) in enumerate(top_points):
                        next_dist = "-"
                        if i + 1 < len(top_points):
                            nx, ny = top_points[i + 1][0]
                            next_dist = (
                                f"{(squared_distance_world_2d((x, y), (nx, ny)) ** 0.5):.1f}"
                            )
                        print(f"{x:.1f} {y:.1f} {next_dist} next")
                for (x, y), c in top_points:
                    render_x, render_y = minimap_to_render_xy(x, y)
                    out.append(
                        {
                            "teams": [team],
                            "type": ward_type,
                            "timeBucket": bucket,
                            "x": render_x,
                            "y": render_y,
                            "z": 256.0,
                            "minimapX": x,
                            "minimapY": y,
                            "count": c,
                        }
                    )

    print(f"result_points={len(out)}")
    if not args.no_write:
        output_name = args.output_file or f"stratz_monthly_wards_{args.match_source}.json"
        output_path = ensure_output_path(output_name)
        write_text_atomic(output_path, json.dumps(out, ensure_ascii=False, indent=2) + "\n")
        print(f"wrote_file={output_path}")
    if args.show_raw:
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(out[: min(20, len(out))], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
