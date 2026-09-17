"""
Phases 6, 7 & 8 — connected component analysis, distance transform and openness.

For every candidate region we compute:
  * region id, pixel area, bounding box (x, y, w, h), centroid
  * the max-clearance point = the interior pixel with maximum clearance
    (cv2.distanceTransform); it becomes the storage centre in storage_zones.py
  * region clearance and water clearance, both in PIXELS of the processed image
  * an openness feature derived from real geometry (never a random value)

ALL DISTANCES ARE PIXEL DISTANCES. They are not metres and carry no safety
meaning.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

import cv2
import numpy as np

from .. import config


@dataclass
class CandidateRegion:
    """One candidate land region."""

    region_id: int
    pixel_area: int
    bbox_x: int
    bbox_y: int
    width: int
    height: int
    centroid_x: float
    centroid_y: float
    drop_x: int
    drop_y: int
    region_clearance_px: float  # clearance inside the candidate mask
    water_clearance_px: float  # distance from that point to nearest water pixel
    openness: float  # 0..1, see _compute_openness
    compactness: float  # 4*pi*A / P^2
    extent: float  # area / bounding-box area


def _padded_distance_transform(mask: np.ndarray) -> np.ndarray:
    """Distance transform that also treats the image border as a boundary.

    cv2.distanceTransform measures distance to the nearest zero pixel. A region
    touching the image edge would otherwise be credited with infinite clearance
    there, so the mask is zero-padded by one pixel first.
    """
    padded = cv2.copyMakeBorder(mask, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    dist = cv2.distanceTransform(padded, cv2.DIST_L2, 5)
    return dist[1:-1, 1:-1]


def water_distance_map(water_mask: np.ndarray) -> np.ndarray:
    """Per-pixel distance (px) to the nearest water pixel.

    Computed as the distance transform of the inverted water mask. Pixels that
    are themselves water get 0.

    With no water pixels at all, OpenCV reports FLT_MAX everywhere; that is
    capped at the image diagonal (no water anywhere in the frame) so the value
    stays a finite, displayable pixel distance.
    """
    inverted = cv2.bitwise_not(water_mask)
    distance = cv2.distanceTransform(inverted, cv2.DIST_L2, 5)
    diagonal = float(np.hypot(*water_mask.shape[:2]))
    return np.minimum(distance, diagonal)


def _compute_openness(
    area: float,
    width: int,
    height: int,
    clearance: float,
    contour_perimeter: float,
) -> tuple[float, float, float]:
    """Openness feature in [0, 1] built from three real geometric properties.

    1. normalised clearance = clearance / (0.5 * min(bbox_w, bbox_h))
       How close the region's largest inscribed circle is to filling the
       region's own narrow dimension. A long thin strip scores low, a broad
       open field scores high. Clipped to 1.
    2. compactness (circularity) = 4*pi*area / perimeter^2, clipped to 1.
       Ragged, fragmented outlines score low; smooth convex ones score high.
    3. extent = area / (bbox_w * bbox_h)
       How completely the region fills its bounding box.

    openness = 0.50*normalised_clearance + 0.30*compactness + 0.20*extent
    (weights configurable in config.OPENNESS_WEIGHT_*)
    """
    half_min_side = 0.5 * max(1.0, float(min(width, height)))
    normalised_clearance = min(1.0, clearance / half_min_side)

    if contour_perimeter > 0:
        compactness = (4.0 * np.pi * area) / (contour_perimeter ** 2)
    else:
        compactness = 0.0
    compactness = float(min(1.0, max(0.0, compactness)))

    bbox_area = float(max(1, width * height))
    extent = float(min(1.0, area / bbox_area))

    openness = (
        config.OPENNESS_WEIGHT_CLEARANCE * normalised_clearance
        + config.OPENNESS_WEIGHT_COMPACTNESS * compactness
        + config.OPENNESS_WEIGHT_EXTENT * extent
    )
    return float(min(1.0, max(0.0, openness))), compactness, extent


def analyse_candidate_regions(
    candidate_mask: np.ndarray,
    water_mask: np.ndarray,
    min_area: int | None = None,
) -> List[CandidateRegion]:
    """Label the candidate mask and describe every surviving region."""
    minimum_area = config.MIN_REGION_AREA if min_area is None else min_area

    count, labels, stats, centroids = cv2.connectedComponentsWithStats(
        candidate_mask, connectivity=8
    )
    if count <= 1:
        return []

    distance = _padded_distance_transform(candidate_mask)
    water_distance = water_distance_map(water_mask)

    regions: List[CandidateRegion] = []
    next_id = 1

    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < minimum_area:
            continue  # Phase 6: reject tiny regions

        x = int(stats[label, cv2.CC_STAT_LEFT])
        y = int(stats[label, cv2.CC_STAT_TOP])
        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])

        component = (labels == label)

        # Phase 7 — furthest-from-boundary pixel inside this region.
        local_distance = np.where(component, distance, 0.0)
        flat_index = int(np.argmax(local_distance))
        drop_y, drop_x = np.unravel_index(flat_index, local_distance.shape)
        clearance = float(local_distance[drop_y, drop_x])

        if clearance < config.MIN_REGION_CLEARANCE:
            continue  # sliver, not a usable open area

        water_clearance = float(water_distance[drop_y, drop_x])

        # Perimeter from the component's outer contour (for compactness).
        component_mask = np.zeros(candidate_mask.shape, dtype=np.uint8)
        component_mask[component] = 255
        contours, _ = cv2.findContours(
            component_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        perimeter = max(
            (cv2.arcLength(c, True) for c in contours), default=0.0
        )

        openness, compactness, extent = _compute_openness(
            area=float(area),
            width=w,
            height=h,
            clearance=clearance,
            contour_perimeter=perimeter,
        )

        regions.append(
            CandidateRegion(
                region_id=next_id,
                pixel_area=area,
                bbox_x=x,
                bbox_y=y,
                width=w,
                height=h,
                centroid_x=float(centroids[label][0]),
                centroid_y=float(centroids[label][1]),
                drop_x=int(drop_x),
                drop_y=int(drop_y),
                region_clearance_px=round(clearance, 2),
                water_clearance_px=round(water_clearance, 2),
                openness=round(openness, 4),
                compactness=round(compactness, 4),
                extent=round(extent, 4),
            )
        )
        next_id += 1

    return regions
