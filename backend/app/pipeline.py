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
      -> MAX-CLEARANCE POINT
      -> ZONE SCORING
      -> TOP N ZONES
      -> PROBABLE STORAGE ZONES   (centre = max-clearance point, valid radius)
      -> PROBABLE DROP ZONES      (sampled, filtered, scored inside each)

Every number in the response is derived from the uploaded image. Nothing is
fabricated, defaulted or randomised.
"""

from __future__ import annotations

from typing import Any, Dict

import numpy as np

from . import config
from .services import (
    ai_detection,
    candidate_mask,
    isolated_regions,
    preprocessing,
    region_analysis,
    scoring,
    storage_zones,
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
    masks = candidate_mask.build_candidate_mask(water.mask)

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

    # -- Phase 11b: probable storage zones and probable drop zones ----------
    # Reuses the same water mask, water buffer and candidate mask; each
    # storage centre is the ranked zone's existing max-clearance point.
    storage = storage_zones.analyse_storage_zones(
        zones=zones,
        candidate_mask=masks.candidate_mask,
        water_mask=water.mask,
        prohibited_mask=masks.water_buffer_mask,
        water_distance=region_analysis.water_distance_map(water.mask),
    )
    zones_by_id = {zone.zone_id: zone for zone in zones}
    drop_zone_count = sum(len(s.drop_zones) for s in storage.storage_zones)

    # -- Phase 12: visualisations ------------------------------------------
    want_images = include_images and config.INCLUDE_IMAGES
    if want_images:
        images = visualization.build_visualizations(
            display_bgr=prepared.display_bgr,
            water_mask=water.mask,
            buffer_mask=masks.water_buffer_mask,
            candidate_mask=masks.candidate_mask,
            zones=zones,
            storage=storage,
            isolated=isolated,
        )
    else:
        images = {key: "" for key in visualization.IMAGE_KEYS}

    # -- Optional AI supplement: supplementary object detection context -----
    # Independent of, and never fused into, the OpenCV pipeline above. This
    # never raises — on any failure (onnxruntime missing, model file missing
    # or unreadable, inference error, out of memory) it degrades to
    # analysis_mode.ai = False and the OpenCV results are unaffected.
    ai_result = ai_detection.get_object_context(
        prepared.display_bgr, build_visualization=want_images
    )
    images["ai_context"] = ai_detection.encode_visualization(ai_result)

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
    if zones and not storage.storage_zones:
        warnings.append(
            "Candidate zones were found, but none had enough clearance for a "
            f"probable storage zone (minimum radius {config.MIN_STORAGE_RADIUS_PX} px)."
        )
    if not isolated:
        warnings.append("No potentially isolated land regions were detected.")

    return {
        "success": True,
        "analysis_mode": {"opencv": True, "ai": ai_result.success},
        "ai": ai_detection.to_response_dict(ai_result),
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
            "storage": {
                "radius_margin_px": config.STORAGE_RADIUS_MARGIN_PX,
                "min_radius_px": config.MIN_STORAGE_RADIUS_PX,
                "max_radius_px": config.MAX_STORAGE_RADIUS_PX,
                "drop_zone_radius_px": config.DROP_POINT_MIN_CLEARANCE_PX,
                "min_drop_point_distance_px": max(
                    config.MIN_DROP_POINT_DISTANCE_PX,
                    2 * config.DROP_POINT_MIN_CLEARANCE_PX,
                ),
                "max_drop_points_per_storage_zone": config.MAX_DROP_POINTS_PER_STORAGE_ZONE,
                "drop_score_weights": {
                    "clearance": config.DROP_SCORE_WEIGHT_CLEARANCE,
                    "water_clearance": config.DROP_SCORE_WEIGHT_WATER_CLEARANCE,
                    "proximity": config.DROP_SCORE_WEIGHT_PROXIMITY,
                },
            },
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
            "storage_zones": len(storage.storage_zones),
            "drop_zones": drop_zone_count,
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
        "storage_zones": [
            storage_zones.storage_to_dict(s, zones_by_id[s.zone_id])
            for s in storage.storage_zones
        ],
        "storage_analysis": {
            "evaluated": len(zones),
            "viable": len(storage.storage_zones),
            "not_viable": [
                {"zone_id": item.zone_id, "reason": item.reason, "radius_px": item.radius_px}
                for item in storage.not_viable
            ],
        },
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
            "Computer-vision decision-support prototype. Storage and drop zones "
            "are probable locations derived from image geometry only, in image "
            "pixels, and must be verified by trained personnel on the ground. "
            "No safety, landing, access or rescue claim is made."
        ),
    }
