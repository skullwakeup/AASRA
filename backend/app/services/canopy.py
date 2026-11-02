"""
Tree-canopy mask.

Without it, the only land the water detector separated reliably was
vegetation, so ranked zones and their circles sat on dense tree tops — the one
kind of land where nothing dropped from the air reaches the ground.

    VEGETATION COLOUR   green hue band OR excess-green index
      x  TEXTURE        local luminance std-dev (crowns, gaps and shadows)
      -> REGION SMOOTHING   canopy is a property of an area, not a pixel
      -> THRESHOLD + MORPHOLOGY + SMALL-BLOB REMOVAL
      -> CANOPY MASK (255 = tree canopy), never overlapping water

Smooth vegetation (lawns, crop fields) is mostly kept as open land because it
lacks canopy texture. Canopy pixels are excluded from candidate land, from the
Probable Smart Sensor Drop Zones and from the Probable Supply Drop Zone. They
still count as land for isolation.

A heuristic, not a trained classifier: hedges, grass verges between roads and
very dark fields can be misread.
"""

from __future__ import annotations

import cv2
import numpy as np

from .. import config
from .water_detection import _band, _local_std, _ramp_up


def detect_canopy(display_bgr: np.ndarray, water_mask: np.ndarray) -> np.ndarray:
    """uint8 mask, 255 = tree canopy (never on detected water)."""
    if not config.EXCLUDE_CANOPY:
        return np.zeros(water_mask.shape, dtype=np.uint8)

    smoothed = cv2.GaussianBlur(display_bgr, (5, 5), 0)
    hsv = cv2.cvtColor(smoothed, cv2.COLOR_BGR2HSV)
    hue = hsv[:, :, 0].astype(np.float32)
    sat = hsv[:, :, 1].astype(np.float32)
    blue, green, red = [c.astype(np.float32) for c in cv2.split(smoothed)]

    by_hue = np.minimum(
        _band(hue, config.VEGETATION_HUE_MIN, config.VEGETATION_HUE_MAX, 6.0),
        _ramp_up(sat, config.CANOPY_MIN_SATURATION - 15, config.CANOPY_MIN_SATURATION),
    )
    excess_green = (2.0 * green - red - blue) / np.maximum(blue + green + red, 1.0)
    by_index = _ramp_up(excess_green, config.VEGETATION_EXG_MIN, config.VEGETATION_EXG_MAX)
    vegetation = np.maximum(by_hue, by_index)

    gray = cv2.cvtColor(display_bgr, cv2.COLOR_BGR2GRAY)
    texture = _ramp_up(
        _local_std(gray, config.CANOPY_TEXTURE_WINDOW),
        config.CANOPY_TEXTURE_MIN_STD,
        config.CANOPY_TEXTURE_MAX_STD,
    )

    w = config.CANOPY_SMOOTH_WINDOW
    evidence = cv2.blur(vegetation * texture, (w, w))
    mask = np.where(evidence >= config.CANOPY_THRESHOLD, 255, 0).astype(np.uint8)

    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k)

    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    keep = np.zeros(count, dtype=bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= config.CANOPY_MIN_AREA
    mask = np.where(keep[labels], 255, 0).astype(np.uint8)

    mask[water_mask > 0] = 0
    return mask
