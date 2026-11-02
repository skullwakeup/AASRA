"""
Phases 10 & 11 — transparent zone scoring and ranking.

Every candidate region receives a 0-100 score built from three normalised,
fully deterministic sub-scores. No random numbers, no hidden constants.

    area_score            = 100 * min(1, region_area_fraction / AREA_SCORE_SATURATION_FRACTION)
                            where region_area_fraction = pixel_area / processed image area.
                            A region covering >= 6% of the frame saturates at 100.

    water_clearance_score = 100 * min(1, water_clearance_px / CLEARANCE_SCORE_SATURATION_PX)
                            water_clearance_px is the pixel distance from the
                            zone's max-clearance point to the nearest detected water
                            pixel. PIXELS, NOT METRES.

    openness_score        = 100 * openness   (see region_analysis._compute_openness)

    FINAL SCORE = 0.40*area_score + 0.40*water_clearance_score + 0.20*openness_score

Bands: 80-100 HIGH POTENTIAL, 60-79 MODERATE POTENTIAL,
       40-59 LOW POTENTIAL, below 40 NOT RECOMMENDED.

The word "safe" is never used. A high score means the region looks large, open
and far from detected water in this image — nothing more.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

from .. import config
from .region_analysis import CandidateRegion


@dataclass
class ScoredZone:
    zone_id: int
    region: CandidateRegion
    area_score: float
    water_clearance_score: float
    openness_score: float
    final_score: float
    classification: str


def classify_score(score: float) -> str:
    """Map a 0-100 zone score onto its potential band."""
    if score >= config.SCORE_HIGH_MIN:
        return "HIGH POTENTIAL"
    if score >= config.SCORE_MODERATE_MIN:
        return "MODERATE POTENTIAL"
    if score >= config.SCORE_LOW_MIN:
        return "LOW POTENTIAL"
    return "NOT RECOMMENDED"


def _clamp_percent(value: float) -> float:
    return float(min(100.0, max(0.0, value)))


def score_region(region: CandidateRegion, image_area: int) -> ScoredZone:
    """Score a single candidate region (zone_id assigned later by ranking)."""
    area_fraction = region.pixel_area / float(max(1, image_area))
    area_score = _clamp_percent(
        100.0 * min(1.0, area_fraction / config.AREA_SCORE_SATURATION_FRACTION)
    )

    water_clearance_score = _clamp_percent(
        100.0
        * min(1.0, region.water_clearance_px / config.CLEARANCE_SCORE_SATURATION_PX)
    )

    openness_score = _clamp_percent(100.0 * region.openness)

    final_score = _clamp_percent(
        config.SCORE_WEIGHT_AREA * area_score
        + config.SCORE_WEIGHT_WATER_CLEARANCE * water_clearance_score
        + config.SCORE_WEIGHT_OPENNESS * openness_score
    )

    return ScoredZone(
        zone_id=region.region_id,
        region=region,
        area_score=round(area_score, 1),
        water_clearance_score=round(water_clearance_score, 1),
        openness_score=round(openness_score, 1),
        final_score=round(final_score, 1),
        classification=classify_score(final_score),
    )


def rank_zones(
    regions: List[CandidateRegion],
    image_area: int,
    max_zones: int | None = None,
) -> List[ScoredZone]:
    """Score every region, sort by score and return the top `max_zones`."""
    limit = config.MAX_ZONES if max_zones is None else max_zones

    scored = [score_region(region, image_area) for region in regions]
    scored.sort(key=lambda z: z.final_score, reverse=True)

    top = scored[: max(0, limit)]
    for index, zone in enumerate(top, start=1):
        zone.zone_id = index  # renumber 1..N in ranked order
    return top
