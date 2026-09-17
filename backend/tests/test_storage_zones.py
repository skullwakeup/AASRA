"""
Geometry tests for probable storage zones and probable drop zones.

Plain asserts, no test framework required:
    cd backend
    python -m tests.test_storage_zones

(Also collectable by pytest if it is installed.)

Scenes are synthetic masks with known geometry, so every expectation is
checked against an exact brute-force answer rather than a stored number.
"""

from __future__ import annotations

import base64
import copy
import json
import math
import os
import sys
import time
from contextlib import contextmanager

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import config  # noqa: E402
from app.pipeline import run_analysis  # noqa: E402
from app.services import candidate_mask, region_analysis, scoring  # noqa: E402
from app.services import storage_zones as sz  # noqa: E402
from app.services import visualization  # noqa: E402


@contextmanager
def override(**values):
    old = {key: getattr(config, key) for key in values}
    for key, value in values.items():
        setattr(config, key, value)
    try:
        yield
    finally:
        for key, value in old.items():
            setattr(config, key, value)


def analyse(water: np.ndarray, max_zones: int = 3):
    """Run the real candidate/region/scoring stages, then the storage stage."""
    masks = candidate_mask.build_candidate_mask(water)
    regions = region_analysis.analyse_candidate_regions(masks.candidate_mask, water)
    zones = scoring.rank_zones(regions, image_area=water.size, max_zones=max_zones)
    result = sz.analyse_storage_zones(
        zones,
        masks.candidate_mask,
        water,
        masks.water_buffer_mask,
        region_analysis.water_distance_map(water),
    )
    return masks, zones, result


def disk_pixels(cx: int, cy: int, r: int, shape):
    yy, xx = np.ogrid[: shape[0], : shape[1]]
    return (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r


def assert_storage_valid(masks, water, result) -> None:
    """Invariants every storage zone and drop zone must satisfy."""
    _, labels = cv2.connectedComponents(masks.candidate_mask, connectivity=8)
    prohibited = masks.water_buffer_mask > 0
    step = max(config.MIN_DROP_POINT_DISTANCE_PX, 2 * config.DROP_POINT_MIN_CLEARANCE_PX)
    h, w = water.shape
    for s in result.storage_zones:
        cx, cy, r = s.center_x, s.center_y, s.radius_px
        assert config.MIN_STORAGE_RADIUS_PX <= r <= config.MAX_STORAGE_RADIUS_PX, r
        assert r - 1 <= s.limiting_distance_px, (r, s.limiting_distance_px)
        assert cx - r >= 0 and cy - r >= 0 and cx + r < w and cy + r < h, "circle leaves image"
        disk = disk_pixels(cx, cy, r, water.shape)
        assert not np.any(disk & prohibited), "circle overlaps water/buffer"
        assert not np.any(disk & (water > 0)), "circle overlaps water"
        component = labels == labels[cy, cx]
        assert np.all(component[disk]), "circle leaves its candidate region"

        points = [(cx, cy)]
        assert len(s.drop_zones) <= config.MAX_DROP_POINTS_PER_STORAGE_ZONE
        for d in s.drop_zones:
            assert math.hypot(d.x - cx, d.y - cy) <= r, "drop point outside storage zone"
            assert not prohibited[d.y, d.x] and not water[d.y, d.x]
            assert component[d.y, d.x]
            zone_disk = disk_pixels(d.x, d.y, d.radius_px - 1, water.shape)
            assert np.all(component[zone_disk]) and not np.any(zone_disk & prohibited), (
                "drop zone disk not on valid land"
            )
            assert d.clearance_px >= config.DROP_POINT_MIN_CLEARANCE_PX
            for px, py in points:
                assert math.hypot(d.x - px, d.y - py) >= step - 1e-9, "drop points too close"
            points.append((d.x, d.y))
            for value in (d.score, d.clearance_px, d.water_clearance_px, d.distance_from_center_px):
                assert math.isfinite(value) and value >= 0
        assert len(set(points)) == len(points), "duplicate drop points"
        scores = [d.score for d in s.drop_zones]
        assert scores == sorted(scores, reverse=True)


def brute_force_limit(valid: np.ndarray, cx: int, cy: int) -> float:
    ys, xs = np.nonzero(valid == 0)
    h, w = valid.shape
    border = min(cx, cy, w - 1 - cx, h - 1 - cy) + 1
    if xs.size == 0:
        return float(border)
    return min(float(border), float(np.sqrt(((xs - cx) ** 2 + (ys - cy) ** 2).min())))


# --------------------------------------------------------------------- tests


def test_a_no_water_expands_to_image_boundary():
    water = np.zeros((300, 300), np.uint8)
    with override(MAX_STORAGE_RADIUS_PX=1000):
        masks, zones, result = analyse(water)
        assert len(result.storage_zones) == 1
        s = result.storage_zones[0]
        assert s.limiting_factor == "image_boundary", s.limiting_factor
        border = min(s.center_x, s.center_y, 299 - s.center_x, 299 - s.center_y) + 1
        assert s.radius_px == border - 1 - config.STORAGE_RADIUS_MARGIN_PX
        assert math.isfinite(s.water_clearance_px)
        assert_storage_valid(masks, water, result)
    # With the default cap the circle stops at MAX_STORAGE_RADIUS_PX instead
    # of spanning the frame.
    water = np.zeros((800, 800), np.uint8)
    masks, zones, result = analyse(water)
    s = result.storage_zones[0]
    assert s.radius_px == config.MAX_STORAGE_RADIUS_PX and s.limiting_factor == "max_radius"
    assert s.limiting_point is None
    assert_storage_valid(masks, water, result)


def test_b_water_close_to_centre_gives_small_radius():
    # Direct: an invalid pixel 3 px from the centre.
    valid = np.ones((100, 100), np.uint8)
    valid[50, 53] = 0
    radius, factor, distance, point = sz.compute_storage_radius(
        valid, np.zeros_like(valid, bool), 50, 50
    )
    assert radius == 0 and point == (53, 50) and distance == 3.0, (radius, point, distance)
    # Centre on an invalid pixel.
    valid[50, 50] = 0
    assert sz.compute_storage_radius(valid, np.zeros_like(valid, bool), 50, 50)[1] == "center_invalid"

    # Pipeline: a small island. Its storage zone is small or not viable.
    water = np.full((300, 300), 255, np.uint8)
    cv2.circle(water, (150, 150), 45, 0, cv2.FILLED)
    masks, zones, result = analyse(water)
    assert len(zones) == 1
    assert_storage_valid(masks, water, result)
    for s in result.storage_zones:
        assert s.radius_px < 45 - config.WATER_BUFFER_SIZE
        assert s.limiting_factor in {"water_buffer", "candidate_boundary"}


def test_c_water_on_one_side_is_never_crossed():
    water = np.zeros((400, 600), np.uint8)
    water[:, :220] = 255  # river on the left
    masks, zones, result = analyse(water)
    assert result.storage_zones
    assert_storage_valid(masks, water, result)
    for s in result.storage_zones:
        assert s.center_x - s.radius_px > 220 + config.WATER_BUFFER_SIZE - 1


def test_d_irregular_region_keeps_circle_inside():
    # An L-shaped component with no water at all: only its own boundary limits.
    valid = np.zeros((300, 300), np.uint8)
    valid[20:280, 20:90] = 1
    valid[210:280, 20:280] = 1
    cx, cy = 55, 245
    radius, factor, distance, _ = sz.compute_storage_radius(
        valid, np.zeros_like(valid, bool), cx, cy
    )
    assert factor == "candidate_boundary"
    assert distance == brute_force_limit(valid, cx, cy)
    assert radius == math.ceil(distance) - 1 - config.STORAGE_RADIUS_MARGIN_PX
    assert np.all(valid[disk_pixels(cx, cy, radius, valid.shape)])

    # Same through the pipeline: a C-shaped bay of water cut into land.
    water = np.zeros((400, 400), np.uint8)
    cv2.ellipse(water, (200, 200), (150, 150), 0, 40, 320, 255, 40)
    masks, zones, result = analyse(water)
    assert_storage_valid(masks, water, result)


def test_e_nearest_of_several_water_bodies_limits_radius():
    water = np.zeros((400, 400), np.uint8)
    cv2.circle(water, (200, 110), 10, 255, cv2.FILLED)  # near: edge 80 px above
    cv2.circle(water, (330, 200), 10, 255, cv2.FILLED)  # far: edge 120 px right
    masks = candidate_mask.build_candidate_mask(water)
    prohibited = masks.water_buffer_mask > 0
    valid = (~prohibited).astype(np.uint8)
    cx, cy = 200, 200
    radius, factor, distance, point = sz.compute_storage_radius(valid, prohibited, cx, cy)
    assert factor == "water_buffer"
    assert point[1] < cy, "limit should come from the nearer (upper) water body"
    assert abs(distance - brute_force_limit(valid, cx, cy)) < 1e-6
    assert radius == math.ceil(distance) - 1 - config.STORAGE_RADIUS_MARGIN_PX
    assert not np.any(disk_pixels(cx, cy, radius, valid.shape) & prohibited)

    masks, zones, result = analyse(water)
    assert_storage_valid(masks, water, result)


def test_f_very_small_candidate_has_no_invalid_drop_points():
    water = np.full((300, 300), 255, np.uint8)
    cv2.circle(water, (150, 150), 60, 0, cv2.FILLED)  # radius ~ 60-18-4
    masks, zones, result = analyse(water)
    assert_storage_valid(masks, water, result)
    step = max(config.MIN_DROP_POINT_DISTANCE_PX, 2 * config.DROP_POINT_MIN_CLEARANCE_PX)
    for s in result.storage_zones:
        if s.radius_px - 1 < step:
            assert s.drop_zones == [] and s.sampled_points == 0
        else:
            # A round island is tight all the way round: every boundary sample
            # fails, but the guaranteed-clearance ring still yields points.
            assert s.drop_zones, "expected drop zones inside the island"
            rim = [p for p in s.rejected_points]
            assert rim and all(p.reason == "insufficient_clearance" for p in rim)

    # Island too small for any storage zone: reported as not viable, not drawn.
    water = np.full((300, 300), 255, np.uint8)
    cv2.circle(water, (150, 150), 30, 0, cv2.FILLED)
    with override(MIN_REGION_AREA=10, MIN_REGION_CLEARANCE=1):
        masks, zones, result = analyse(water)
    assert result.storage_zones == []
    assert all(item.reason == "radius_below_minimum" for item in result.not_viable)


def test_g_drop_points_are_spaced_and_filtered():
    water = np.zeros((500, 500), np.uint8)
    water[:, :60] = 255
    masks, zones, result = analyse(water)
    assert result.storage_zones
    s = result.storage_zones[0]
    assert len(s.drop_zones) >= 2
    assert_storage_valid(masks, water, result)

    # Force samples onto invalid ground: every reason must be reported, and
    # nothing invalid may be accepted.
    fake = copy.deepcopy(s)
    fake.radius_px = s.center_x + 10  # rings now reach past the river edge
    fake.drop_zones, fake.rejected_points = [], []
    _, labels = cv2.connectedComponents(masks.candidate_mask, connectivity=8)
    component = labels == labels[s.center_y, s.center_x]
    prohibited = masks.water_buffer_mask > 0
    valid = (component & ~prohibited).astype(np.uint8)
    sz.generate_drop_zones(
        fake, valid, sz._padded_precise_distance(valid), water > 0, prohibited,
        component, region_analysis.water_distance_map(water),
    )
    reasons = {p.reason for p in fake.rejected_points}
    assert {"water", "water_buffer"} <= reasons, reasons
    for d in fake.drop_zones:
        assert valid[d.y, d.x] and d.clearance_px >= config.DROP_POINT_MIN_CLEARANCE_PX


def test_ring_radii():
    # Boundary ring, guaranteed-clearance ring, then every step inward.
    assert sz.ring_radii(128, 28, 10, 4) == [127, 122, 94, 66, 38]
    assert sz.ring_radii(39, 28, 10, 4) == [38, 33]
    assert sz.ring_radii(28, 28, 10, 4) == []
    assert sz.ring_radii(30, 28, 10, 4) == [29]
    for r in (12, 29, 57, 180):
        rings = sz.ring_radii(r, 28, 10, 4)
        assert all(28 <= x < r for x in rings) and len(set(rings)) == len(rings)


def test_h_duplicates_are_removed():
    # Rings so small that rounding maps several angles onto one pixel.
    points = sz._ring_candidates(50, 50, [2, 1], 1)
    coords = [(x, y) for x, y, _, _ in points]
    assert len(coords) == len(set(coords))

    # The same ranked zone twice: the second centre is reported, not redrawn.
    water = np.zeros((300, 300), np.uint8)
    water[:, :40] = 255
    masks = candidate_mask.build_candidate_mask(water)
    regions = region_analysis.analyse_candidate_regions(masks.candidate_mask, water)
    zone = scoring.rank_zones(regions, image_area=water.size)[0]
    twin = copy.deepcopy(zone)
    twin.zone_id = 2
    result = sz.analyse_storage_zones(
        [zone, twin], masks.candidate_mask, water, masks.water_buffer_mask,
        region_analysis.water_distance_map(water),
    )
    assert len(result.storage_zones) == 1
    assert result.not_viable[0].reason == "duplicate_center"


def _synthetic_scene(width: int, height: int) -> np.ndarray:
    rng = np.random.default_rng(7)
    image = np.clip(
        np.full((height, width, 3), (60, 110, 70), np.float32) + rng.normal(0, 18, (height, width, 3)),
        0, 255,
    ).astype(np.uint8)
    river = np.zeros((height, width), np.uint8)
    cv2.rectangle(river, (0, int(height * 0.40)), (width, int(height * 0.58)), 255, cv2.FILLED)
    image[river > 0] = (58, 96, 128)
    return image


def _decode(b64: str) -> np.ndarray:
    return cv2.imdecode(np.frombuffer(base64.b64decode(b64), np.uint8), cv2.IMREAD_COLOR)


def test_i_resized_image_keeps_coordinates_aligned():
    scene = _synthetic_scene(2048, 1536)
    ok, buffer = cv2.imencode(".png", scene)
    result = run_analysis(buffer.tobytes())
    info = result["image_info"]
    assert (info["processed_width"], info["processed_height"]) == (1024, 768)
    assert info["scale"] == 0.5
    assert result["storage_zones"], "expected storage zones on both river banks"

    final = _decode(result["images"]["final_analysis"])
    drops = _decode(result["images"]["drop_zones"])
    for image in (final, drops):
        assert image.shape[:2] == (768, 1024)
    for s in result["storage_zones"]:
        cx, cy, r = s["center"]["x"], s["center"]["y"], s["radius_px"]
        # River occupies processed rows ~307-445; circles stay off it.
        assert cy + r < 307 or cy - r > 445, (cy, r)
        # The centre marker is drawn exactly on the reported pixel.
        assert tuple(int(v) for v in final[cy, cx]) == visualization.COLOR_STORAGE
        for d in s["candidate_drop_zones"]:
            px, py = d["point"]["x"], d["point"]["y"]
            assert tuple(int(v) for v in final[py, px]) == visualization.COLOR_DROP
    json.dumps(result, allow_nan=False)


def test_j_no_storage_zone_is_a_clean_empty_state():
    water = np.full((200, 200), 255, np.uint8)
    masks, zones, result = analyse(water)
    assert zones == [] and result.storage_zones == [] and result.not_viable == []

    image = np.zeros((200, 200, 3), np.uint8)
    image[:, :] = (160, 90, 30)  # uniform blue water
    ok, buffer = cv2.imencode(".png", image)
    response = run_analysis(buffer.tobytes())
    assert response["success"] is True
    assert response["storage_zones"] == []
    assert response["metrics"]["storage_zones"] == 0
    assert response["metrics"]["drop_zones"] == 0
    assert response["images"]["drop_zones"] and response["images"]["final_analysis"]
    json.dumps(response, allow_nan=False)


def test_performance_on_a_full_size_image():
    scene = _synthetic_scene(1024, 768)
    ok, buffer = cv2.imencode(".png", scene)
    data = buffer.tobytes()
    run_analysis(data, include_images=False)  # warm-up
    start = time.perf_counter()
    run_analysis(data, include_images=False)
    elapsed = time.perf_counter() - start
    print(f"    full pipeline (no images, AI included if available): {elapsed:.2f} s")

    water = np.zeros((768, 1024), np.uint8)
    water[307:446] = 255
    masks = candidate_mask.build_candidate_mask(water)
    regions = region_analysis.analyse_candidate_regions(masks.candidate_mask, water)
    zones = scoring.rank_zones(regions, image_area=water.size)
    distance = region_analysis.water_distance_map(water)
    start = time.perf_counter()
    sz.analyse_storage_zones(zones, masks.candidate_mask, water, masks.water_buffer_mask, distance)
    storage_elapsed = time.perf_counter() - start
    print(f"    storage + drop-zone stage alone: {storage_elapsed * 1000:.1f} ms")
    assert storage_elapsed < 1.0


def main() -> int:
    tests = [(name, fn) for name, fn in sorted(globals().items()) if name.startswith("test_")]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"PASS {name}")
        except Exception as exc:  # report every failure, keep going
            failed += 1
            print(f"FAIL {name}: {type(exc).__name__}: {exc}")
    print(f"{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
