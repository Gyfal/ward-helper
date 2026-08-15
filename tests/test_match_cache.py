from __future__ import annotations

import json
from datetime import date

import build_ward_reco_runtime as builder
import pytest


def record(
    *,
    match_id: int = 1,
    ward_type: str = "Observer",
    team: str = "radiant",
    event_time_sec: float = 600.0,
    lifetime_sec: float | None = 250.0,
) -> builder.PlacementRecord:
    bucket = builder.classify_time_bucket(event_time_sec) or "0_12"
    world_x, world_y = builder.minimap_to_world_xy(100.0, 110.0)
    sample = builder.PlacementSample(
        match_id=match_id,
        event_time_sec=event_time_sec,
        time_bucket=bucket,
        minimap_x=100.0,
        minimap_y=110.0,
        world_x=world_x,
        world_y=world_y,
        lifetime_sec=lifetime_sec,
    )
    return ward_type, team, bucket, sample


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


class TestSerializeRoundTrip:
    def test_round_trip_preserves_fields(self):
        original = record(match_id=5, event_time_sec=1234.5, lifetime_sec=321.25)
        restored = builder.deserialize_placement_record(
            5, builder.serialize_placement_record(original)
        )
        assert restored is not None
        assert restored[:3] == original[:3]
        assert restored[3] == original[3]

    def test_serialized_payload_has_the_slim_schema_keys(self):
        payload = builder.serialize_placement_record(record())
        assert set(payload) == {
            "ward_type",
            "team",
            "time_bucket",
            "event_time_sec",
            "minimap_x",
            "minimap_y",
            "world_x",
            "world_y",
            "lifetime_sec",
        }

    def test_missing_lifetime_serializes_as_null(self):
        payload = builder.serialize_placement_record(record(lifetime_sec=None))
        assert payload["lifetime_sec"] is None

    def test_deserialize_rejects_non_dict(self):
        assert builder.deserialize_placement_record(1, "nope") is None

    @pytest.mark.parametrize(
        "missing_key",
        ["ward_type", "team", "time_bucket", "minimap_x", "minimap_y", "world_x", "world_y"],
    )
    def test_deserialize_rejects_records_missing_required_keys(self, missing_key):
        payload = builder.serialize_placement_record(record())
        payload.pop(missing_key)
        assert builder.deserialize_placement_record(1, payload) is None

    def test_deserialize_rejects_unparsable_numbers(self):
        payload = builder.serialize_placement_record(record())
        payload["world_x"] = "abc"
        assert builder.deserialize_placement_record(1, payload) is None

    def test_unparsable_lifetime_becomes_none(self):
        payload = builder.serialize_placement_record(record())
        payload["lifetime_sec"] = "abc"
        restored = builder.deserialize_placement_record(1, payload)
        assert restored is not None
        assert restored[3].lifetime_sec is None

    def test_legacy_record_without_event_time_uses_bucket_midpoint(self):
        payload = builder.serialize_placement_record(record())
        payload.pop("event_time_sec")
        payload["time_bucket"] = "25_50"
        restored = builder.deserialize_placement_record(1, payload)
        assert restored is not None
        assert restored[3].event_time_sec == pytest.approx(2250.0)
        assert builder.classify_time_bucket(restored[3].event_time_sec) == "25_50"

    def test_match_id_comes_from_the_caller_not_the_payload(self):
        payload = builder.serialize_placement_record(record(match_id=1))
        restored = builder.deserialize_placement_record(777, payload)
        assert restored is not None
        assert restored[3].match_id == 777


class TestLoadMatchCacheEntry:
    def test_valid_entry(self):
        entry = {
            "match_id": "123",
            "samples": [builder.serialize_placement_record(record(match_id=123))],
        }
        parsed = builder.load_match_cache_entry(entry)
        assert parsed is not None
        match_id, records = parsed
        assert match_id == 123
        assert len(records) == 1

    def test_entry_without_match_id_is_rejected(self):
        assert builder.load_match_cache_entry({"samples": []}) is None

    def test_non_dict_entry_is_rejected(self):
        assert builder.load_match_cache_entry(["match_id", 1]) is None

    def test_unparsable_match_id_is_rejected(self):
        assert builder.load_match_cache_entry({"match_id": "abc"}) is None

    def test_missing_samples_yields_an_empty_record_list(self):
        assert builder.load_match_cache_entry({"match_id": 1}) == (1, [])

    def test_broken_samples_are_skipped_individually(self):
        entry = {
            "match_id": 1,
            "samples": [
                "nope",
                {"ward_type": "Observer"},
                builder.serialize_placement_record(record()),
            ],
        }
        _, records = builder.load_match_cache_entry(entry)
        assert len(records) == 1


class TestLoadMatchCacheDir:
    def test_missing_directory_is_empty(self, tmp_path):
        assert builder.load_match_cache_dir(tmp_path / "nope") == {}

    def test_loads_every_match_file(self, tmp_path):
        builder.write_match_cache_entry(tmp_path, 10, [record(match_id=10)])
        builder.write_match_cache_entry(tmp_path, 11, [])
        entries = builder.load_match_cache_dir(tmp_path)
        assert sorted(entries) == [10, 11]
        assert len(entries[10]) == 1
        assert entries[11] == []

    def test_index_file_is_not_loaded_as_a_match(self, tmp_path):
        builder.write_match_cache_entry(tmp_path, 10, [record(match_id=10)])
        builder.write_match_cache_index(tmp_path, {10: [record(match_id=10)]})
        assert sorted(builder.load_match_cache_dir(tmp_path)) == [10]

    def test_corrupt_and_unrelated_files_are_skipped(self, tmp_path):
        builder.write_match_cache_entry(tmp_path, 10, [record(match_id=10)])
        (tmp_path / "broken.json").write_text("{not json", encoding="utf-8")
        (tmp_path / "notes.txt").write_text("ignored", encoding="utf-8")
        assert sorted(builder.load_match_cache_dir(tmp_path)) == [10]


class TestCacheIndex:
    def test_index_payload_summary(self):
        entries = {
            3: [record(match_id=3), record(match_id=3)],
            1: [record(match_id=1)],
            2: [],
        }
        payload = builder.build_match_cache_index_payload(entries)
        assert payload["schema_version"] == 1
        assert payload["processed_match_ids"] == [3, 2, 1]
        assert payload["summary"] == {
            "processed_matches": 3,
            "matches_with_samples": 2,
            "placement_samples": 3,
        }

    def test_empty_index_payload(self):
        payload = builder.build_match_cache_index_payload({})
        assert payload["processed_match_ids"] == []
        assert payload["summary"]["processed_matches"] == 0

    def test_write_index_creates_missing_directories(self, tmp_path):
        cache_dir = tmp_path / "nested" / "cache"
        builder.write_match_cache_index(cache_dir, {1: [record()]})
        assert read_json(cache_dir / "index.json")["processed_match_ids"] == [1]

    def test_write_entry_creates_missing_directories(self, tmp_path):
        cache_dir = tmp_path / "nested" / "cache"
        builder.write_match_cache_entry(cache_dir, 7, [record(match_id=7)])
        payload = read_json(cache_dir / "7.json")
        assert payload["match_id"] == 7
        assert len(payload["samples"]) == 1


class TestDailyBatchFiles:
    def test_empty_batch_writes_nothing(self, tmp_path):
        assert builder._write_daily_batch_file(tmp_path, "2026-01-01", {}, "test") is None
        assert list(tmp_path.glob("*.json")) == []

    def test_batch_file_layout(self, tmp_path):
        path = builder._write_daily_batch_file(
            tmp_path,
            "2026-01-02",
            {1: [record(match_id=1)], 3: [record(match_id=3)]},
            "unit-test",
        )
        assert path == tmp_path / "2026-01-02.json"
        payload = read_json(path)
        assert payload["schema_version"] == 1
        assert payload["source"] == "unit-test"
        assert [entry["match_id"] for entry in payload["matches"]] == [3, 1]

    def test_batch_round_trips_through_the_loader(self, tmp_path):
        builder._write_daily_batch_file(
            tmp_path, "2026-01-02", {5: [record(match_id=5)]}, "unit-test"
        )
        entries, used = builder.load_match_cache_from_daily_files(tmp_path, 1)
        assert used == ["2026-01-02.json"]
        assert list(entries) == [5]
        assert entries[5][0][0] == "Observer"
        assert entries[5][0][3].match_id == 5

    def test_window_selects_the_newest_files(self, tmp_path):
        for day, match_id in (("2026-01-01", 1), ("2026-01-02", 2), ("2026-01-03", 3)):
            builder._write_daily_batch_file(
                tmp_path, day, {match_id: [record(match_id=match_id)]}, "unit-test"
            )
        entries, used = builder.load_match_cache_from_daily_files(tmp_path, 2)
        assert used == ["2026-01-03.json", "2026-01-02.json"]
        assert sorted(entries) == [2, 3]

    def test_window_larger_than_available_files_uses_everything(self, tmp_path):
        builder._write_daily_batch_file(
            tmp_path, "2026-01-01", {1: [record(match_id=1)]}, "unit-test"
        )
        entries, used = builder.load_match_cache_from_daily_files(tmp_path, 5)
        assert len(used) == 1
        assert list(entries) == [1]

    def test_zero_window_loads_nothing(self, tmp_path):
        builder._write_daily_batch_file(
            tmp_path, "2026-01-01", {1: [record(match_id=1)]}, "unit-test"
        )
        assert builder.load_match_cache_from_daily_files(tmp_path, 0) == ({}, [])

    def test_missing_directory_loads_nothing(self, tmp_path):
        assert builder.load_match_cache_from_daily_files(tmp_path / "nope", 5) == ({}, [])

    def test_newest_file_wins_for_duplicate_match_ids(self, tmp_path):
        builder._write_daily_batch_file(
            tmp_path,
            "2026-01-01",
            {1: [record(match_id=1, ward_type="Sentry")]},
            "unit-test",
        )
        builder._write_daily_batch_file(
            tmp_path,
            "2026-01-02",
            {1: [record(match_id=1, ward_type="Observer")]},
            "unit-test",
        )
        entries, used = builder.load_match_cache_from_daily_files(tmp_path, 2)
        assert used == ["2026-01-02.json", "2026-01-01.json"]
        assert entries[1][0][0] == "Observer"

    def test_files_with_unexpected_names_are_ignored(self, tmp_path):
        builder._write_daily_batch_file(
            tmp_path, "2026-01-01", {1: [record(match_id=1)]}, "unit-test"
        )
        (tmp_path / "latest.json").write_text('{"matches": []}', encoding="utf-8")
        (tmp_path / "2026-13-45.json").write_text('{"matches": []}', encoding="utf-8")
        assert [path.name for _, path in builder._iter_daily_cache_files(tmp_path)] == [
            "2026-01-01.json"
        ]

    def test_daily_files_are_sorted_newest_first(self, tmp_path):
        for day in ("2026-01-05", "2026-02-01", "2025-12-31"):
            builder._write_daily_batch_file(
                tmp_path, day, {1: [record(match_id=1)]}, "unit-test"
            )
        assert [day for day, _ in builder._iter_daily_cache_files(tmp_path)] == [
            date(2026, 2, 1),
            date(2026, 1, 5),
            date(2025, 12, 31),
        ]


class TestDailyRetention:
    def _seed(self, tmp_path, days):
        for day in days:
            builder._write_daily_batch_file(
                tmp_path, day, {1: [record(match_id=1)]}, "unit-test"
            )

    def test_oldest_files_beyond_retention_are_removed(self, tmp_path):
        self._seed(tmp_path, ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"])
        builder._enforce_daily_cache_retention(tmp_path, 2)
        assert sorted(path.name for path in tmp_path.glob("*.json")) == [
            "2026-01-03.json",
            "2026-01-04.json",
        ]

    def test_retention_equal_to_file_count_keeps_everything(self, tmp_path):
        self._seed(tmp_path, ["2026-01-01", "2026-01-02"])
        builder._enforce_daily_cache_retention(tmp_path, 2)
        assert len(list(tmp_path.glob("*.json"))) == 2

    def test_non_positive_retention_is_a_no_op(self, tmp_path):
        self._seed(tmp_path, ["2026-01-01", "2026-01-02"])
        builder._enforce_daily_cache_retention(tmp_path, 0)
        builder._enforce_daily_cache_retention(tmp_path, -5)
        assert len(list(tmp_path.glob("*.json"))) == 2

    def test_unrelated_files_are_never_deleted(self, tmp_path):
        self._seed(tmp_path, ["2026-01-01", "2026-01-02"])
        (tmp_path / "keep.json").write_text("{}", encoding="utf-8")
        builder._enforce_daily_cache_retention(tmp_path, 1)
        assert (tmp_path / "keep.json").exists()
        assert (tmp_path / "2026-01-02.json").exists()
        assert not (tmp_path / "2026-01-01.json").exists()


class TestLoadMatchCacheBatch:
    def test_bare_list_payload_is_supported(self, tmp_path):
        path = tmp_path / "2026-01-01.json"
        path.write_text(
            json.dumps([{"match_id": 4, "samples": []}]),
            encoding="utf-8",
        )
        assert builder._load_match_cache_batch(path) == {4: []}

    def test_unexpected_payload_shape_is_empty(self, tmp_path):
        path = tmp_path / "2026-01-01.json"
        path.write_text(json.dumps({"matches": "nope"}), encoding="utf-8")
        assert builder._load_match_cache_batch(path) == {}


class TestSafeParseDate:
    def test_parses_iso_dates(self):
        assert builder._safe_parse_date("2026-02-03") == date(2026, 2, 3)

    @pytest.mark.parametrize("raw", ["", "not-a-date", "2026-13-01", "03.02.2026"])
    def test_invalid_dates_return_none(self, raw):
        assert builder._safe_parse_date(raw) is None


class TestLoadMatchIdsFromFile:
    def test_plain_id_list(self, tmp_path):
        path = tmp_path / "ids.json"
        path.write_text(json.dumps([1, "2", 3]), encoding="utf-8")
        assert builder.load_match_ids_from_file(path, 0) == [1, 2, 3]

    def test_rows_with_match_id_key(self, tmp_path):
        path = tmp_path / "ids.json"
        path.write_text(
            json.dumps([{"match_id": 10}, {"match_id": 11}]), encoding="utf-8"
        )
        assert builder.load_match_ids_from_file(path, 0) == [10, 11]

    def test_limit_truncates(self, tmp_path):
        path = tmp_path / "ids.json"
        path.write_text(json.dumps([1, 2, 3, 4]), encoding="utf-8")
        assert builder.load_match_ids_from_file(path, 2) == [1, 2]

    def test_unparsable_rows_are_skipped(self, tmp_path):
        path = tmp_path / "ids.json"
        path.write_text(
            json.dumps([1, "abc", None, {"match_id": "nope"}, {"other": 5}, 6]),
            encoding="utf-8",
        )
        assert builder.load_match_ids_from_file(path, 0) == [1, 6]

    def test_non_list_payload_yields_nothing(self, tmp_path):
        path = tmp_path / "ids.json"
        path.write_text(json.dumps({"match_id": 1}), encoding="utf-8")
        assert builder.load_match_ids_from_file(path, 0) == []


class TestWriteJson:
    def test_creates_parents_and_appends_newline(self, tmp_path):
        path = tmp_path / "nested" / "runtime.json"
        builder.write_json(path, {"spots": [], "note": "варды"})
        raw = path.read_text(encoding="utf-8")
        assert raw.endswith("\n")
        assert "варды" in raw
        assert read_json(path)["spots"] == []
