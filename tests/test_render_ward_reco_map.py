from __future__ import annotations

import build_ward_reco_runtime as builder
import pytest
import render_ward_reco_map as renderer


def spot(cell_x: float, cell_y: float, score: float, **overrides) -> dict:
    payload = {
        "spot_id": f"Observer:radiant:0_12:{cell_x}:{cell_y}",
        "type": "Observer",
        "team": "radiant",
        "time_bucket": "0_12",
        "cell": {"x": cell_x, "y": cell_y},
        "world_avg": {"x": 0.0, "y": 0.0},
        "stats": {"score": score, "placements": 5},
    }
    payload.update(overrides)
    return payload


class TestWorldToPx:
    def test_grid_constants_match_the_builder(self):
        assert renderer.WORLD_CELL_SIZE == builder.WORLD_CELL_SIZE
        assert renderer.WORLD_ORIGIN_OFFSET == builder.WORLD_ORIGIN_OFFSET

    def test_bucket_order_matches_the_builder_buckets(self):
        assert renderer.BUCKET_ORDER == [bucket.id for bucket in builder.TIME_BUCKETS]
        assert set(renderer.BUCKET_LABEL) == set(renderer.BUCKET_ORDER)

    def test_grid_offset_corner_maps_to_the_panel_corner(self):
        world_x, world_y = builder.minimap_to_world_xy(
            renderer.GRID_OFFSET, renderer.GRID_OFFSET
        )
        px, py = renderer.world_to_px(world_x, world_y, 100, 100)
        assert px == pytest.approx(0.0)
        assert py == pytest.approx(100.0)

    def test_y_axis_is_flipped_for_image_space(self):
        world_x, world_y = builder.minimap_to_world_xy(
            renderer.GRID_OFFSET, renderer.GRID_OFFSET + renderer.GRID_SIZE
        )
        _px, py = renderer.world_to_px(world_x, world_y, 100, 100)
        assert py == pytest.approx(0.0)

    def test_scales_with_panel_size(self):
        world_x, world_y = builder.minimap_to_world_xy(
            renderer.GRID_OFFSET + renderer.GRID_SIZE / 2, renderer.GRID_OFFSET
        )
        small = renderer.world_to_px(world_x, world_y, 100, 100)
        large = renderer.world_to_px(world_x, world_y, 200, 200)
        assert large[0] == pytest.approx(small[0] * 2)


class TestCellDistance:
    def test_zero_for_the_same_cell(self):
        assert renderer.cell_distance(spot(5, 5, 1.0), spot(5, 5, 1.0)) == 0.0

    def test_euclidean_distance(self):
        assert renderer.cell_distance(spot(0, 0, 1.0), spot(3, 4, 1.0)) == pytest.approx(5.0)

    def test_is_symmetric(self):
        first, second = spot(1, 2, 1.0), spot(4, 6, 1.0)
        assert renderer.cell_distance(first, second) == renderer.cell_distance(second, first)


class TestSelectTop:
    def test_empty_input(self):
        assert renderer.select_top([], 5, 3.0) == []

    def test_highest_score_is_kept_first(self):
        selected = renderer.select_top(
            [spot(0, 0, 1.0), spot(20, 20, 5.0)], top_n=2, min_cell_dist=3.0
        )
        assert [item["stats"]["score"] for item in selected] == [5.0, 1.0]

    def test_close_lower_scored_spots_are_decluttered(self):
        selected = renderer.select_top(
            [spot(0, 0, 5.0), spot(1, 0, 4.0), spot(10, 0, 3.0)],
            top_n=5,
            min_cell_dist=3.0,
        )
        assert [item["cell"]["x"] for item in selected] == [0, 10]

    def test_spot_exactly_at_min_distance_is_kept(self):
        selected = renderer.select_top(
            [spot(0, 0, 5.0), spot(3, 0, 4.0)], top_n=5, min_cell_dist=3.0
        )
        assert len(selected) == 2

    def test_top_n_caps_the_result(self):
        spots = [spot(index * 10, 0, float(index)) for index in range(1, 6)]
        assert len(renderer.select_top(spots, top_n=2, min_cell_dist=3.0)) == 2

    def test_zero_min_distance_keeps_colocated_spots(self):
        selected = renderer.select_top(
            [spot(0, 0, 5.0), spot(0, 0, 4.0)], top_n=5, min_cell_dist=0.0
        )
        assert len(selected) == 2


class TestGroupKey:
    def test_key_is_team_type_bucket(self):
        assert renderer.group_key(spot(0, 0, 1.0)) == ("radiant", "Observer", "0_12")

    def test_columns_cover_every_team_and_ward_type_pair(self):
        assert {(team, ward_type) for team, ward_type, _, _ in renderer.COLUMNS} == {
            ("radiant", "Observer"),
            ("radiant", "Sentry"),
            ("dire", "Observer"),
            ("dire", "Sentry"),
        }


class TestBuildContactSheet:
    def test_sheet_covers_every_column_and_bucket_row(self):
        from PIL import Image

        base_map = Image.new("RGBA", (64, 64), (10, 10, 10, 255))
        dataset = {
            "summary": {"total_placements": 3},
            "spots": [
                spot(10, 10, 5.0),
                spot(40, 40, 1.0),
                spot(20, 20, 2.0, type="Sentry", team="dire", time_bucket="25_50"),
            ],
        }
        panel_size = 40
        sheet = renderer.build_contact_sheet(
            dataset, base_map, top_n=3, min_cell_dist=3.0, panel_size=panel_size
        )
        assert sheet.mode == "RGB"
        assert sheet.size[0] > panel_size * len(renderer.COLUMNS)
        assert sheet.size[1] > panel_size * len(renderer.BUCKET_ORDER)

    def test_font_loading_returns_a_usable_font(self):
        font = renderer.load_font(12)
        assert font.getlength("ward") > 0


class TestPrintSummary:
    def test_summary_reports_totals_and_every_group(self, capsys):
        dataset = {
            "spots": [
                spot(10, 10, 5.0),
                spot(40, 40, 1.0),
                spot(20, 20, 2.0, type="Sentry", team="dire"),
            ]
        }
        renderer.print_summary(dataset, top_n=5, min_cell_dist=3.0)
        output = capsys.readouterr().out
        assert "total spots: 3" in output
        assert output.count("spots, selected") == len(renderer.COLUMNS) * len(
            renderer.BUCKET_ORDER
        )
        assert "radiant Observer 0_12   :   2 spots, selected 2" in output

    def test_empty_groups_are_rendered_without_a_top_spot(self, capsys):
        renderer.print_summary({"spots": []}, top_n=5, min_cell_dist=3.0)
        output = capsys.readouterr().out
        assert "total spots: 0" in output
        assert "—" in output
