from __future__ import annotations

import build_ward_reco_runtime as builder
import pytest


class TestSpotAccumulator:
    def test_empty_spot_reports_zero_centroid(self):
        spot = builder.SpotAccumulator(
            ward_type="Observer", team="radiant", time_bucket="0_12"
        )
        assert spot.placements == 0
        assert spot.matches_seen == 0
        assert spot.centroid == (0.0, 0.0)

    def test_centroid_is_the_mean_of_world_positions(self, sample_factory):
        spot = builder.SpotAccumulator(
            ward_type="Observer", team="radiant", time_bucket="0_12"
        )
        spot.add(sample_factory(world_x=0.0, world_y=0.0), 180, 300)
        spot.add(sample_factory(match_id=2, world_x=100.0, world_y=200.0), 180, 300)
        assert spot.centroid == pytest.approx((50.0, 100.0))

    def test_matches_seen_deduplicates_match_ids(self, sample_factory):
        spot = builder.SpotAccumulator(
            ward_type="Observer", team="radiant", time_bucket="0_12"
        )
        for _ in range(3):
            spot.add(sample_factory(match_id=7), 180, 300)
        assert spot.placements == 3
        assert spot.matches_seen == 1

    def test_missing_lifetime_is_not_counted_in_rates(self, sample_factory):
        spot = builder.SpotAccumulator(
            ward_type="Observer", team="radiant", time_bucket="0_12"
        )
        spot.add(sample_factory(lifetime_sec=None), 180, 300)
        assert spot.lifetime_samples == []
        assert spot.quick_deward_count == 0
        assert spot.success_count == 0

    @pytest.mark.parametrize(
        ("lifetime", "expected_quick", "expected_success"),
        [
            (10.0, 1, 0),
            (180.0, 1, 0),
            (181.0, 0, 0),
            (299.0, 0, 0),
            (300.0, 0, 1),
            (600.0, 0, 1),
        ],
    )
    def test_lifetime_thresholds_are_inclusive(
        self, sample_factory, lifetime, expected_quick, expected_success
    ):
        spot = builder.SpotAccumulator(
            ward_type="Observer", team="radiant", time_bucket="0_12"
        )
        spot.add(sample_factory(lifetime_sec=lifetime), 180, 300)
        assert spot.quick_deward_count == expected_quick
        assert spot.success_count == expected_success


class TestSpatialGroupIndex:
    def _index(self, radius: float = 192.0) -> builder.SpatialGroupIndex:
        return builder.SpatialGroupIndex(
            ward_type="Observer",
            team="radiant",
            time_bucket="0_12",
            cluster_radius_world=radius,
            quick_deward_sec=180,
            success_lifetime_sec=300,
        )

    def test_nearby_samples_merge_into_one_spot(self, sample_factory):
        index = self._index()
        index.add(sample_factory(world_x=0.0, world_y=0.0))
        index.add(sample_factory(match_id=2, world_x=50.0, world_y=0.0))
        assert len(index.spots) == 1
        assert index.spots[0].placements == 2

    def test_far_samples_create_separate_spots(self, sample_factory):
        index = self._index()
        index.add(sample_factory(world_x=0.0, world_y=0.0))
        index.add(sample_factory(match_id=2, world_x=5000.0, world_y=5000.0))
        assert len(index.spots) == 2

    def test_sample_exactly_at_radius_still_merges(self, sample_factory):
        index = self._index(radius=192.0)
        index.add(sample_factory(world_x=0.0, world_y=0.0))
        index.add(sample_factory(match_id=2, world_x=192.0, world_y=0.0))
        assert len(index.spots) == 1

    def test_sample_just_outside_radius_does_not_merge(self, sample_factory):
        index = self._index(radius=192.0)
        index.add(sample_factory(world_x=0.0, world_y=0.0))
        index.add(sample_factory(match_id=2, world_x=192.5, world_y=0.0))
        assert len(index.spots) == 2

    def test_drifting_chain_merges_until_it_leaves_the_radius(self, sample_factory):
        """Merging is measured against the moving centroid, not the first sample,
        so a chain of small steps keeps merging and only splits once a sample is
        farther than the radius from the current centroid."""
        index = self._index(radius=100.0)
        for step in range(6):
            index.add(sample_factory(match_id=step + 1, world_x=step * 40.0, world_y=0.0))
        assert [spot.placements for spot in index.spots] == [5, 1]
        assert index.spots[0].centroid[0] == pytest.approx(80.0)
        assert index.spots[1].centroid[0] == pytest.approx(200.0)

    def test_radius_is_floored_at_one_world_unit(self):
        index = self._index(radius=0.0)
        assert index.cluster_radius_world == 1.0
        assert index.cluster_radius_sq == 1.0

    def test_group_metadata_is_copied_into_new_spots(self, sample_factory):
        index = self._index()
        index.add(sample_factory())
        spot = index.spots[0]
        assert (spot.ward_type, spot.team, spot.time_bucket) == (
            "Observer",
            "radiant",
            "0_12",
        )

    def test_negative_world_coordinates_bin_correctly(self, sample_factory):
        index = self._index(radius=192.0)
        index.add(sample_factory(world_x=-1000.0, world_y=-1000.0))
        index.add(sample_factory(match_id=2, world_x=-1010.0, world_y=-1005.0))
        assert len(index.spots) == 1
