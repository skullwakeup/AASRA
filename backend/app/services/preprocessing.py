"""
Phase 2 — image loading and preprocessing.

Responsibilities:
  * decode uploaded bytes into a BGR numpy array
  * validate that the image is readable and large enough
  * resize while preserving aspect ratio (longest edge -> MAX_IMAGE_DIMENSION)
  * build a separate *analysis copy* (optional Gaussian blur + CLAHE)

The uploaded image is never modified in place. `PreprocessResult` keeps the
original decoded image and the resized "display" image alongside the analysis
copy, so visualisations are drawn on a clean picture.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple

import cv2
import numpy as np

from .. import config


class ImageDecodeError(ValueError):
    """Raised when the uploaded bytes cannot be decoded as an image."""


class ImageTooSmallError(ValueError):
    """Raised when the decoded image is below MIN_IMAGE_DIMENSION."""


@dataclass
class PreprocessResult:
    """Container for every image variant the pipeline needs."""

    original_bgr: np.ndarray  # decoded upload, untouched
    display_bgr: np.ndarray  # resized copy used for drawing overlays
    analysis_bgr: np.ndarray  # resized + optionally blurred/CLAHE'd
    scale: float  # display/analysis size relative to original
    original_size: Tuple[int, int]  # (width, height) of the upload
    processed_size: Tuple[int, int]  # (width, height) after resizing


def decode_image(data: bytes) -> np.ndarray:
    """Decode raw upload bytes into a 3-channel BGR image.

    Raises ImageDecodeError for empty/corrupt data.
    """
    if not data:
        raise ImageDecodeError("The uploaded file is empty.")

    buffer = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if image is None or image.size == 0:
        raise ImageDecodeError("The uploaded file could not be read as an image.")

    # cv2.IMREAD_COLOR already yields 3-channel BGR; guard anyway.
    if image.ndim == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    elif image.shape[2] == 4:
        image = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)

    return image


def resize_preserving_aspect(
    image: np.ndarray, max_dimension: int = config.MAX_IMAGE_DIMENSION
) -> Tuple[np.ndarray, float]:
    """Downscale so the longest edge equals `max_dimension`.

    Images already within the limit are returned unchanged (scale = 1.0).
    Returns (resized_image, scale_factor).
    """
    height, width = image.shape[:2]
    longest = max(height, width)
    if longest <= max_dimension:
        return image.copy(), 1.0

    scale = max_dimension / float(longest)
    new_size = (max(1, int(round(width * scale))), max(1, int(round(height * scale))))
    resized = cv2.resize(image, new_size, interpolation=cv2.INTER_AREA)
    return resized, scale


def to_rgb(image_bgr: np.ndarray) -> np.ndarray:
    """BGR -> RGB (helper for any consumer expecting RGB ordering)."""
    return cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)


def _build_analysis_copy(image_bgr: np.ndarray) -> np.ndarray:
    """Light enhancement used *only* for detection, never for display.

    Deliberately conservative: a small Gaussian blur to suppress sensor noise
    and a modest CLAHE pass on the LAB L-channel so that shadowed water is not
    crushed to black. Over-processing destroys the colour relationships the
    water heuristic relies on.
    """
    analysis = image_bgr.copy()

    if config.USE_GAUSSIAN_BLUR:
        k = config.GAUSSIAN_KERNEL_SIZE
        if k % 2 == 0:  # kernel must be odd
            k += 1
        analysis = cv2.GaussianBlur(analysis, (k, k), 0)

    if config.USE_CLAHE:
        lab = cv2.cvtColor(analysis, cv2.COLOR_BGR2LAB)
        l_channel, a_channel, b_channel = cv2.split(lab)
        clahe = cv2.createCLAHE(
            clipLimit=config.CLAHE_CLIP_LIMIT,
            tileGridSize=(config.CLAHE_TILE_GRID_SIZE, config.CLAHE_TILE_GRID_SIZE),
        )
        l_channel = clahe.apply(l_channel)
        analysis = cv2.cvtColor(cv2.merge((l_channel, a_channel, b_channel)), cv2.COLOR_LAB2BGR)

    return analysis


def preprocess(data: bytes) -> PreprocessResult:
    """Full Phase-2 entry point: bytes -> PreprocessResult."""
    original = decode_image(data)
    height, width = original.shape[:2]

    if min(height, width) < config.MIN_IMAGE_DIMENSION:
        raise ImageTooSmallError(
            f"Image is too small to analyse (minimum {config.MIN_IMAGE_DIMENSION}px per side)."
        )

    display, scale = resize_preserving_aspect(original)
    analysis = _build_analysis_copy(display)

    return PreprocessResult(
        original_bgr=original,
        display_bgr=display,
        analysis_bgr=analysis,
        scale=scale,
        original_size=(width, height),
        processed_size=(display.shape[1], display.shape[0]),
    )
