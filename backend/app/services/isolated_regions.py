"""
Phase 9 — potentially isolated land regions.

NO PEOPLE ARE DETECTED HERE. Nothing in this module knows or claims anything
about persons, occupancy or entrapment. It reports only land geometry:
patches of non-water land that are disconnected from the main landmass.

Algorithm
---------
    NON-WATER MASK
      -> CONNECTED COMPONENT ANALYSIS
      -> FIND LARGEST LAND COMPONENT (the reference landmass)
      -> ANALYSE EVERY OTHER DISCONNECTED LAND COMPONENT
      -> CALCULATE ITS RELATIONSHIP TO SURROUNDING WATER
      -> ISOLATION SCORE (0-100)

A region is reported when it is disconnected from the largest land component
AND its area >= MIN_ISOLATED_AREA.

Isolation score (all three sub-features are measured, never invented):
    water_contact  = fraction of the region's outer boundary touching water
    separation     = distance to the largest land component, normalised by
                     ISOLATION_SEPARATION_SATURATION_PX (clipped to 1)
    relative_size  = 1 - (region area / largest land area), clipped to [0, 1]

    isolation = 100 * (0.45*water_contact + 0.35*separation + 0.20*relative_size)

Bands: 80-100 HIGH ISOLATION, 50-79 MODERATE ISOLATION, below 50 LOW ISOLATION.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

import cv2
import numpy as np

from .. import config


@dataclass
class IsolatedRegion:
    region_id: int
    pixel_area: int
    bbox_x: int
    bbox_y: int
    width: int
    height: int
    centroid_x: float
    centroid_y: float
    water_contact_ratio: float  # 0..1
    separation_px: float  # distance to largest land component
    relative_size: float  # 0..1
    isolation_score: float  # 0..100
    classification: str  # HIGH / MODERATE / LOW ISOLATION


def classify_isolation(score: float) -> str:
    """Map a 0-100 isolation score onto its band."""
    if score >= config.ISOLATION_HIGH_MIN:
        return "HIGH ISOLATION"
    if score >= config.ISOLATION_MODERATE_MIN:
        return "MODERATE ISOLATION"
    return "LOW ISOLATION"


def _boundary_pixels(component_mask: np.ndarray) -> np.ndarray:
    """One-pixel outer ring just outside the component."""
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    dilated = cv2.dilate(component_mask, kernel, iterations=1)
    return cv2.subtract(dilated, component_mask)


def find_isolated_regions(
    non_water_mask: np.ndarray,
    water_mask: np.ndarray,
    min_area: int | None = None,
) -> List[IsolatedRegion]:
    """Return every potentially isolated land region, highest score first."""
    minimum_area = config.MIN_ISOLATED_AREA if min_area is None else min_area

    count, labels, stats, centroids = cv2.connectedComponentsWithStats(
        non_water_mask, connectivity=8
    )
    if count <= 2:
        # Only background + a single land component: nothing is disconnected.
        return []

    areas = stats[1:, cv2.CC_STAT_AREA]
    largest_label = int(np.argmax(areas)) + 1
    largest_area = float(stats[largest_label, cv2.CC_STAT_AREA])

    largest_mask = np.zeros(non_water_mask.shape, dtype=np.uint8)
    largest_mask[labels == largest_label] = 255

    # Distance (px) from every pixel to the largest land component.
    distance_to_mainland = cv2.distanceTransform(
        cv2.bitwise_not(largest_mask), cv2.DIST_L2, 5
    )

    regions: List[IsolatedRegion] = []
    next_id = 1

    for label in range(1, count):
        if label == largest_label:
            continue

        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < minimum_area:
            continue

        component = np.zeros(non_water_mask.shape, dtype=np.uint8)
        component[labels == label] = 255

        # --- water relationship: how much of the outer ring is water? ------
        ring = _boundary_pixels(component)
        ring_pixels = int(np.count_nonzero(ring))
        if ring_pixels == 0:
            continue
        water_ring = int(np.count_nonzero(cv2.bitwise_and(ring, water_mask)))
        water_contact = water_ring / float(ring_pixels)

        # --- separation from the mainland ----------------------------------
        separation = float(np.min(distance_to_mainland[labels == label]))
        normalised_separation = min(
            1.0, separation / float(config.ISOLATION_SEPARATION_SATURATION_PX)
        )

        # --- relative size --------------------------------------------------
        relative_size = 1.0 - min(1.0, area / max(1.0, largest_area))

        score = 100.0 * (
            config.ISOLATION_WEIGHT_WATER_CONTACT * water_contact
            + config.ISOLATION_WEIGHT_SEPARATION * normalised_separation
            + config.ISOLATION_WEIGHT_RELATIVE_SIZE * relative_size
        )
        score = float(min(100.0, max(0.0, score)))

        regions.append(
            IsolatedRegion(
                region_id=next_id,
                pixel_area=area,
                bbox_x=int(stats[label, cv2.CC_STAT_LEFT]),
                bbox_y=int(stats[label, cv2.CC_STAT_TOP]),
                width=int(stats[label, cv2.CC_STAT_WIDTH]),
                height=int(stats[label, cv2.CC_STAT_HEIGHT]),
                centroid_x=float(centroids[label][0]),
                centroid_y=float(centroids[label][1]),
                water_contact_ratio=round(water_contact, 4),
                separation_px=round(separation, 2),
                relative_size=round(relative_size, 4),
                isolation_score=round(score, 1),
                classification=classify_isolation(score),
            )
        )
        next_id += 1

    regions.sort(key=lambda r: r.isolation_score, reverse=True)
    for index, region in enumerate(regions, start=1):
        region.region_id = index
    return regions
