"""
Phase 11b — probable storage zones and probable drop zones.

Extends the ranked zones; it does not replace anything upstream.

    RANKED ZONE (candidate region + its max-clearance point)
      -> STORAGE CENTRE      the zone's existing drop point, unchanged
      -> STORAGE RADIUS      largest circle that stays valid (below)
      -> PROBABLE STORAGE ZONE
      -> RING SAMPLING       candidate drop points inside the circle
      -> FILTER + SCORE      clearance, water distance, proximity
      -> PROBABLE DROP ZONES spaced, capped, ranked

Terminology
-----------
  storage zone  circular candidate area around the storage centre
  drop zone     small circle (radius DROP_POINT_MIN_CLEARANCE_PX) inside it
  drop point    the exact pixel at the centre of a drop zone

Storage radius
--------------
A pixel is *valid* for a zone when it belongs to that zone's connected
candidate component AND is not in the prohibited mask (detected water dilated
by the water buffer, reused from candidate_mask.py). The candidate mask is
already built as "not water buffer", but its morphological closing can re-add
a few buffer pixels, so both conditions are checked explicitly.

    d_invalid = Euclidean distance from the centre to the nearest invalid pixel
    d_border  = distance from the centre to the first pixel outside the image
    d_limit   = min(d_invalid, d_border)
    r_geo     = ceil(d_limit) - 1          largest integer r with r < d_limit
    r         = min(r_geo - STORAGE_RADIUS_MARGIN_PX, MAX_STORAGE_RADIUS_PX)

Every pixel centre within r of the centre is then checked against the valid
mask; r is reduced until that holds (normally it already does). A result
below MIN_STORAGE_RADIUS_PX is reported as not viable, never drawn.

Because the circle is bounded by the zone's own component, it can never spill
into unrelated land, touch water or the buffer, or leave the image.

Drop zones
----------
Candidates lie on concentric rings (see ring_radii): one just inside the
boundary, one at the largest distance where the clearance test always passes, then
every MIN_DROP_POINT_DISTANCE_PX inward while still that far from the centre.
Samples along a ring are roughly that far apart; alternate rings are offset
by half a step. A candidate is rejected when it falls outside the storage
circle, on water, in the water buffer, outside the candidate region, or when
its clearance (distance to the nearest invalid pixel or image edge) is below
DROP_POINT_MIN_CLEARANCE_PX. Inside a verified storage circle only the last
test can fail in practice, and only on the boundary ring: samples on the
side where the boundary is tight have about STORAGE_RADIUS_MARGIN_PX of
clearance and are rejected, while samples on the open side pass. Survivors are scored (0-100):

    clearance_score = min(1, clearance_px / storage_radius_px)
    water_score     = min(1, water_clearance_px / CLEARANCE_SCORE_SATURATION_PX)
    proximity_score = 1 - distance_from_centre_px / storage_radius_px

    score = 100 * (0.40*clearance + 0.30*water + 0.30*proximity)

This drop-point score is separate from, and not comparable with, the zone
score in scoring.py. Points are taken greedily in score order, skipping any
closer than MIN_DROP_POINT_DISTANCE_PX to the centre or to an accepted point,
up to MAX_DROP_POINTS_PER_STORAGE_ZONE.

ALL DISTANCES ARE PROCESSED-IMAGE PIXELS. Nothing here says a location is
safe, reachable or suitable in the physical world.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import cv2
import numpy as np

from .. import config
from .scoring import ScoredZone, classify_score


@dataclass
class DropZone:
    drop_id: int
    x: int
    y: int
    radius_px: int
    clearance_px: float
    water_clearance_px: float
    distance_from_center_px: float
    clearance_score: float
    water_clearance_score: float
    proximity_score: float
    score: float
    classification: str


@dataclass
class RejectedPoint:
    x: int
    y: int
    reason: str


@dataclass
class StorageZone:
    zone_id: int
    center_x: int
    center_y: int
    radius_px: int
    #: What bounded the radius: water_buffer, candidate_boundary,
    #: image_boundary or max_radius.
    limiting_factor: str
    #: Distance (px) from the centre to the limiting pixel, before the margin.
    limiting_distance_px: float
    #: The limiting pixel itself; None when the radius cap was the limit.
    limiting_point: Optional[Tuple[int, int]]
    water_clearance_px: float
    drop_zones: List[DropZone] = field(default_factory=list)
    rejected_points: List[RejectedPoint] = field(default_factory=list)
    sampled_points: int = 0
    ring_radii: List[int] = field(default_factory=list)


@dataclass
class NotViableZone:
    zone_id: int
    reason: str
    radius_px: int


@dataclass
class StorageAnalysis:
    storage_zones: List[StorageZone]
    not_viable: List[NotViableZone]


def _padded_precise_distance(mask: np.ndarray) -> np.ndarray:
    """Exact Euclidean distance to the nearest zero pixel or the image edge."""
    padded = cv2.copyMakeBorder(mask, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    return cv2.distanceTransform(padded, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)[1:-1, 1:-1]


def _nearest_invalid(
    valid: np.ndarray, cx: int, cy: int, reach: int
) -> Tuple[float, Optional[Tuple[int, int]]]:
    """Nearest non-valid pixel within a (2*reach+1)^2 window around the centre."""
    height, width = valid.shape
    x0, x1 = max(0, cx - reach), min(width, cx + reach + 1)
    y0, y1 = max(0, cy - reach), min(height, cy + reach + 1)
    ys, xs = np.nonzero(valid[y0:y1, x0:x1] == 0)
    if xs.size == 0:
        return math.inf, None
    d2 = (xs + x0 - cx) ** 2 + (ys + y0 - cy) ** 2
    i = int(np.argmin(d2))
    return math.sqrt(float(d2[i])), (int(xs[i] + x0), int(ys[i] + y0))


def disk_is_valid(valid: np.ndarray, cx: int, cy: int, r: int) -> bool:
    """True when every pixel centre within r of (cx, cy) is inside the image
    and valid. r = 0 is the single centre pixel."""
    height, width = valid.shape
    if r < 0 or cx - r < 0 or cy - r < 0 or cx + r >= width or cy + r >= height:
        return False
    yy, xx = np.ogrid[-r : r + 1, -r : r + 1]
    inside = xx * xx + yy * yy <= r * r
    window = valid[cy - r : cy + r + 1, cx - r : cx + r + 1]
    return bool(np.all(window[inside]))


def compute_storage_radius(
    valid: np.ndarray,
    prohibited: np.ndarray,
    cx: int,
    cy: int,
) -> Tuple[int, str, float, Optional[Tuple[int, int]]]:
    """Largest valid storage radius around (cx, cy).

    Returns (radius_px, limiting_factor, limiting_distance_px, limiting_point).
    radius_px is 0 when the centre itself is invalid.
    """
    height, width = valid.shape
    if not (0 <= cx < width and 0 <= cy < height) or not valid[cy, cx]:
        return 0, "center_invalid", 0.0, (cx, cy)

    margin = max(0, config.STORAGE_RADIUS_MARGIN_PX)
    cap = max(0, config.MAX_STORAGE_RADIUS_PX)
    reach = cap + margin + 1

    d_invalid, p_invalid = _nearest_invalid(valid, cx, cy, reach)
    d_border = float(min(cx, cy, width - 1 - cx, height - 1 - cy) + 1)

    if d_border < d_invalid:
        d_limit, factor = d_border, "image_boundary"
        # The first pixel outside the image, clamped back onto the edge.
        options = [
            (cx + 1, (-1, cy)),
            (cy + 1, (cx, -1)),
            (width - cx, (width, cy)),
            (height - cy, (cx, height)),
        ]
        _, (px, py) = min(options, key=lambda item: item[0])
        point: Optional[Tuple[int, int]] = (
            min(max(px, 0), width - 1),
            min(max(py, 0), height - 1),
        )
    else:
        d_limit, point = d_invalid, p_invalid
        factor = (
            "water_buffer"
            if point is not None and prohibited[point[1], point[0]]
            else "candidate_boundary"
        )

    # d_border is always finite, so d_limit is too. Anything farther than
    # `reach` (including invalid pixels the search window did not cover)
    # already puts the geometric radius above the cap.
    radius = math.ceil(d_limit) - 1 - margin
    if radius > cap:
        radius, factor, point = cap, "max_radius", None
    radius = max(0, radius)

    # Verify against the real mask; shrink until every covered pixel is valid.
    while radius > 0 and not disk_is_valid(valid, cx, cy, radius):
        radius -= 1

    return int(radius), factor, round(d_limit, 2), point


def ring_radii(radius: int, step: int, clearance: int, margin: int) -> List[int]:
    """Sampling ring radii, outermost first.

    1. radius - 1: just inside the boundary (one pixel in, so rounding a
       sample to integer pixels never pushes it outside). Samples here show
       where the boundary is tight: they are rejected on that side.
    2. radius + margin - clearance: the farthest ring on which every sample has
       at least `clearance` px of valid land. The circle was sized so that
       the nearest invalid pixel is at least radius + margin + 1 from the
       centre; one pixel is kept back for rounding.
    3. then every `step` inward from ring 2.

    No ring is placed closer than `step` to the centre. Rings may be closer
    than `step` to each other; spacing between accepted points is enforced
    when they are selected.
    """
    if step <= 0:
        return []
    rings = [radius - 1] if radius - 1 >= step else []
    inner = min(radius - 1, radius + margin - clearance)
    rings.extend(r for r in range(inner, step - 1, -step) if r not in rings)
    return rings


def _ring_candidates(
    cx: int, cy: int, radii: List[int], step: int
) -> List[Tuple[int, int, int, int]]:
    """(x, y, ring, index) on concentric rings, deduplicated after rounding."""
    seen = set()
    out = []
    for ring, r in enumerate(radii):
        count = max(6, int(2 * math.pi * r / step))
        offset = (math.pi / count) if ring % 2 else 0.0
        for index in range(count):
            angle = offset + 2 * math.pi * index / count
            x = int(round(cx + r * math.cos(angle)))
            y = int(round(cy + r * math.sin(angle)))
            if (x, y) in seen:
                continue
            seen.add((x, y))
            out.append((x, y, ring, index))
    return out


def generate_drop_zones(
    storage: StorageZone,
    valid: np.ndarray,
    clearance_map: np.ndarray,
    water_mask: np.ndarray,
    prohibited: np.ndarray,
    component: np.ndarray,
    water_distance: np.ndarray,
) -> None:
    """Fill storage.drop_zones / rejected_points / sampled_points in place."""
    height, width = valid.shape
    rho = max(1, config.DROP_POINT_MIN_CLEARANCE_PX)
    step = max(config.MIN_DROP_POINT_DISTANCE_PX, 2 * rho)
    cx, cy, radius = storage.center_x, storage.center_y, storage.radius_px

    storage.ring_radii = ring_radii(
        radius, step, rho, max(0, config.STORAGE_RADIUS_MARGIN_PX)
    )
    candidates = _ring_candidates(cx, cy, storage.ring_radii, step)
    storage.sampled_points = len(candidates)

    scored = []
    for x, y, ring, index in candidates:
        distance = math.hypot(x - cx, y - cy)
        if not (0 <= x < width and 0 <= y < height):
            reason = "outside_image"
        elif distance > radius:
            reason = "outside_storage_zone"
        elif water_mask[y, x]:
            reason = "water"
        elif prohibited[y, x]:
            reason = "water_buffer"
        elif not component[y, x]:
            reason = "outside_candidate_region"
        elif clearance_map[y, x] < rho:
            reason = "insufficient_clearance"
        else:
            reason = ""
        if reason:
            storage.rejected_points.append(RejectedPoint(x, y, reason))
            continue

        clearance = float(clearance_map[y, x])
        water_clearance = float(water_distance[y, x])
        c_score = min(1.0, clearance / max(1.0, radius))
        w_score = min(1.0, water_clearance / config.CLEARANCE_SCORE_SATURATION_PX)
        p_score = max(0.0, 1.0 - distance / max(1.0, radius))
        score = 100.0 * (
            config.DROP_SCORE_WEIGHT_CLEARANCE * c_score
            + config.DROP_SCORE_WEIGHT_WATER_CLEARANCE * w_score
            + config.DROP_SCORE_WEIGHT_PROXIMITY * p_score
        )
        scored.append(
            (round(score, 1), ring, index, x, y, distance, clearance, water_clearance,
             c_score, w_score, p_score)
        )

    scored.sort(key=lambda item: (-item[0], item[1], item[2]))
    accepted: List[Tuple[int, int]] = [(cx, cy)]
    for score, _, _, x, y, distance, clearance, water_clearance, c, w, p in scored:
        if len(storage.drop_zones) >= max(0, config.MAX_DROP_POINTS_PER_STORAGE_ZONE):
            break
        if any(math.hypot(x - ax, y - ay) < step for ax, ay in accepted):
            continue
        accepted.append((x, y))
        storage.drop_zones.append(
            DropZone(
                drop_id=len(storage.drop_zones) + 1,
                x=x,
                y=y,
                radius_px=rho,
                clearance_px=round(clearance, 2),
                water_clearance_px=round(water_clearance, 2),
                distance_from_center_px=round(distance, 2),
                clearance_score=round(100.0 * c, 1),
                water_clearance_score=round(100.0 * w, 1),
                proximity_score=round(100.0 * p, 1),
                score=score,
                classification=classify_score(score),
            )
        )


def analyse_storage_zones(
    zones: List[ScoredZone],
    candidate_mask: np.ndarray,
    water_mask: np.ndarray,
    prohibited_mask: np.ndarray,
    water_distance: np.ndarray,
) -> StorageAnalysis:
    """Build a storage zone (and its drop zones) for every ranked zone."""
    storage_zones: List[StorageZone] = []
    not_viable: List[NotViableZone] = []
    if not zones:
        return StorageAnalysis(storage_zones, not_viable)

    _, labels = cv2.connectedComponents(candidate_mask, connectivity=8)
    prohibited = prohibited_mask > 0
    water = water_mask > 0
    seen_centres = set()

    for zone in zones:
        cx, cy = zone.region.drop_x, zone.region.drop_y
        if (cx, cy) in seen_centres:
            not_viable.append(NotViableZone(zone.zone_id, "duplicate_center", 0))
            continue
        seen_centres.add((cx, cy))

        label = int(labels[cy, cx])
        component = (labels == label) if label > 0 else np.zeros(labels.shape, bool)
        valid = (component & ~prohibited).astype(np.uint8)

        radius, factor, limit_distance, limit_point = compute_storage_radius(
            valid, prohibited, cx, cy
        )
        if factor == "center_invalid":
            not_viable.append(NotViableZone(zone.zone_id, "center_in_excluded_area", 0))
            continue
        if radius < config.MIN_STORAGE_RADIUS_PX:
            not_viable.append(
                NotViableZone(zone.zone_id, "radius_below_minimum", radius)
            )
            continue

        storage = StorageZone(
            zone_id=zone.zone_id,
            center_x=cx,
            center_y=cy,
            radius_px=radius,
            limiting_factor=factor,
            limiting_distance_px=limit_distance,
            limiting_point=limit_point,
            water_clearance_px=round(float(water_distance[cy, cx]), 2),
        )
        generate_drop_zones(
            storage,
            valid,
            _padded_precise_distance(valid),
            water,
            prohibited,
            component,
            water_distance,
        )
        storage_zones.append(storage)

    return StorageAnalysis(storage_zones, not_viable)


def storage_to_dict(storage: StorageZone, zone: ScoredZone) -> dict:
    """API representation of one storage zone."""
    return {
        "id": storage.zone_id,
        "zone_id": storage.zone_id,
        "score": zone.final_score,
        "classification": zone.classification,
        "center": {"x": storage.center_x, "y": storage.center_y},
        "radius_px": storage.radius_px,
        "limiting_factor": storage.limiting_factor,
        "limiting_distance_px": storage.limiting_distance_px,
        "limiting_point": (
            {"x": storage.limiting_point[0], "y": storage.limiting_point[1]}
            if storage.limiting_point is not None
            else None
        ),
        "water_clearance_px": storage.water_clearance_px,
        "sampled_points": storage.sampled_points,
        "sampling_ring_radii_px": storage.ring_radii,
        "candidate_drop_zones": [
            {
                "id": drop.drop_id,
                "point": {"x": drop.x, "y": drop.y},
                "radius_px": drop.radius_px,
                "score": drop.score,
                "classification": drop.classification,
                "clearance_px": drop.clearance_px,
                "water_clearance_px": drop.water_clearance_px,
                "distance_from_storage_center_px": drop.distance_from_center_px,
                "score_breakdown": {
                    "clearance_score": drop.clearance_score,
                    "water_clearance_score": drop.water_clearance_score,
                    "proximity_score": drop.proximity_score,
                },
            }
            for drop in storage.drop_zones
        ],
        "rejected_points": [
            {"x": point.x, "y": point.y, "reason": point.reason}
            for point in storage.rejected_points
        ],
    }
