"""
Phases 4 & 5 — water safety buffer and candidate region mask.

    WATER MASK
      -> MORPHOLOGICAL DILATION  (radius = WATER_BUFFER_SIZE)
      -> WATER SAFETY BUFFER

    NonWaterMask  = NOT WaterMask
    CandidateMask = NonWaterMask AND NOT WaterBuffer

The buffer is expressed in PIXELS of the processed image. It is spatial
clearance only — it does not represent metres and implies nothing about safety.

There is no obstacle detection yet (buildings, trees, power lines, vehicles are
NOT detected), so a candidate region is only "not water and not close to water".
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .. import config


@dataclass
class CandidateMaskResult:
    non_water_mask: np.ndarray  # uint8, 255 = land
    water_buffer_mask: np.ndarray  # uint8, 255 = water + buffer ring
    candidate_mask: np.ndarray  # uint8, 255 = candidate region
    buffer_size: int
    candidate_pixels: int


def build_water_buffer(water_mask: np.ndarray, buffer_size: int | None = None) -> np.ndarray:
    """Dilate the water mask by `buffer_size` pixels (elliptical kernel)."""
    size = config.WATER_BUFFER_SIZE if buffer_size is None else buffer_size
    if size <= 0:
        return water_mask.copy()
    k = 2 * size + 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    return cv2.dilate(water_mask, kernel, iterations=1)


def build_candidate_mask(water_mask: np.ndarray, buffer_size: int | None = None) -> CandidateMaskResult:
    """Produce the non-water, water-buffer and candidate masks."""
    size = config.WATER_BUFFER_SIZE if buffer_size is None else buffer_size

    non_water = cv2.bitwise_not(water_mask)
    buffer_mask = build_water_buffer(water_mask, size)

    # CandidateMask = NonWater AND NOT WaterBuffer
    candidate = cv2.bitwise_and(non_water, cv2.bitwise_not(buffer_mask))

    # Light cleanup: remove ragged fringes, then close pinholes.
    k = config.CANDIDATE_MORPH_KERNEL
    if k >= 3:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
        candidate = cv2.morphologyEx(candidate, cv2.MORPH_OPEN, kernel)
        candidate = cv2.morphologyEx(candidate, cv2.MORPH_CLOSE, kernel)

    return CandidateMaskResult(
        non_water_mask=non_water,
        water_buffer_mask=buffer_mask,
        candidate_mask=candidate,
        buffer_size=size,
        candidate_pixels=int(np.count_nonzero(candidate)),
    )
