from __future__ import annotations

import build_ward_reco_runtime as builder
import pytest


class TestClassifyTimeBucket:
    @pytest.mark.parametrize(
        ("event_time", "expected"),
        [
            (0.0, "0_12"),
            (719.0, "0_12"),
            (720.0, "12_25"),
            (1499.0, "12_25"),
            (1500.0, "25_50"),
            (2999.0, "25_50"),
            (3000.0, "50_plus"),
            (99999.0, "50_plus"),
        ],
    )
    def test_boundaries_are_inclusive_lower_exclusive_upper(self, event_time, expected):
        assert builder.classify_time_bucket(event_time) == expected

    def test_negative_time_has_no_bucket(self):
        assert builder.classify_time_bucket(-0.5) is None

    def test_every_bucket_id_is_reachable(self):
        produced = {
            builder.classify_time_bucket(bucket.min_sec) for bucket in builder.TIME_BUCKETS
        }
        assert produced == set(builder.VALID_TIME_BUCKET_IDS)

    def test_buckets_are_contiguous_and_open_ended(self):
        for previous, current in zip(builder.TIME_BUCKETS, builder.TIME_BUCKETS[1:]):
            assert previous.max_sec == current.min_sec
        assert builder.TIME_BUCKETS[-1].max_sec is None


class TestBucketMidpoint:
    @pytest.mark.parametrize(
        ("bucket_id", "expected"),
        [
            ("0_12", 360.0),
            ("12_25", 1110.0),
            ("25_50", 2250.0),
            ("50_plus", 3300.0),
        ],
    )
    def test_known_buckets(self, bucket_id, expected):
        assert builder._bucket_midpoint_sec(bucket_id) == pytest.approx(expected)

    def test_midpoint_lands_inside_its_own_bucket(self):
        for bucket in builder.TIME_BUCKETS:
            midpoint = builder._bucket_midpoint_sec(bucket.id)
            assert builder.classify_time_bucket(midpoint) == bucket.id

    @pytest.mark.parametrize(
        ("bucket_id", "expected"),
        [
            ("", 0.0),
            ("garbage", 0.0),
            ("12", 1020.0),
            ("12_garbage", 720.0),
        ],
    )
    def test_malformed_ids_fall_back_instead_of_raising(self, bucket_id, expected):
        assert builder._bucket_midpoint_sec(bucket_id) == pytest.approx(expected)


class TestMinimapToWorld:
    def test_origin_cell_maps_to_negative_corner(self):
        assert builder.minimap_to_world_xy(0, 0) == (-16384.0, -16384.0)

    def test_center_cell_maps_to_world_origin(self):
        assert builder.minimap_to_world_xy(128, 128) == (0.0, 0.0)

    def test_accepts_numeric_strings(self):
        assert builder.minimap_to_world_xy("128", "129") == (0.0, 128.0)

    def test_is_linear_in_cell_size(self):
        first_x, _ = builder.minimap_to_world_xy(10, 0)
        second_x, _ = builder.minimap_to_world_xy(11, 0)
        assert second_x - first_x == pytest.approx(builder.WORLD_CELL_SIZE)


class TestTeamFromPlayerSlot:
    @pytest.mark.parametrize("player_slot", [0, 1, 4, 127])
    def test_low_slots_are_radiant(self, player_slot):
        assert builder.team_from_player_slot(player_slot) == "radiant"

    @pytest.mark.parametrize("player_slot", [128, 129, 132, 1000])
    def test_high_slots_are_dire(self, player_slot):
        assert builder.team_from_player_slot(player_slot) == "dire"

    @pytest.mark.parametrize("player_slot", [None, "abc", [], {}])
    def test_unparsable_slots_default_to_radiant(self, player_slot):
        assert builder.team_from_player_slot(player_slot) == "radiant"

    def test_numeric_string_is_parsed(self):
        assert builder.team_from_player_slot("128") == "dire"


class TestRoundMetric:
    def test_default_digits(self):
        assert builder.round_metric(1.23456789) == 1.2346

    def test_custom_digits(self):
        assert builder.round_metric(1.23456789, 2) == 1.23

    def test_accepts_numeric_string(self):
        assert builder.round_metric("2.5") == 2.5


class TestBuildApiParams:
    def test_empty_without_api_key(self, monkeypatch):
        monkeypatch.delenv("OPENDOTA_API_KEY", raising=False)
        assert builder.build_api_params() == {}

    def test_injects_api_key(self, monkeypatch):
        monkeypatch.setenv("OPENDOTA_API_KEY", "secret-token")
        assert builder.build_api_params({"sql": "SELECT 1"}) == {
            "api_key": "secret-token",
            "sql": "SELECT 1",
        }

    def test_extra_params_win_over_api_key_slot(self, monkeypatch):
        monkeypatch.setenv("OPENDOTA_API_KEY", "secret-token")
        assert builder.build_api_params({"api_key": "override"})["api_key"] == "override"


class TestRetryDelay:
    def test_backoff_grows_with_attempt(self):
        assert builder._retry_delay(1) == pytest.approx(
            builder.DEFAULT_RETRY_BASE_DELAY_SEC
        )
        assert builder._retry_delay(2) == pytest.approx(
            builder.DEFAULT_RETRY_BASE_DELAY_SEC * 2
        )

    def test_backoff_is_capped(self):
        assert builder._retry_delay(1000) == pytest.approx(
            builder.DEFAULT_RETRY_MAX_DELAY_SEC
        )

    def test_numeric_retry_after_header_wins(self):
        assert builder._retry_delay(1, "42") == pytest.approx(42.0)

    def test_retry_after_is_floored_at_one_second(self):
        assert builder._retry_delay(1, "0") == pytest.approx(1.0)

    def test_http_date_retry_after_falls_back_to_backoff(self):
        assert builder._retry_delay(2, "Wed, 21 Oct 2015 07:28:00 GMT") == pytest.approx(
            builder.DEFAULT_RETRY_BASE_DELAY_SEC * 2
        )
