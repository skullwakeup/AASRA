"""
Probable Supply Drop Zone — a band of open land along the detected shoreline.

    WATER MASK
      -> DISTANCE FROM WATER   (every land pixel: px to the nearest water pixel)
      -> INNER MARGIN          iso-distance line at SUPPLY_INNER_MARGIN_PX
      -> OUTER MARGIN          iso-distance line at SUPPLY_OUTER_MARGIN_PX
      -> BAND                  open land with inner <= distance <= outer
      -> CLEANUP               morphology, drop fragments < SUPPLY_MIN_SEGMENT_AREA_PX
      -> SEGMENTS              connected pieces of the band, largest first

The inner margin keeps a standoff from the water's edge; the outer margin is
the farthest a drop is placed from the water, so supplies land on ground that
people at the water's edge can reach. "Open land" is non-water land that is
not tree canopy (canopy.py).

ALL DISTANCES ARE PROCESSED-IMAGE PIXELS, not metres. The band is land near
detected water in this image — nothing more. Surface, slope, structures and
obstacles inside it are not assessed and it is never presented as safe.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

import cv2
import numpy as np

from .. import config


@dataclass
class SupplySegment:
    segment_id: int
    pixel_area: int
    bbox_x: int
    bbox_y: int
    width: int
    height: int
    centroid_x: float
    centroid_y: float
    #: A band pixel inside the segment, as far as possible from its edges —
    #: a stable anchor for labels, not a recommended drop point.
    anchor_x: int
    anchor_y: int


@dataclass
class SupplyBand:
    inner_margin_px: int
    outer_margin_px: int
    band_mask: np.ndarray  # uint8, 255 = Probable Supply Drop Zone
    inner_line_mask: np.ndarray  # uint8, the region distance <= inner (on land)
    outer_line_mask: np.ndarray  # uint8, the region distance <= outer (on land)
    pixel_area: int
    shoreline_land_px: int  # land pixels between the margins before exclusions
    canopy_excluded_px: int
    segments: List[SupplySegment] = field(default_factory=list)


def _segments(band: np.ndarray) -> tuple[np.ndarray, List[SupplySegment]]:
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(band, connectivity=8)
    keep = np.zeros(count, dtype=bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= config.SUPPLY_MIN_SEGMENT_AREA_PX
    cleaned = np.where(keep[labels], 255, 0).astype(np.uint8)

    # Zero-padded so the image frame counts as an edge: anchors stay inside.
    padded = cv2.copyMakeBorder(cleaned, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    inner_distance = cv2.distanceTransform(padded, cv2.DIST_L2, 5)[1:-1, 1:-1]
    order = sorted(
        (label for label in range(1, count) if keep[label]),
        key=lambda label: -int(stats[label, cv2.CC_STAT_AREA]),
    )
    segments: List[SupplySegment] = []
    for rank, label in enumerate(order, start=1):
        x, y, w, h, area = (int(v) for v in stats[label])
        local = np.where(labels[y : y + h, x : x + w] == label, inner_distance[y : y + h, x : x + w], -1)
        ay, ax = np.unravel_index(int(np.argmax(local)), local.shape)
        segments.append(
            SupplySegment(
                segment_id=rank,
                pixel_area=area,
                bbox_x=x,
                bbox_y=y,
                width=w,
                height=h,
                centroid_x=float(centroids[label][0]),
                centroid_y=float(centroids[label][1]),
                anchor_x=int(x + ax),
                anchor_y=int(y + ay),
            )
        )
    return cleaned, segments


def build_supply_band(
    water_mask: np.ndarray,
    water_distance: np.ndarray,
    canopy_mask: np.ndarray,
) -> SupplyBand:
    """Compute the band of open land between the inner and outer margins."""
    inner = int(config.SUPPLY_INNER_MARGIN_PX)
    outer = int(config.SUPPLY_OUTER_MARGIN_PX)
    land = water_mask == 0
    has_water = bool(np.any(water_mask))

    if not has_water or outer <= inner:
        empty = np.zeros(water_mask.shape, dtype=np.uint8)
        return SupplyBand(inner, outer, empty, empty, empty, 0, 0, 0, [])

    within_inner = land & (water_distance <= inner)
    within_outer = land & (water_distance <= outer)
    shoreline = within_outer & ~within_inner
    canopy = canopy_mask > 0
    band = (shoreline & ~canopy).astype(np.uint8) * 255

    k = config.SUPPLY_MORPH_KERNEL
    if k >= 3:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
        band = cv2.morphologyEx(band, cv2.MORPH_OPEN, kernel)
    band, segments = _segments(band)

    return SupplyBand(
        inner_margin_px=inner,
        outer_margin_px=outer,
        band_mask=band,
        inner_line_mask=within_inner.astype(np.uint8) * 255,
        outer_line_mask=within_outer.astype(np.uint8) * 255,
        pixel_area=int(np.count_nonzero(band)),
        shoreline_land_px=int(np.count_nonzero(shoreline)),
        canopy_excluded_px=int(np.count_nonzero(shoreline & canopy)),
        segments=segments,
    )


def supply_to_dict(supply: SupplyBand, image_area: int) -> dict:
    """API representation of the Probable Supply Drop Zone."""
    shown = supply.segments[: config.SUPPLY_MAX_SEGMENTS_REPORTED]
    return {
        "inner_margin_px": supply.inner_margin_px,
        "outer_margin_px": supply.outer_margin_px,
        "pixel_area": supply.pixel_area,
        "area_percentage": round(100.0 * supply.pixel_area / float(max(1, image_area)), 2),
        "shoreline_land_px": supply.shoreline_land_px,
        "canopy_excluded_px": supply.canopy_excluded_px,
        "segment_count": len(supply.segments),
        "segments": [
            {
                "id": seg.segment_id,
                "pixel_area": seg.pixel_area,
                "share_of_band": round(100.0 * seg.pixel_area / float(max(1, supply.pixel_area)), 1),
                "bounding_box": {"x": seg.bbox_x, "y": seg.bbox_y, "width": seg.width, "height": seg.height},
                "centroid": {"x": round(seg.centroid_x, 1), "y": round(seg.centroid_y, 1)},
                "anchor": {"x": seg.anchor_x, "y": seg.anchor_y},
            }
            for seg in shown
        ],
    }
