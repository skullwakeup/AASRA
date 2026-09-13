"""
Pipeline orchestrator.

Chains the services in the required order and returns the structured analysis
dictionary that /api/analyze serves. Kept separate from main.py so the whole
computer-vision pipeline can be exercised without starting a web server:

    IMAGE
      -> WATER DETECTION
      -> WATER MASK
      -> WATER BUFFER
      -> CANDIDATE MASK
      -> CONNECTED COMPONENTS
      -> DISTANCE TRANSFORM
      -> DROP POINTS
      -> ZONE SCORING
      -> TOP N ZONES

Every number in the response is derived from the uploaded image. Nothing is
fabricated, defaulted or randomised.
"""

from __future__ import annotations

from typing import Any, Dict

import numpy as np

from . import config
from .services import (
    drop_zone_detection,
    isolated_regions,
    preprocessing,
    region_analysis,
    scoring,
    visualization,
    water_detection,
)


class AnalysisError(ValueError):
    """Raised for user-correctable analysis failures (bad/unusable image)."""


def run_analysis(image_bytes: bytes, include_images: bool = True) -> Dict[str, Any]:
    """Run the full pipeline over raw image bytes and build the API payload."""

    # -- Phase 2: preprocessing --------------------------------------------
    prepared = preprocessing.preprocess(image_bytes)
    height, width = prepared.display_bgr.shape[:2]
    image_area = int(height * width)

    # -- Phase 3: water detection ------------------------------------------
    water = water_detection.detect_water(prepared.analysis_bgr)

    # -- Phases 4 & 5: buffer + candidate mask ------------------------------
    masks = drop_zone_detection.build_candidate_mask(water.mask)

    # -- Phases 6, 7, 8: components, distance transform, openness ----------
    regions = region_analysis.analyse_candidate_regions(
        candidate_mask=masks.candidate_mask, water_mask=water.mask
    )

    # -- Phase 9: potentially isolated land regions ------------------------
    isolated = isolated_regions.find_isolated_regions(
        non_water_mask=masks.non_water_mask, water_mask=water.mask
    )

    # -- Phases 10 & 11: scoring and ranking -------------------------------
    zones = scoring.rank_zones(regions, image_area=image_area)

    # -- Phase 12: visualisations ------------------------------------------
    if include_images and config.INCLUDE_IMAGES:
        images = visualization.build_visualizations(
            display_bgr=prepared.display_bgr,
            water_mask=water.mask,
            candidate_mask=masks.candidate_mask,
            zones=zones,
            isolated=isolated,
        )
    else:
        images = {
            key: ""
            for key in (
                "original",
                "water_mask",
                "candidate_mask",
                "isolated_regions",
                "final_analysis",
            )
        }

    non_water_percentage = round(100.0 - water.water_percentage, 2)

    warnings = []
    if water.water_pixels == 0:
        warnings.append(
            "No water was detected in this image. Candidate regions therefore "
            "cover the whole frame and carry little meaning."
        )
    if not zones:
        warnings.append(
            "No valid candidate zones were found (regions were too small, too "
            "narrow, or entirely inside the water buffer)."
        )
    if not isolated:
        warnings.append("No potentially isolated land regions were detected.")

    return {
        "success": True,
        "analysis_mode": dict(config.ANALYSIS_MODE),
        "image_info": {
            "original_width": prepared.original_size[0],
            "original_height": prepared.original_size[1],
            "processed_width": prepared.processed_size[0],
            "processed_height": prepared.processed_size[1],
            "scale": round(prepared.scale, 4),
        },
        "parameters": {
            "water_buffer_px": masks.buffer_size,
            "min_region_area_px": config.MIN_REGION_AREA,
            "min_isolated_area_px": config.MIN_ISOLATED_AREA,
            "max_zones": config.MAX_ZONES,
            "score_weights": {
                "area": config.SCORE_WEIGHT_AREA,
                "water_clearance": config.SCORE_WEIGHT_WATER_CLEARANCE,
                "openness": config.SCORE_WEIGHT_OPENNESS,
            },
        },
        "metrics": {
            "water_percentage": water.water_percentage,
            "non_water_percentage": non_water_percentage,
            "candidate_regions": len(regions),
            "isolated_regions": len(isolated),
            "candidate_area_percentage": round(
                100.0 * masks.candidate_pixels / float(image_area), 2
            ),
        },
        "zones": [
            {
                "id": zone.zone_id,
                "score": zone.final_score,
                "classification": zone.classification,
                "pixel_area": zone.region.pixel_area,
                "water_clearance": zone.region.water_clearance_px,
                "region_clearance": zone.region.region_clearance_px,
                "bounding_box": {
                    "x": zone.region.bbox_x,
                    "y": zone.region.bbox_y,
                    "width": zone.region.width,
                    "height": zone.region.height,
                },
                "centroid": {
                    "x": round(zone.region.centroid_x, 1),
                    "y": round(zone.region.centroid_y, 1),
                },
                "drop_point": {"x": zone.region.drop_x, "y": zone.region.drop_y},
                "score_breakdown": {
                    "area_score": zone.area_score,
                    "water_clearance_score": zone.water_clearance_score,
                    "openness_score": zone.openness_score,
                },
            }
            for zone in zones
        ],
        "isolated_regions": [
            {
                "id": region.region_id,
                "isolation_score": region.isolation_score,
                "classification": region.classification,
                "pixel_area": region.pixel_area,
                "bounding_box": {
                    "x": region.bbox_x,
                    "y": region.bbox_y,
                    "width": region.width,
                    "height": region.height,
                },
                "centroid": {
                    "x": round(region.centroid_x, 1),
                    "y": round(region.centroid_y, 1),
                },
                "score_breakdown": {
                    "water_contact_ratio": region.water_contact_ratio,
                    "separation_px": region.separation_px,
                    "relative_size": region.relative_size,
                },
            }
            for region in isolated
        ],
        "warnings": warnings,
        "images": images,
        "notice": (
            "Decision-support prototype. Outputs are candidate regions derived "
            "from image heuristics only and must be verified by trained "
            "personnel. No safety, landing or rescue claim is made."
        ),
    }
