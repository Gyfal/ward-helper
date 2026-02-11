import argparse
import json
import os
import ssl
import time
import urllib.error
import urllib.request
from pathlib import Path


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


def is_cloudflare_challenge(body: object) -> bool:
    if not isinstance(body, str):
        return False
    low = body.lower()
    return "just a moment" in low or "__cf_chl_opt" in low or "cdn-cgi/challenge-platform" in low


def gql_request(token: str, query: str, variables: dict, timeout_sec: float) -> tuple[int, dict, object]:
    payload = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    req = urllib.request.Request(
        "https://api.stratz.com/graphql",
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
    body: object
    try:
        body = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        body = raw
    return status, headers, body


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Dump STRATZ ward events for a single match as CSV."
    )
    parser.add_argument("--match-id", type=int, required=True)
    parser.add_argument("--env-file", default=".env")
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--timeout-sec", type=float, default=25.0)
    args = parser.parse_args()

    load_env_file(Path(args.env_file))
    token = os.getenv("STRATZ_TOKEN")
    if not token:
        print("No STRATZ_TOKEN in env/.env")
        return 2

    query = """
query Match($id: Long!) {
  match(id: $id) {
    id
    players {
      isRadiant
      playerSlot
      steamAccountId
      heroId
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
    status: int = 0
    headers: dict = {}
    body: object = {}
    max_attempts = max(1, args.retries + 1)
    for attempt in range(1, max_attempts + 1):
        status, headers, body = gql_request(
            token, query, {"id": args.match_id}, max(1.0, args.timeout_sec)
        )
        if status == 200 and isinstance(body, dict) and not body.get("errors"):
            break
        if status == 200 and not is_cloudflare_challenge(body):
            break
        if status == 0 and isinstance(body, dict) and body.get("transportError"):
            if attempt >= max_attempts:
                break
            wait_sec = min(8.0, 1.5 * attempt)
            print(f"transport_error={body['transportError']}; retry in {wait_sec:.1f}s")
            time.sleep(wait_sec)
            continue
        if attempt >= max_attempts:
            break
        retry_after = headers.get("Retry-After")
        wait_sec = 1.2 * attempt
        if retry_after:
            try:
                wait_sec = max(wait_sec, float(retry_after))
            except ValueError:
                pass
        print(f"retry attempt={attempt + 1}/{max_attempts} in {wait_sec:.1f}s")
        time.sleep(wait_sec)

    print(f"status={status}")
    for key, value in sorted(headers.items()):
        lk = key.lower()
        if "rate" in lk or "limit" in lk or lk == "retry-after":
            print(f"{key}: {value}")

    if not isinstance(body, dict):
        print(body)
        return 1

    errors = body.get("errors")
    if errors:
        print("errors:")
        print(json.dumps(errors, ensure_ascii=False, indent=2))
        return 1

    match = (body.get("data") or {}).get("match")
    if not isinstance(match, dict):
        print("No match in response.")
        return 1

    def format_game_time(seconds: int) -> str:
        sign = "-" if seconds < 0 else ""
        value = abs(seconds)
        return f"{sign}{value // 60}:{value % 60:02d}"

    rows: list[tuple[str, str, int, float, float, int, int, int]] = []
    players = match.get("players") or []
    for p in players:
        if not isinstance(p, dict):
            continue
        team = "Radiant" if p.get("isRadiant") else "Dire"
        hero_id = int(p.get("heroId") or 0)
        slot = int(p.get("playerSlot") or 0)
        steam_id = int(p.get("steamAccountId") or 0)
        wards = ((p.get("stats") or {}).get("wards")) or []
        for w in wards:
            if not isinstance(w, dict):
                continue
            t = w.get("time")
            x = w.get("positionX")
            y = w.get("positionY")
            tp = w.get("type")
            if not isinstance(t, int) or not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
                continue
            ward_type = "Sentry" if tp == 1 else ("Observer" if tp == 0 else f"type_{tp}")
            rows.append((team, ward_type, t, float(x), float(y), hero_id, slot, steam_id))

    rows.sort(key=lambda r: (r[0], r[1], r[2]))
    print(f"ward_events={len(rows)}")
    print("team,type,time,gameTime,minimapX,minimapY,heroId,slot,steamId")
    for row in rows:
        print(
            f"{row[0]},{row[1]},{row[2]},{format_game_time(row[2])},"
            f"{row[3]:.1f},{row[4]:.1f},{row[5]},{row[6]},{row[7]}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
