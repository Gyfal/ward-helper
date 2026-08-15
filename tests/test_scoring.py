from __future__ import annotations

import math

import build_ward_reco_runtime as builder
import pytest


def quality_score(**overrides) -> float:
    kwargs = {
        "placements": 10,
        "matches_seen": 5,
        "total_matches": 100,
        "quick_deward_rate": 0.0,
        "success_rate": 1.0,
        "spread_score": 1.0,
    }
    kwargs.update(overrides)
    return builder.compute_quality_score(**kwargs)


class TestComputePercentile:
    def test_empty_values(self):
        assert builder.compute_percentile([], 0.5) == 0.0

    def test_single_value_is_returned_for_any_percentile(self):
        assert builder.compute_percentile([7.5], 0.0) == 7.5
        assert builder.compute_percentile([7.5], 0.9) == 7.5

    def test_median_interpolates_between_neighbours(self):
        assert builder.compute_percentile([0.0, 10.0], 0.5) == pytest.approx(5.0)

    def test_exact_rank_needs_no_interpolation(self):
        assert builder.compute_percentile([1.0, 2.0, 3.0], 0.5) == pytest.approx(2.0)

    def test_input_order_does_not_matter(self):
        assert builder.compute_percentile([3.0, 1.0, 2.0], 0.5) == pytest.approx(2.0)

    def test_extremes_return_min_and_max(self):
        values = [4.0, 1.0, 9.0]
        assert builder.compute_percentile(values, 0.0) == pytest.approx(1.0)
        assert builder.compute_percentile(values, 1.0) == pytest.approx(9.0)

    def test_p90_of_ten_values(self):
        values = [float(index) for index in range(10)]
        assert builder.compute_percentile(values, 0.9) == pytest.approx(8.1)


class TestComputeQualityScore:
    def test_zero_placements_scores_zero(self):
        assert quality_score(placements=0, matches_seen=0) == 0.0

    def test_more_placements_scores_higher(self):
        assert quality_score(placements=20, matches_seen=10) > quality_score(
            placements=4, matches_seen=2
        )

    def test_quick_deward_rate_penalises_score(self):
        assert quality_score(quick_deward_rate=0.9) < quality_score(quick_deward_rate=0.0)

    def test_quick_deward_penalty_is_capped_at_85_percent(self):
        clean = quality_score(quick_deward_rate=0.0)
        fully_dewarded = quality_score(quick_deward_rate=1.0)
        assert fully_dewarded == pytest.approx(clean * 0.15)

    def test_success_rate_is_clamped_into_zero_one(self):
        assert quality_score(success_rate=5.0) == pytest.approx(
            quality_score(success_rate=1.0)
        )
        assert quality_score(success_rate=-5.0) == pytest.approx(
            quality_score(success_rate=0.0)
        )

    def test_spread_score_is_clamped_into_zero_one(self):
        assert quality_score(spread_score=3.0) == pytest.approx(
            quality_score(spread_score=1.0)
        )
        assert quality_score(spread_score=-1.0) == pytest.approx(
            quality_score(spread_score=0.0)
        )

    def test_higher_coverage_scores_higher(self):
        assert quality_score(matches_seen=50, total_matches=100) > quality_score(
            matches_seen=5, total_matches=100
        )

    def test_zero_total_matches_does_not_divide_by_zero(self):
        assert quality_score(total_matches=0) > 0.0

    def test_pick_rate_saturates_at_three_placements_per_match(self):
        # Coverage is held constant so only the pick rate (3.0 vs 6.0) differs.
        assert quality_score(placements=30, matches_seen=10, total_matches=100) == (
            pytest.approx(quality_score(placements=30, matches_seen=5, total_matches=50))
        )

    def test_matches_formula(self):
        score = quality_score(
            placements=10,
            matches_seen=5,
            total_matches=100,
            quick_deward_rate=0.5,
            success_rate=0.5,
            spread_score=0.5,
        )
        expected = (
            math.log1p(10)
            * (0.25 + 0.75 * 0.05)
            * (0.45 + 0.55 * min(1.0, (10 / 5) / 3.0))
            * (0.6 + 0.4 * 0.5)
            * (0.35 + 0.65 * 0.5)
            * (1.0 - 0.5 * 0.85)
        )
        assert score == pytest.approx(expected)


class TestBuildSpotPayload:
    def test_payload_shape_and_identity(self, spot_factory):
        spot = spot_factory(
            lifetimes=[100.0, 400.0],
            world_positions=[(1000.0, -2000.0), (1000.0, -2000.0)],
        )
        payload = builder.build_spot_payload(
            spot, total_matches=10, observer_max_quick_deward_rate=0.5
        )
        assert payload["spot_id"] == "Observer:radiant:0_12:1000:-2000"
        assert payload["type"] == "Observer"
        assert payload["team"] == "radiant"
        assert payload["time_bucket"] == "0_12"
        assert payload["world_avg"] == {"x": 1000.0, "y": -2000.0}
        assert payload["cell"] == {"x": 100, "y": 100}
        assert set(payload["stats"]) == {
            "matches_seen",
            "placements",
            "match_coverage",
            "quick_deward_rate",
            "success_rate",
            "score",
            "radius_p50",
            "radius_p90",
        }

    def test_observer_rates_use_only_samples_with_lifetime(self, spot_factory):
        spot = spot_factory(lifetimes=[100.0, 400.0, None])
        payload = builder.build_spot_payload(
            spot, total_matches=10, observer_max_quick_deward_rate=0.9
        )
        assert payload["stats"]["placements"] == 3
        assert payload["stats"]["quick_deward_rate"] == pytest.approx(0.5)
        assert payload["stats"]["success_rate"] == pytest.approx(0.5)

    def test_observer_without_lifetime_data_gets_zero_rates(self, spot_factory):
        spot = spot_factory(lifetimes=[None, None])
        payload = builder.build_spot_payload(
            spot, total_matches=10, observer_max_quick_deward_rate=0.5
        )
        assert payload["stats"]["quick_deward_rate"] == 0.0
        assert payload["stats"]["success_rate"] == 0.0
        assert payload["flags"]["observer_risky_quick_deward"] is False

    def test_sentry_never_reports_quick_deward_rate(self, spot_factory):
        spot = spot_factory(ward_type="Sentry", lifetimes=[10.0, 20.0])
        payload = builder.build_spot_payload(
            spot, total_matches=10, observer_max_quick_deward_rate=0.1
        )
        assert payload["stats"]["quick_deward_rate"] == 0.0
        assert payload["flags"]["observer_risky_quick_deward"] is False

    def test_sentry_without_lifetime_data_assumes_full_success(self, spot_factory):
        spot = spot_factory(ward_type="Sentry", lifetimes=[None])
        payload = builder.build_spot_payload(
            spot, total_matches=10, observer_max_quick_deward_rate=0.5
        )
        assert payload["stats"]["success_rate"] == 1.0

    def test_risky_flag_trips_at_the_threshold(self, spot_factory):
        spot = spot_factory(lifetimes=[10.0, 20.0])
        payload = builder.build_spot_payload(
            spot, total_matches=10, observer_max_quick_deward_rate=1.0
        )
        assert payload["stats"]["quick_deward_rate"] == 1.0
        assert payload["flags"]["observer_risky_quick_deward"] is True

    def test_risky_flag_stays_off_below_threshold(self, spot_factory):
        spot = spot_factory(lifetimes=[10.0, 400.0])
        payload = builder.build_spot_payload(
            spot, total_matches=10, observer_max_quick_deward_rate=0.6
        )
        assert payload["flags"]["observer_risky_quick_deward"] is False

    def test_match_coverage_is_the_share_of_matches_seen(self, spot_factory):
        spot = spot_factory(lifetimes=[None, None, None], match_ids=[1, 1, 2])
        payload = builder.build_spot_payload(
            spot, total_matches=8, observer_max_quick_deward_rate=0.5
        )
        assert payload["stats"]["matches_seen"] == 2
        assert payload["stats"]["match_coverage"] == pytest.approx(0.25)

    def test_radii_describe_sample_spread(self, spot_factory):
        spot = spot_factory(
            lifetimes=[None, None],
            world_positions=[(-100.0, 0.0), (100.0, 0.0)],
        )
        payload = builder.build_spot_payload(
            spot, total_matches=4, observer_max_quick_deward_rate=0.5
        )
        assert payload["stats"]["radius_p50"] == pytest.approx(100.0)
        assert payload["stats"]["radius_p90"] == pytest.approx(100.0)

    def test_tight_cluster_scores_above_scattered_cluster(self, spot_factory):
        tight = spot_factory(
            lifetimes=[None, None], world_positions=[(0.0, 0.0), (10.0, 0.0)]
        )
        scattered = spot_factory(
            lifetimes=[None, None], world_positions=[(-4000.0, 0.0), (4000.0, 0.0)]
        )
        tight_payload = builder.build_spot_payload(
            tight, total_matches=4, observer_max_quick_deward_rate=0.5
        )
        scattered_payload = builder.build_spot_payload(
            scattered, total_matches=4, observer_max_quick_deward_rate=0.5
        )
        assert tight_payload["stats"]["score"] > scattered_payload["stats"]["score"]


def sentry_payload(cell_x: float, cell_y: float, score: float = 1.0) -> dict:
    return {
        "spot_id": f"Sentry:radiant:0_12:{cell_x}:{cell_y}",
        "type": "Sentry",
        "team": "radiant",
        "time_bucket": "0_12",
        "cell": {"x": cell_x, "y": cell_y},
        "stats": {"score": score, "placements": 5},
    }


def observer_payload(
    cell_x: float, cell_y: float, score: float = 2.0, team: str = "dire"
) -> dict:
    return {
        "spot_id": f"Observer:{team}:0_12:{cell_x}:{cell_y}",
        "type": "Observer",
        "team": team,
        "time_bucket": "0_12",
        "cell": {"x": cell_x, "y": cell_y},
        "stats": {"score": score, "placements": 5},
    }


class TestCounterSentryBoost:
    def test_no_observers_means_no_boost(self):
        assert builder.compute_counter_sentry_boost(sentry_payload(10, 10), []) == 0.0

    def test_colocated_observer_gives_its_full_score(self):
        boost = builder.compute_counter_sentry_boost(
            sentry_payload(10, 10), [observer_payload(10, 10, score=3.0)]
        )
        assert boost == pytest.approx(3.0)

    def test_boost_decays_with_distance(self):
        near = builder.compute_counter_sentry_boost(
            sentry_payload(10, 10), [observer_payload(11, 10, score=3.0)]
        )
        far = builder.compute_counter_sentry_boost(
            sentry_payload(10, 10), [observer_payload(40, 10, score=3.0)]
        )
        assert 0.0 < far < near < 3.0
        assert near == pytest.approx(
            3.0 * math.exp(-1.0 / builder.COUNTER_SENTRY_DISTANCE_FALLOFF)
        )

    def test_strongest_signal_wins(self):
        boost = builder.compute_counter_sentry_boost(
            sentry_payload(10, 10),
            [observer_payload(10, 10, score=1.0), observer_payload(12, 10, score=5.0)],
        )
        assert boost == pytest.approx(
            5.0 * math.exp(-2.0 / builder.COUNTER_SENTRY_DISTANCE_FALLOFF)
        )

    def test_sentry_without_usable_cell_gets_no_boost(self):
        broken = sentry_payload(10, 10)
        broken["cell"] = {}
        assert builder.compute_counter_sentry_boost(broken, [observer_payload(10, 10)]) == 0.0

    def test_malformed_observers_are_skipped(self):
        missing_cell = observer_payload(10, 10)
        missing_cell["cell"] = None
        missing_score = observer_payload(10, 10)
        missing_score["stats"] = {}
        boost = builder.compute_counter_sentry_boost(
            sentry_payload(10, 10),
            [missing_cell, missing_score, observer_payload(10, 10, score=2.0)],
        )
        assert boost == pytest.approx(2.0)


class TestApplyCounterSentryScores:
    def test_sentry_score_is_boosted_by_enemy_observers(self):
        sentry = sentry_payload(10, 10, score=1.0)
        groups = {
            ("Sentry", "radiant", "0_12"): [sentry],
            ("Observer", "dire", "0_12"): [observer_payload(10, 10, score=2.0)],
        }
        builder.apply_counter_sentry_scores(groups)
        assert sentry["stats"]["score"] == pytest.approx(3.0)

    def test_friendly_observers_do_not_boost_sentries(self):
        sentry = sentry_payload(10, 10, score=1.0)
        groups = {
            ("Sentry", "radiant", "0_12"): [sentry],
            ("Observer", "radiant", "0_12"): [
                observer_payload(10, 10, score=2.0, team="radiant")
            ],
        }
        builder.apply_counter_sentry_scores(groups)
        assert sentry["stats"]["score"] == pytest.approx(1.0)

    def test_observers_from_another_bucket_do_not_boost(self):
        sentry = sentry_payload(10, 10, score=1.0)
        late_observer = observer_payload(10, 10, score=2.0)
        late_observer["time_bucket"] = "25_50"
        groups = {
            ("Sentry", "radiant", "0_12"): [sentry],
            ("Observer", "dire", "25_50"): [late_observer],
        }
        builder.apply_counter_sentry_scores(groups)
        assert sentry["stats"]["score"] == pytest.approx(1.0)

    def test_observer_scores_are_left_untouched(self):
        observer = observer_payload(10, 10, score=2.0)
        groups = {
            ("Sentry", "radiant", "0_12"): [sentry_payload(10, 10, score=1.0)],
            ("Observer", "dire", "0_12"): [observer],
        }
        builder.apply_counter_sentry_scores(groups)
        assert observer["stats"]["score"] == pytest.approx(2.0)

    def test_dire_sentries_are_boosted_by_radiant_observers(self):
        sentry = sentry_payload(10, 10, score=1.0)
        sentry["team"] = "dire"
        groups = {
            ("Sentry", "dire", "0_12"): [sentry],
            ("Observer", "radiant", "0_12"): [
                observer_payload(10, 10, score=2.0, team="radiant")
            ],
        }
        builder.apply_counter_sentry_scores(groups)
        assert sentry["stats"]["score"] == pytest.approx(3.0)

    def test_distant_observers_leave_score_effectively_unchanged(self):
        sentry = sentry_payload(0, 0, score=1.0)
        groups = {
            ("Sentry", "radiant", "0_12"): [sentry],
            ("Observer", "dire", "0_12"): [observer_payload(500, 500, score=2.0)],
        }
        builder.apply_counter_sentry_scores(groups)
        assert sentry["stats"]["score"] == pytest.approx(1.0)
