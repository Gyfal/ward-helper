from __future__ import annotations

import build_ward_reco_runtime as builder
import pytest


@pytest.fixture
def sample_factory():
    """Builds PlacementSample objects with sane defaults for spot tests."""

    def factory(
        *,
        match_id: int = 1,
        event_time_sec: float = 600.0,
        time_bucket: str = "0_12",
        minimap_x: float = 100.0,
        minimap_y: float = 100.0,
        world_x: float | None = None,
        world_y: float | None = None,
        lifetime_sec: float | None = None,
    ) -> builder.PlacementSample:
        if world_x is None or world_y is None:
            derived_x, derived_y = builder.minimap_to_world_xy(minimap_x, minimap_y)
            world_x = derived_x if world_x is None else world_x
            world_y = derived_y if world_y is None else world_y
        return builder.PlacementSample(
            match_id=match_id,
            event_time_sec=event_time_sec,
            time_bucket=time_bucket,
            minimap_x=minimap_x,
            minimap_y=minimap_y,
            world_x=world_x,
            world_y=world_y,
            lifetime_sec=lifetime_sec,
        )

    return factory


@pytest.fixture
def spot_factory(sample_factory):
    """Builds a filled SpotAccumulator from lifetime values."""

    def factory(
        *,
        ward_type: str = "Observer",
        team: str = "radiant",
        time_bucket: str = "0_12",
        lifetimes: list[float | None] | None = None,
        match_ids: list[int] | None = None,
        world_positions: list[tuple[float, float]] | None = None,
        quick_deward_sec: int = builder.DEFAULT_QUICK_DEWARD_SEC,
        success_lifetime_sec: int = builder.DEFAULT_SUCCESS_LIFETIME_SEC,
    ) -> builder.SpotAccumulator:
        lifetimes = [None] if lifetimes is None else lifetimes
        spot = builder.SpotAccumulator(
            ward_type=ward_type, team=team, time_bucket=time_bucket
        )
        for index, lifetime in enumerate(lifetimes):
            match_id = match_ids[index] if match_ids is not None else index + 1
            if world_positions is not None:
                world_x, world_y = world_positions[index]
            else:
                world_x, world_y = 0.0, 0.0
            spot.add(
                sample_factory(
                    match_id=match_id,
                    time_bucket=time_bucket,
                    world_x=world_x,
                    world_y=world_y,
                    lifetime_sec=lifetime,
                ),
                quick_deward_sec,
                success_lifetime_sec,
            )
        return spot

    return factory
