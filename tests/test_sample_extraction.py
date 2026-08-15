from __future__ import annotations

import build_ward_reco_runtime as builder
import pytest


def placed(time: float, x: float = 100.0, y: float = 100.0, ehandle: int | None = None):
    event = {"time": time, "x": x, "y": y, "type": "obs_log"}
    if ehandle is not None:
        event["ehandle"] = ehandle
    return event


class TestBuildLeftTimeLookup:
    def test_missing_log_returns_empty_lookups(self):
        by_ehandle, by_coords = builder.build_left_time_lookup({}, "obs_left_log")
        assert by_ehandle == {}
        assert by_coords == {}

    def test_non_list_log_returns_empty_lookups(self):
        by_ehandle, by_coords = builder.build_left_time_lookup(
            {"obs_left_log": "nope"}, "obs_left_log"
        )
        assert by_ehandle == {}
        assert by_coords == {}

    def test_events_are_indexed_by_ehandle_and_coords(self):
        player = {
            "obs_left_log": [
                {"time": 300.0, "x": 100, "y": 120, "ehandle": 7},
                {"time": 120.0, "x": 100, "y": 120, "ehandle": 7},
            ]
        }
        by_ehandle, by_coords = builder.build_left_time_lookup(player, "obs_left_log")
        assert by_ehandle[7] == [120.0, 300.0]
        assert by_coords[(100, 120)] == [120.0, 300.0]

    def test_coordinates_are_rounded_to_int_keys(self):
        player = {"obs_left_log": [{"time": 10.0, "x": 100.4, "y": 119.6}]}
        _, by_coords = builder.build_left_time_lookup(player, "obs_left_log")
        assert by_coords[(100, 120)] == [10.0]

    def test_malformed_events_are_skipped(self):
        player = {
            "obs_left_log": [
                "not-a-dict",
                {"time": None, "x": 1, "y": 1},
                {"time": "abc", "x": 1, "y": 1},
                {"time": 10.0, "x": "abc", "y": "abc"},
                {"time": 20.0, "x": 5, "y": 5, "ehandle": "abc"},
            ]
        }
        by_ehandle, by_coords = builder.build_left_time_lookup(player, "obs_left_log")
        assert by_ehandle == {}
        assert by_coords == {(5, 5): [20.0]}


class TestConsumeMatchingLeftTime:
    def test_ehandle_match_wins_and_is_consumed(self):
        by_ehandle = {7: [400.0]}
        by_coords = {(100, 100): [400.0]}
        lifetime = builder.consume_matching_left_time(
            placed(100.0, ehandle=7), 100.0, "Observer", by_ehandle, by_coords
        )
        assert lifetime == pytest.approx(300.0)
        assert by_ehandle[7] == []
        assert by_coords[(100, 100)] == [400.0]

    def test_falls_back_to_coordinate_match(self):
        by_coords = {(100, 100): [250.0]}
        lifetime = builder.consume_matching_left_time(
            placed(100.0), 100.0, "Observer", {}, by_coords
        )
        assert lifetime == pytest.approx(150.0)
        assert by_coords[(100, 100)] == []

    def test_each_left_event_is_consumed_only_once(self):
        by_coords = {(100, 100): [200.0, 500.0]}
        first = builder.consume_matching_left_time(
            placed(100.0), 100.0, "Observer", {}, by_coords
        )
        second = builder.consume_matching_left_time(
            placed(200.0), 200.0, "Observer", {}, by_coords
        )
        assert first == pytest.approx(100.0)
        assert second == pytest.approx(300.0)
        assert by_coords[(100, 100)] == []

    def test_lifetime_beyond_observer_cap_is_rejected(self):
        cap = builder.MAX_WARD_LIFETIME_BY_TYPE["Observer"]
        by_coords = {(100, 100): [100.0 + cap + 1.0]}
        assert (
            builder.consume_matching_left_time(
                placed(100.0), 100.0, "Observer", {}, by_coords
            )
            is None
        )
        assert by_coords[(100, 100)] == [100.0 + cap + 1.0]

    def test_sentry_cap_is_longer_than_observer_cap(self):
        observer_cap = builder.MAX_WARD_LIFETIME_BY_TYPE["Observer"]
        left_time = 100.0 + observer_cap + 10.0
        assert (
            builder.consume_matching_left_time(
                placed(100.0), 100.0, "Sentry", {}, {(100, 100): [left_time]}
            )
            is not None
        )

    def test_left_event_before_placement_is_ignored(self):
        by_coords = {(100, 100): [50.0]}
        assert (
            builder.consume_matching_left_time(
                placed(100.0), 100.0, "Observer", {}, by_coords
            )
            is None
        )

    def test_unknown_ehandle_falls_through_to_coords(self):
        by_coords = {(100, 100): [200.0]}
        lifetime = builder.consume_matching_left_time(
            placed(100.0, ehandle=999), 100.0, "Observer", {7: [150.0]}, by_coords
        )
        assert lifetime == pytest.approx(100.0)

    def test_stale_ehandle_candidate_falls_through_to_coords(self):
        cap = builder.MAX_WARD_LIFETIME_BY_TYPE["Observer"]
        by_ehandle = {7: [100.0 + cap + 50.0]}
        by_coords = {(100, 100): [300.0]}
        lifetime = builder.consume_matching_left_time(
            placed(100.0, ehandle=7), 100.0, "Observer", by_ehandle, by_coords
        )
        assert lifetime == pytest.approx(200.0)

    def test_event_without_usable_coordinates_returns_none(self):
        event = {"time": 100.0, "x": None, "y": None}
        assert (
            builder.consume_matching_left_time(
                event, 100.0, "Observer", {}, {(100, 100): [200.0]}
            )
            is None
        )

    def test_no_left_events_for_coords_returns_none(self):
        assert (
            builder.consume_matching_left_time(placed(100.0), 100.0, "Observer", {}, {})
            is None
        )

    def test_unknown_ward_type_uses_default_cap(self):
        assert builder.consume_matching_left_time(
            placed(0.0), 0.0, "Mystery", {}, {(100, 100): [599.0]}
        ) == pytest.approx(599.0)
        assert (
            builder.consume_matching_left_time(
                placed(0.0), 0.0, "Mystery", {}, {(100, 100): [601.0]}
            )
            is None
        )


class TestIterPlayerPlaceSamples:
    def test_player_without_logs_yields_nothing(self):
        assert builder.iter_player_place_samples(1, {"player_slot": 0}) == []

    def test_observer_and_sentry_events_are_typed_and_teamed(self):
        player = {
            "player_slot": 128,
            "obs_log": [{"time": 100.0, "x": 100, "y": 100}],
            "sen_log": [{"time": 800.0, "x": 90, "y": 90}],
        }
        records = builder.iter_player_place_samples(42, player)
        assert [(ward_type, team, bucket) for ward_type, team, bucket, _ in records] == [
            ("Observer", "dire", "0_12"),
            ("Sentry", "dire", "12_25"),
        ]
        assert all(sample.match_id == 42 for _, _, _, sample in records)

    def test_samples_are_ordered_by_event_time(self):
        player = {
            "player_slot": 0,
            "obs_log": [
                {"time": 900.0, "x": 100, "y": 100},
                {"time": 100.0, "x": 100, "y": 100},
            ],
        }
        records = builder.iter_player_place_samples(1, player)
        assert [sample.event_time_sec for _, _, _, sample in records] == [100.0, 900.0]

    def test_world_coordinates_are_derived_from_minimap_cells(self):
        player = {"player_slot": 0, "obs_log": [{"time": 10.0, "x": 128, "y": 129}]}
        _, _, _, sample = builder.iter_player_place_samples(1, player)[0]
        assert (sample.world_x, sample.world_y) == (0.0, 128.0)
        assert (sample.minimap_x, sample.minimap_y) == (128.0, 129.0)

    def test_lifetime_is_matched_from_the_matching_left_log(self):
        player = {
            "player_slot": 0,
            "obs_log": [{"time": 100.0, "x": 100, "y": 100, "ehandle": 1}],
            "sen_log": [{"time": 100.0, "x": 100, "y": 100, "ehandle": 2}],
            "obs_left_log": [{"time": 300.0, "x": 100, "y": 100, "ehandle": 1}],
            "sen_left_log": [{"time": 500.0, "x": 100, "y": 100, "ehandle": 2}],
        }
        lifetimes = {
            ward_type: sample.lifetime_sec
            for ward_type, _, _, sample in builder.iter_player_place_samples(1, player)
        }
        assert lifetimes == {"Observer": 200.0, "Sentry": 400.0}

    def test_unmatched_placement_has_no_lifetime(self):
        player = {"player_slot": 0, "obs_log": [{"time": 100.0, "x": 100, "y": 100}]}
        _, _, _, sample = builder.iter_player_place_samples(1, player)[0]
        assert sample.lifetime_sec is None

    def test_incomplete_and_malformed_events_are_skipped(self):
        player = {
            "player_slot": 0,
            "obs_log": [
                "not-a-dict",
                {"time": 10.0, "x": None, "y": 100},
                {"time": 10.0, "x": 100, "y": None},
                {"x": 100, "y": 100},
                {"time": "abc", "x": 100, "y": 100},
                {"time": 10.0, "x": 100, "y": 100},
            ],
        }
        records = builder.iter_player_place_samples(1, player)
        assert len(records) == 1

    def test_negative_event_time_is_dropped(self):
        player = {
            "player_slot": 0,
            "obs_log": [
                {"time": -30.0, "x": 100, "y": 100},
                {"time": 30.0, "x": 100, "y": 100},
            ],
        }
        records = builder.iter_player_place_samples(1, player)
        assert [sample.event_time_sec for _, _, _, sample in records] == [30.0]

    def test_non_list_logs_are_ignored(self):
        player = {"player_slot": 0, "obs_log": {"time": 10.0}, "sen_log": None}
        assert builder.iter_player_place_samples(1, player) == []


class TestExtractMatchSamples:
    def test_missing_players_returns_none(self):
        assert builder.extract_match_samples(1, {}) is None
        assert builder.extract_match_samples(1, {"players": []}) is None
        assert builder.extract_match_samples(1, {"players": "nope"}) is None

    def test_parsed_match_without_wards_returns_empty_list(self):
        payload = {"players": [{"player_slot": 0}, {"player_slot": 128}]}
        assert builder.extract_match_samples(1, payload) == []

    def test_samples_from_all_players_are_merged(self):
        payload = {
            "players": [
                {"player_slot": 0, "obs_log": [{"time": 10.0, "x": 100, "y": 100}]},
                "not-a-dict",
                {"player_slot": 128, "sen_log": [{"time": 20.0, "x": 90, "y": 90}]},
            ]
        }
        records = builder.extract_match_samples(99, payload)
        assert [(ward_type, team) for ward_type, team, _, _ in records] == [
            ("Observer", "radiant"),
            ("Sentry", "dire"),
        ]
        assert all(sample.match_id == 99 for _, _, _, sample in records)
