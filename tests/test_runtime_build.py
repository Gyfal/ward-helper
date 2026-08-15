from __future__ import annotations

import json

import build_ward_reco_runtime as builder
import pytest


def sample_payload(
    *,
    match_id: int,
    ward_type: str,
    team: str,
    event_time_sec: float,
    minimap_x: float,
    minimap_y: float,
    lifetime_sec: float | None,
) -> dict:
    bucket = builder.classify_time_bucket(event_time_sec)
    world_x, world_y = builder.minimap_to_world_xy(minimap_x, minimap_y)
    return builder.serialize_placement_record(
        (
            ward_type,
            team,
            bucket,
            builder.PlacementSample(
                match_id=match_id,
                event_time_sec=event_time_sec,
                time_bucket=bucket,
                minimap_x=minimap_x,
                minimap_y=minimap_y,
                world_x=world_x,
                world_y=world_y,
                lifetime_sec=lifetime_sec,
            ),
        )
    )


def write_daily_file(directory, day: str, matches: list[dict]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{day}.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "generated_at_utc": f"{day}T00:00:00+00:00",
                "source": "unit-test",
                "matches": matches,
            }
        ),
        encoding="utf-8",
    )


def observer_match(match_id: int, minimap_x: float, minimap_y: float) -> dict:
    return {
        "match_id": match_id,
        "samples": [
            sample_payload(
                match_id=match_id,
                ward_type="Observer",
                team="radiant",
                event_time_sec=120.0,
                minimap_x=minimap_x,
                minimap_y=minimap_y,
                lifetime_sec=400.0,
            )
        ],
    }


@pytest.fixture
def run_build(tmp_path, monkeypatch):
    """Runs main() against a local daily cache so no network is involved."""
    daily_dir = tmp_path / "daily"
    output_path = tmp_path / "out" / "runtime.json"

    def runner(*extra_args: str) -> dict:
        argv = [
            "build_ward_reco_runtime.py",
            "--output",
            str(output_path),
            "--cache-dir",
            str(tmp_path / "cache"),
            "--daily-cache-dir",
            str(daily_dir),
            "--build-from-daily-batches",
            *extra_args,
        ]
        monkeypatch.setattr(builder.sys, "argv", argv)
        assert builder.main() == 0
        return json.loads(output_path.read_text(encoding="utf-8"))

    runner.daily_dir = daily_dir
    runner.output_path = output_path
    return runner


class TestBuildFromDailyBatches:
    def test_runtime_payload_shape(self, run_build):
        write_daily_file(
            run_build.daily_dir,
            "2026-01-02",
            [observer_match(1, 100.0, 100.0), observer_match(2, 100.5, 100.0)],
        )
        payload = run_build("--min-placements", "2", "--min-matches", "2")
        assert payload["schema_version"] == 5
        assert payload["dataset_type"] == "runtime"
        assert payload["source"]["mode"] == "daily_cache_window"
        assert payload["source"]["daily_cache_files_used"] == ["2026-01-02.json"]
        assert payload["source"]["matches_used"] == 2
        assert payload["summary"] == {
            "total_placements": 2,
            "observer_placements": 2,
            "sentry_placements": 0,
            "spots_count": 1,
        }
        assert [bucket["id"] for bucket in payload["config"]["time_buckets"]] == [
            bucket.id for bucket in builder.TIME_BUCKETS
        ]

    def test_spot_carries_grouping_keys_and_stats(self, run_build):
        write_daily_file(
            run_build.daily_dir,
            "2026-01-02",
            [observer_match(1, 100.0, 100.0), observer_match(2, 100.0, 100.0)],
        )
        spot = run_build("--min-placements", "2", "--min-matches", "2")["spots"][0]
        assert spot["type"] == "Observer"
        assert spot["team"] == "radiant"
        assert spot["time_bucket"] == "0_12"
        assert spot["stats"]["placements"] == 2
        assert spot["stats"]["matches_seen"] == 2
        assert spot["stats"]["success_rate"] == 1.0
        assert spot["flags"]["observer_risky_quick_deward"] is False

    def test_thresholds_drop_thin_spots(self, run_build):
        write_daily_file(run_build.daily_dir, "2026-01-02", [observer_match(1, 100.0, 100.0)])
        payload = run_build("--min-placements", "2", "--min-matches", "2")
        assert payload["spots"] == []
        assert payload["summary"]["total_placements"] == 1

    def test_only_the_requested_window_of_daily_files_is_used(self, run_build):
        write_daily_file(run_build.daily_dir, "2026-01-01", [observer_match(1, 100.0, 100.0)])
        write_daily_file(run_build.daily_dir, "2026-01-02", [observer_match(2, 100.0, 100.0)])
        payload = run_build(
            "--daily-batches-for-runtime",
            "1",
            "--min-placements",
            "1",
            "--min-matches",
            "1",
        )
        assert payload["source"]["daily_cache_files_used"] == ["2026-01-02.json"]
        assert payload["source"]["matches_used"] == 1

    def test_time_buckets_are_re_derived_from_event_time(self, run_build):
        stale = observer_match(1, 100.0, 100.0)
        stale["samples"][0]["time_bucket"] = "50_plus"
        second = observer_match(2, 100.0, 100.0)
        second["samples"][0]["time_bucket"] = "50_plus"
        write_daily_file(run_build.daily_dir, "2026-01-02", [stale, second])
        payload = run_build("--min-placements", "2", "--min-matches", "2")
        assert [spot["time_bucket"] for spot in payload["spots"]] == ["0_12"]

    def test_spots_are_sorted_by_score_within_a_group(self, run_build):
        matches = [observer_match(index, 100.0, 100.0) for index in range(1, 5)]
        matches.extend(
            [observer_match(index, 50.0, 50.0) for index in range(5, 7)]
        )
        write_daily_file(run_build.daily_dir, "2026-01-02", matches)
        spots = run_build("--min-placements", "2", "--min-matches", "2")["spots"]
        scores = [spot["stats"]["score"] for spot in spots]
        assert len(spots) == 2
        assert scores == sorted(scores, reverse=True)

    def test_max_spots_per_group_caps_output(self, run_build):
        matches = []
        for index in range(1, 5):
            matches.append(observer_match(index, 100.0, 100.0))
        for index in range(5, 9):
            matches.append(observer_match(index, 50.0, 50.0))
        write_daily_file(run_build.daily_dir, "2026-01-02", matches)
        payload = run_build(
            "--min-placements",
            "2",
            "--min-matches",
            "2",
            "--max-spots-per-group",
            "1",
        )
        assert len(payload["spots"]) == 1

    def test_counter_sentry_boost_is_baked_into_sentry_scores(self, run_build):
        matches = []
        for index in range(1, 3):
            matches.append(
                {
                    "match_id": index,
                    "samples": [
                        sample_payload(
                            match_id=index,
                            ward_type="Sentry",
                            team="radiant",
                            event_time_sec=120.0,
                            minimap_x=100.0,
                            minimap_y=100.0,
                            lifetime_sec=400.0,
                        )
                    ],
                }
            )
        for index in range(3, 5):
            matches.append(
                {
                    "match_id": index,
                    "samples": [
                        sample_payload(
                            match_id=index,
                            ward_type="Observer",
                            team="dire",
                            event_time_sec=120.0,
                            minimap_x=100.0,
                            minimap_y=100.0,
                            lifetime_sec=400.0,
                        )
                    ],
                }
            )
        write_daily_file(run_build.daily_dir, "2026-01-02", matches)
        payload = run_build("--min-placements", "2", "--min-matches", "2")
        by_type = {spot["type"]: spot for spot in payload["spots"]}
        observer_score = by_type["Observer"]["stats"]["score"]
        sentry_score = by_type["Sentry"]["stats"]["score"]
        assert sentry_score == pytest.approx(observer_score * 2, rel=1e-6)

    def test_empty_daily_window_fails_loudly(self, run_build):
        run_build.daily_dir.mkdir(parents=True, exist_ok=True)
        with pytest.raises(RuntimeError, match="no daily cache entries"):
            run_build()

    def test_output_file_ends_with_a_newline(self, run_build):
        write_daily_file(
            run_build.daily_dir,
            "2026-01-02",
            [observer_match(1, 100.0, 100.0), observer_match(2, 100.0, 100.0)],
        )
        run_build("--min-placements", "2", "--min-matches", "2")
        assert run_build.output_path.read_text(encoding="utf-8").endswith("\n")


def opendota_match_payload(match_id: int, minimap_x: float, minimap_y: float) -> dict:
    return {
        "players": [
            {
                "player_slot": 0,
                "obs_log": [
                    {"time": 120.0, "x": minimap_x, "y": minimap_y, "ehandle": match_id}
                ],
                "obs_left_log": [
                    {"time": 520.0, "x": minimap_x, "y": minimap_y, "ehandle": match_id}
                ],
            }
        ]
    }


@pytest.fixture
def run_fetch_build(tmp_path, monkeypatch):
    """Runs main() in fetch mode with the OpenDota calls stubbed out."""
    daily_dir = tmp_path / "daily"
    cache_dir = tmp_path / "cache"
    output_path = tmp_path / "out" / "runtime.json"
    available: dict[int, dict] = {
        1: opendota_match_payload(1, 100.0, 100.0),
        2: opendota_match_payload(2, 100.0, 100.0),
    }

    monkeypatch.setattr(
        builder,
        "collect_recent_uncached_match_ids",
        lambda target, cached_match_ids, timeout, retries: (
            [match_id for match_id in available if match_id not in cached_match_ids],
            len(available),
        ),
    )
    monkeypatch.setattr(
        builder,
        "fetch_match_payload",
        lambda match_id, timeout, retries: (match_id, available.get(match_id)),
    )

    def runner(*extra_args: str) -> int:
        argv = [
            "build_ward_reco_runtime.py",
            "--output",
            str(output_path),
            "--cache-dir",
            str(cache_dir),
            "--daily-cache-dir",
            str(daily_dir),
            "--matches",
            "2",
            "--min-placements",
            "2",
            "--min-matches",
            "2",
            "--request-delay-sec",
            "0",
            *extra_args,
        ]
        monkeypatch.setattr(builder.sys, "argv", argv)
        return builder.main()

    runner.available = available
    runner.daily_dir = daily_dir
    runner.cache_dir = cache_dir
    runner.output_path = output_path
    return runner


class TestBuildFromFetchedMatches:
    def test_fetched_matches_are_cached_and_aggregated(self, run_fetch_build):
        assert run_fetch_build() == 0
        payload = json.loads(run_fetch_build.output_path.read_text(encoding="utf-8"))
        assert payload["source"]["mode"] == "opendota_match_api_recent_matches"
        assert payload["source"]["new_matches_added"] == 2
        assert payload["summary"]["observer_placements"] == 2
        assert len(payload["spots"]) == 1
        assert sorted(path.name for path in run_fetch_build.cache_dir.glob("*.json")) == [
            "1.json",
            "2.json",
            "index.json",
        ]

    def test_fetch_mode_needs_fresh_ids_even_when_the_cache_is_warm(self, run_fetch_build):
        """Fetch mode aborts when the explorer returns no uncached ids, so a pure
        rebuild from an existing base has to go through --build-from-daily-batches."""
        assert run_fetch_build() == 0
        with pytest.raises(RuntimeError, match="No match ids found"):
            run_fetch_build()

    def test_daily_batch_emission_writes_a_dated_file(self, run_fetch_build):
        assert run_fetch_build("--emit-daily-batch", "--daily-cache-date", "2026-03-04") == 0
        assert [path.name for path in run_fetch_build.daily_dir.glob("*.json")] == [
            "2026-03-04.json"
        ]

    def test_skip_runtime_build_stops_after_the_daily_batch(self, run_fetch_build):
        assert (
            run_fetch_build(
                "--emit-daily-batch",
                "--daily-cache-date",
                "2026-03-04",
                "--skip-runtime-build",
            )
            == 0
        )
        assert (run_fetch_build.daily_dir / "2026-03-04.json").exists()
        assert not run_fetch_build.output_path.exists()

    def test_skip_match_cache_leaves_no_cache_dir_behind(self, run_fetch_build):
        assert run_fetch_build("--skip-match-cache") == 0
        assert not run_fetch_build.cache_dir.exists()

    def test_no_match_ids_fails_loudly(self, run_fetch_build, monkeypatch):
        monkeypatch.setattr(
            builder,
            "collect_recent_uncached_match_ids",
            lambda *_args, **_kwargs: ([], 0),
        )
        with pytest.raises(RuntimeError, match="No match ids found"):
            run_fetch_build()

    def test_zero_matches_without_a_source_fails_loudly(self, run_fetch_build):
        with pytest.raises(RuntimeError, match="--matches must be > 0"):
            run_fetch_build("--matches", "0")

    def test_match_ids_file_is_used_as_the_candidate_source(self, run_fetch_build, tmp_path):
        ids_file = tmp_path / "ids.json"
        ids_file.write_text(json.dumps([{"match_id": 1}, {"match_id": 2}]), encoding="utf-8")
        assert run_fetch_build("--match-ids-file", str(ids_file)) == 0
        payload = json.loads(run_fetch_build.output_path.read_text(encoding="utf-8"))
        assert payload["source"]["mode"] == "match_ids_file+opendota_match_api"

    def test_reset_cache_rebuilds_from_scratch(self, run_fetch_build):
        assert run_fetch_build() == 0
        assert run_fetch_build("--reset-cache") == 0
        payload = json.loads(run_fetch_build.output_path.read_text(encoding="utf-8"))
        assert payload["source"]["new_matches_added"] == 2

    def test_dedup_from_daily_cache_skips_matches_already_in_daily_files(
        self, run_fetch_build
    ):
        write_daily_file(
            run_fetch_build.daily_dir, "2026-03-01", [observer_match(1, 100.0, 100.0)]
        )
        assert (
            run_fetch_build("--dedup-from-daily-cache", "--daily-dedup-retention", "1") == 0
        )
        payload = json.loads(run_fetch_build.output_path.read_text(encoding="utf-8"))
        assert payload["source"]["new_matches_added"] == 1
        assert sorted(path.name for path in run_fetch_build.cache_dir.glob("*.json")) == [
            "2.json",
            "index.json",
        ]
