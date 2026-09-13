"""
Phase 3 — floodwater detection (primary detector).

This is a *heuristic* detector, not a trained model. It deliberately avoids the
naive "blue pixels are water" rule, because floodwater in aerial imagery is
frequently brown/muddy, dark, grey or specular.

Pipeline
--------
    IMAGE
      -> COLOUR CUES        (graded: blue, turbid/muddy, dark, low-saturation)
      -> SUPPORT CUES       (graded: chroma homogeneity, smoothness, edge freedom)
      -> MULTIPLICATIVE GATING              (colour x support, per-cue floors)
      -> VEGETATION PENALTY
      -> COMBINED WATER MASK                (threshold on likelihood)
      -> MORPHOLOGICAL CLEANUP              (open, close, hole fill)
      -> CONNECTED COMPONENT FILTERING      (drop tiny blobs)
      -> REGION-LEVEL VERIFICATION          (reject weakly supported small blobs)
      -> FINAL WATER MASK                   (255 = water, 0 = non-water)

Why colour is gated rather than summed
--------------------------------------
Brown is not a water colour — it is a colour that muddy water, soil, dirt
roads, roof tiles and dry terrain all share. So colour alone can never make a
pixel water here. Each colour cue is multiplied by a *support* term built from
three independent image measurements, and each cue carries a floor saying how
much it is trusted without support: blue-dominant water is specific enough to
stand nearly alone, while brown is given almost no standing of its own.

The support cues measure surface behaviour rather than colour:

  * chromatic homogeneity — a water body carries one sediment colour across its
    whole extent, so its colour stays constant even where waves change its
    brightness. Soil, tile and vegetation vary in colour at small scale. This is
    the single most useful muddy-water / brown-land discriminator obtainable
    from RGB alone.
  * luminance smoothness — supporting only; disturbed water is not smooth.
  * freedom from structural edges — built and cultivated land carries long
    coherent edges; open water does not.

No cue is decisive alone, and none is a probability: every term is a
deterministic, monotonic mapping of a measured quantity onto 0..1.

Accuracy is not guaranteed: shadows, wet roofs, asphalt and dark vegetation can
all be misread. Treat every output as a candidate requiring human verification.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict

import cv2
import numpy as np

from .. import config


@dataclass
class WaterDetectionResult:
    """Final water mask plus the intermediate evidence used to build it."""

    mask: np.ndarray  # uint8, 255 = water
    evidence: np.ndarray  # float32 water likelihood map, 0..1
    candidate_fractions: Dict[str, float] = field(default_factory=dict)
    water_pixels: int = 0
    water_percentage: float = 0.0
    #: float32 0..1 map of how water-like each pixel's *surface* behaves,
    #: independent of its colour. Diagnostic; downstream code does not read it.
    support: np.ndarray | None = None


# ---------------------------------------------------------------------------
# Graded membership helpers
#
# Each returns a float32 array in 0..1. They exist so that no cue is a hard
# yes/no: a pixel just past a threshold degrades smoothly instead of flipping,
# which is what made the previous single-threshold design brittle.
# ---------------------------------------------------------------------------


def _ramp_up(values: np.ndarray, low: float, high: float) -> np.ndarray:
    """0 at or below `low`, 1 at or above `high`, linear in between."""
    if high <= low:
        return (values >= high).astype(np.float32)
    return np.clip((values - low) / (high - low), 0.0, 1.0).astype(np.float32)


def _ramp_down(values: np.ndarray, low: float, high: float) -> np.ndarray:
    """1 at or below `low`, 0 at or above `high`, linear in between."""
    return 1.0 - _ramp_up(values, low, high)


def _band(
    values: np.ndarray, low: float, high: float, softness: float
) -> np.ndarray:
    """1 inside [low, high], falling to 0 over `softness` units either side."""
    return np.minimum(
        _ramp_up(values, low - softness, low),
        _ramp_down(values, high, high + softness),
    )


def _local_std(gray: np.ndarray, window: int) -> np.ndarray:
    """Local standard deviation via box filters (fast texture estimate).

    std = sqrt(E[x^2] - E[x]^2) over a `window` x `window` neighbourhood.
    Water surfaces are typically far smoother than vegetation or built-up land.
    """
    g = gray.astype(np.float32)
    mean = cv2.boxFilter(g, ddepth=-1, ksize=(window, window), normalize=True)
    mean_sq = cv2.boxFilter(g * g, ddepth=-1, ksize=(window, window), normalize=True)
    variance = np.maximum(mean_sq - mean * mean, 0.0)
    return np.sqrt(variance)


def _fill_small_holes(mask: np.ndarray, max_hole_area: int) -> np.ndarray:
    """Fill background holes inside the mask that are smaller than max_hole_area."""
    inverted = cv2.bitwise_not(mask)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(inverted, connectivity=8)
    filled = mask.copy()
    for label in range(1, count):
        if stats[label, cv2.CC_STAT_AREA] <= max_hole_area:
            # A hole touching the image border is open background, not a hole.
            x = stats[label, cv2.CC_STAT_LEFT]
            y = stats[label, cv2.CC_STAT_TOP]
            w = stats[label, cv2.CC_STAT_WIDTH]
            h = stats[label, cv2.CC_STAT_HEIGHT]
            if x == 0 or y == 0 or x + w >= mask.shape[1] or y + h >= mask.shape[0]:
                continue
            filled[labels == label] = 255
    return filled


def _remove_small_components(mask: np.ndarray, min_area: int) -> np.ndarray:
    """Drop connected components below min_area pixels."""
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    cleaned = np.zeros_like(mask)
    for label in range(1, count):
        if stats[label, cv2.CC_STAT_AREA] >= min_area:
            cleaned[labels == label] = 255
    return cleaned


def _chroma_variation(image_bgr: np.ndarray, window: int) -> np.ndarray:
    """Local colour instability: local std of the Lab a* and b* channels.

    Lab's a*/b* carry chromaticity almost independently of lightness, so this
    measures how much the *colour* wobbles over a neighbourhood while ignoring
    how much the brightness does. A sediment-laden water body scores low across
    its whole extent even where its surface is disturbed; roof tiles, soil and
    vegetation score high because their colour changes from pixel to pixel.
    """
    lab = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2LAB)
    return _local_std(lab[:, :, 1], window) + _local_std(lab[:, :, 2], window)


def _edge_density(gray: np.ndarray) -> np.ndarray:
    """Fraction of Canny edge pixels in each neighbourhood (0..1).

    Structural content, not texture: buildings, roads and field boundaries
    produce long coherent edges, open water produces few.
    """
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(blurred, config.EDGE_CANNY_LOW, config.EDGE_CANNY_HIGH)
    return cv2.boxFilter(
        (edges > 0).astype(np.float32),
        ddepth=-1,
        ksize=(config.EDGE_DENSITY_WINDOW, config.EDGE_DENSITY_WINDOW),
        normalize=True,
    )


def _build_support_map(image_bgr: np.ndarray, gray: np.ndarray) -> np.ndarray:
    """Combine the three colour-independent cues into one 0..1 support map.

    This map answers "does this pixel's surface behave like water?" without
    looking at what colour it is, which is precisely the question that
    separates muddy water from brown land.
    """
    chroma_homogeneity = _ramp_down(
        _chroma_variation(image_bgr, config.CHROMA_WINDOW),
        config.CHROMA_HOMOGENEOUS_MIN,
        config.CHROMA_HOMOGENEOUS_MAX,
    )
    smoothness = _ramp_down(
        _local_std(gray, config.TEXTURE_WINDOW),
        config.TEXTURE_SMOOTH_MIN_STD,
        config.TEXTURE_SMOOTH_MAX_STD,
    )
    edge_freedom = _ramp_down(
        _edge_density(gray),
        config.EDGE_DENSITY_MIN,
        config.EDGE_DENSITY_MAX,
    )

    support = (
        config.SUPPORT_WEIGHT_CHROMA * chroma_homogeneity
        + config.SUPPORT_WEIGHT_SMOOTH * smoothness
        + config.SUPPORT_WEIGHT_EDGE * edge_freedom
    )
    return np.clip(support, 0.0, 1.0).astype(np.float32)


def _gate(strength: np.ndarray, support: np.ndarray, floor: float) -> np.ndarray:
    """Modulate a colour cue by the support map.

    `floor` is how much of the cue survives with no supporting evidence at all,
    i.e. how far that colour is trusted on its own.
    """
    return strength * (floor + (1.0 - floor) * support)


def _verify_regions(
    mask: np.ndarray, support: np.ndarray, image_area: int
) -> np.ndarray:
    """Re-check each connected component against the support map.

    Per-pixel decisions are noisy; a whole region carries far more evidence.
    A region is dropped only when it is BOTH weakly supported AND small, so
    smallness on its own never removes a genuine flooded pocket, and a large
    coherent body is kept on spatial-continuity grounds even if its mean
    support is modest.
    """
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if count <= 1:
        return mask

    verified = np.zeros_like(mask)
    large_area = config.REGION_LARGE_AREA_FRACTION * image_area

    # One pass over the label image instead of a boolean compare per region.
    mean_support = np.zeros(count, dtype=np.float64)
    np.add.at(mean_support, labels.ravel(), support.ravel())
    areas = np.bincount(labels.ravel(), minlength=count).astype(np.float64)
    mean_support /= np.maximum(areas, 1.0)

    keep = np.zeros(count, dtype=bool)
    for label in range(1, count):
        area = stats[label, cv2.CC_STAT_AREA]
        keep[label] = (
            area >= large_area
            or mean_support[label] >= config.REGION_MIN_MEAN_SUPPORT
        )

    verified[keep[labels]] = 255
    return verified


def detect_water(image_bgr: np.ndarray) -> WaterDetectionResult:
    """Run the multi-stage water heuristic on a BGR image.

    Returns a WaterDetectionResult whose `mask` is uint8 with 255 = water.
    """
    height, width = image_bgr.shape[:2]
    total_pixels = float(height * width)

    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    hue, sat, val = cv2.split(hsv)
    hue_f = hue.astype(np.float32)
    sat_f = sat.astype(np.float32)
    val_f = val.astype(np.float32)
    blue_c, green_c, red_c = cv2.split(image_bgr.astype(np.int16))
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)

    # ---- Colour-independent support ---------------------------------------
    # Built first: every colour cue below is gated by it.
    support = _build_support_map(image_bgr, gray)

    # ---- Stage A: blue / relatively clear water ---------------------------
    # Blue dominance works even when hue is unstable (dark or washed-out water),
    # so it is taken as the stronger of the two readings.
    # Hue alone is unreliable on near-grey surfaces: asphalt, slate roofs and
    # shadow all drift into the blue hue band while carrying no blue chroma at
    # all. Measured on real imagery, grey asphalt reads as "blue hue" with a
    # blue dominance of -7, i.e. its red channel is actually the strongest. So
    # both blue readings require the blue channel not to be beaten by red.
    blue_dominance = (blue_c - np.maximum(green_c, red_c)).astype(np.float32)
    not_red_dominated = _ramp_up(blue_dominance, -4.0, 2.0)

    blue_by_hue = np.minimum(
        _band(hue_f, config.BLUE_HUE_MIN, config.BLUE_HUE_MAX, 8.0),
        np.minimum(
            _ramp_up(sat_f, config.BLUE_MIN_SATURATION - 15, config.BLUE_MIN_SATURATION),
            _ramp_up(val_f, config.BLUE_MIN_VALUE - 15, config.BLUE_MIN_VALUE),
        ),
    )
    blue_by_hue = blue_by_hue * not_red_dominated

    blue_by_dominance = np.minimum(
        _ramp_up(blue_dominance, 0.0, float(config.BLUE_DOMINANCE_MIN)),
        _ramp_up(val_f, config.BLUE_MIN_VALUE - 15, config.BLUE_MIN_VALUE),
    )
    blue_strength = np.maximum(blue_by_hue, blue_by_dominance)

    # ---- Stage B: muddy / turbid brown water ------------------------------
    # Colour plausibility ONLY. On its own this fires on soil, dirt roads and
    # roof tiles just as readily as on floodwater, which is why its support
    # floor is the lowest of the four cues.
    turbid_strength = np.minimum(
        _band(hue_f, config.TURBID_HUE_MIN, config.TURBID_HUE_MAX, 6.0),
        np.minimum(
            _band(
                sat_f,
                config.TURBID_MIN_SATURATION,
                config.TURBID_MAX_SATURATION,
                20.0,
            ),
            _band(
                val_f, config.TURBID_MIN_VALUE, config.TURBID_MAX_VALUE, 20.0
            ),
        ),
    )

    # ---- Stage C: dark / shadowed water -----------------------------------
    dark_strength = np.minimum(
        _ramp_down(val_f, config.DARK_MAX_VALUE - 20, config.DARK_MAX_VALUE),
        _ramp_down(sat_f, config.DARK_MAX_SATURATION - 30, config.DARK_MAX_SATURATION),
    )

    # ---- Stage D: low saturation / sky-reflecting water -------------------
    low_sat_strength = np.minimum(
        _ramp_down(sat_f, config.LOW_SAT_MAX_SATURATION - 15, config.LOW_SAT_MAX_SATURATION),
        _band(val_f, config.LOW_SAT_MIN_VALUE, config.LOW_SAT_MAX_VALUE, 20.0),
    )

    # ---- Vegetation veto (common false positive) --------------------------
    # Hue band plus an excess-green index, which stays reliable where hue does
    # not (deep shade, over-exposed canopy).
    vegetation_by_hue = np.minimum(
        _band(hue_f, config.VEGETATION_HUE_MIN, config.VEGETATION_HUE_MAX, 6.0),
        _ramp_up(
            sat_f, config.VEGETATION_MIN_SATURATION - 15, config.VEGETATION_MIN_SATURATION
        ),
    )
    channel_sum = np.maximum(
        (blue_c + green_c + red_c).astype(np.float32), 1.0
    )
    excess_green = (
        2.0 * green_c - red_c - blue_c
    ).astype(np.float32) / channel_sum
    vegetation_by_index = _ramp_up(
        excess_green, config.VEGETATION_EXG_MIN, config.VEGETATION_EXG_MAX
    )
    vegetation = np.maximum(vegetation_by_hue, vegetation_by_index)

    # ---- Multiplicative combination ---------------------------------------
    # Each colour cue is scaled by the support map according to how much that
    # colour can be trusted alone. The strongest gated cue wins, so cues never
    # accumulate into water where none of them individually convinces.
    likelihood = np.maximum.reduce(
        [
            _gate(blue_strength, support, config.SUPPORT_FLOOR_BLUE),
            _gate(turbid_strength, support, config.SUPPORT_FLOOR_TURBID),
            _gate(dark_strength, support, config.SUPPORT_FLOOR_DARK),
            _gate(low_sat_strength, support, config.SUPPORT_FLOOR_LOW_SAT),
        ]
    )
    likelihood -= config.WATER_WEIGHT_VEGETATION_PENALTY * vegetation
    evidence = np.clip(likelihood, 0.0, 1.0).astype(np.float32)

    raw_mask = np.where(
        evidence >= config.WATER_LIKELIHOOD_THRESHOLD, 255, 0
    ).astype(np.uint8)

    # ---- Morphological cleanup -------------------------------------------
    open_k = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (config.WATER_MORPH_OPEN_KERNEL, config.WATER_MORPH_OPEN_KERNEL),
    )
    close_k = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (config.WATER_MORPH_CLOSE_KERNEL, config.WATER_MORPH_CLOSE_KERNEL),
    )
    cleaned = cv2.morphologyEx(raw_mask, cv2.MORPH_OPEN, open_k)
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, close_k)
    cleaned = _fill_small_holes(cleaned, config.MAX_WATER_HOLE_AREA)

    # ---- Connected component filtering ------------------------------------
    filtered = _remove_small_components(cleaned, config.MIN_WATER_COMPONENT_AREA)

    # ---- Region-level verification ----------------------------------------
    final_mask = _verify_regions(filtered, support, int(total_pixels))

    water_pixels = int(np.count_nonzero(final_mask))

    # Diagnostic only: the mean strength of each cue over the image. Reported
    # for tuning and inspection; no downstream component reads these.
    def _mean(values: np.ndarray) -> float:
        return float(values.mean())

    fractions = {
        "blue": _mean(blue_strength),
        "turbid": _mean(turbid_strength),
        "dark": _mean(dark_strength),
        "low_saturation": _mean(low_sat_strength),
        "support": _mean(support),
        "vegetation": _mean(vegetation),
    }

    return WaterDetectionResult(
        mask=final_mask,
        evidence=evidence,
        candidate_fractions=fractions,
        water_pixels=water_pixels,
        water_percentage=round(100.0 * water_pixels / total_pixels, 2),
        support=support,
    )


def non_water_mask(water_mask: np.ndarray) -> np.ndarray:
    """NonWaterMask = NOT WaterMask (uint8, 255 = land)."""
    return cv2.bitwise_not(water_mask)
