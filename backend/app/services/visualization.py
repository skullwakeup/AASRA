"""
Phase 12 — visualisations.

Produces five real images, each returned as a base64-encoded PNG string:

  1. original            — the resized upload, untouched
  2. water_mask          — detected water filled over a dimmed copy of the
                           scene, so the mask can be judged against what is
                           actually in the image
  3. candidate_mask      — binary candidate-region mask (white = candidate)
  4. isolated_regions    — potentially isolated land regions outlined + labelled
  5. final_analysis      — combined overlay: water tint, candidate boundaries,
                           zone number + score, candidate drop point, and
                           potentially isolated land regions

Every drawing happens on a copy. The uploaded image is never modified.
Wording on the overlays stays advisory: "Potential Supply-Drop Zone",
"Candidate Zone", "Potentially Isolated Land Region". Never "safe".
"""

from __future__ import annotations

import base64
from typing import Dict, List, Optional, Sequence

import cv2
import numpy as np

from .. import config
from .isolated_regions import IsolatedRegion
from .scoring import ScoredZone

# BGR colours
COLOR_WATER = (200, 90, 20)
COLOR_ZONE = (60, 220, 60)
COLOR_ZONE_OTHER = (150, 150, 150)
COLOR_DROP_POINT = (0, 215, 255)
COLOR_ISOLATED = (0, 140, 255)
COLOR_TEXT = (255, 255, 255)
COLOR_TEXT_BG = (30, 30, 30)

FONT = cv2.FONT_HERSHEY_SIMPLEX

DISCLAIMER = "AASRA prototype - candidate zones only. Not a safety assessment."


def encode_png_base64(image: np.ndarray) -> str:
    """Encode a BGR (or single-channel) image as a base64 PNG string."""
    params = [int(cv2.IMWRITE_PNG_COMPRESSION), config.PNG_COMPRESSION]
    success, buffer = cv2.imencode(".png", image, params)
    if not success:
        return ""
    return base64.b64encode(buffer.tobytes()).decode("ascii")


def _mask_to_bgr(mask: np.ndarray) -> np.ndarray:
    """Binary mask -> 3-channel black/white image for display."""
    return cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)


def _draw_label(
    image: np.ndarray,
    text: str,
    origin: Sequence[int],
    scale: float = 0.45,
    thickness: int = 1,
    bg_color=COLOR_TEXT_BG,
) -> None:
    """Draw text with a filled background box so it stays readable."""
    x, y = int(origin[0]), int(origin[1])
    (tw, th), baseline = cv2.getTextSize(text, FONT, scale, thickness)
    x = max(2, min(x, image.shape[1] - tw - 4))
    y = max(th + 4, min(y, image.shape[0] - 4))
    cv2.rectangle(
        image, (x - 2, y - th - 3), (x + tw + 2, y + baseline), bg_color, cv2.FILLED
    )
    cv2.putText(image, text, (x, y), FONT, scale, COLOR_TEXT, thickness, cv2.LINE_AA)


def render_water_mask(display_bgr: np.ndarray, water_mask: np.ndarray) -> np.ndarray:
    """Water mask drawn over a dimmed copy of the scene.

    A bare black/white mask shows *what* was detected but not *whether it was
    right*. Keeping the scene visible underneath makes it possible to see at a
    glance whether muddy floodwater was picked up and whether brown land, roof
    tiles or roads were wrongly included — which a binary mask cannot show.
    """
    gray = cv2.cvtColor(display_bgr, cv2.COLOR_BGR2GRAY)
    canvas = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    # Dim the backdrop so the water fill reads as the subject.
    canvas = (canvas * 0.55).astype(np.uint8)

    fill = canvas.copy()
    fill[water_mask > 0] = COLOR_WATER
    canvas = cv2.addWeighted(fill, 0.75, canvas, 0.25, 0)

    contours, _ = cv2.findContours(
        water_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    cv2.drawContours(canvas, contours, -1, COLOR_TEXT, 1, cv2.LINE_AA)

    if not np.any(water_mask):
        _draw_label(canvas, "No water detected", (8, 20))

    _draw_label(canvas, DISCLAIMER, (8, canvas.shape[0] - 8), scale=0.4)
    return canvas


def _component_mask_at(labels: np.ndarray, x: int, y: int) -> Optional[np.ndarray]:
    """Isolate the connected component containing pixel (x, y)."""
    if not (0 <= y < labels.shape[0] and 0 <= x < labels.shape[1]):
        return None
    label = int(labels[y, x])
    if label == 0:
        return None
    mask = np.zeros(labels.shape, dtype=np.uint8)
    mask[labels == label] = 255
    return mask


def _draw_drop_point(image: np.ndarray, x: int, y: int) -> None:
    cv2.circle(image, (x, y), 9, COLOR_DROP_POINT, 2, cv2.LINE_AA)
    cv2.line(image, (x - 14, y), (x - 4, y), COLOR_DROP_POINT, 2, cv2.LINE_AA)
    cv2.line(image, (x + 4, y), (x + 14, y), COLOR_DROP_POINT, 2, cv2.LINE_AA)
    cv2.line(image, (x, y - 14), (x, y - 4), COLOR_DROP_POINT, 2, cv2.LINE_AA)
    cv2.line(image, (x, y + 4), (x, y + 14), COLOR_DROP_POINT, 2, cv2.LINE_AA)


def render_isolated_regions(
    display_bgr: np.ndarray,
    water_mask: np.ndarray,
    regions: List[IsolatedRegion],
) -> np.ndarray:
    """Outline and label potentially isolated land regions over a water tint."""
    canvas = display_bgr.copy()

    # Tint detected water so the isolation context is visible.
    overlay = canvas.copy()
    overlay[water_mask > 0] = COLOR_WATER
    canvas = cv2.addWeighted(overlay, 0.35, canvas, 0.65, 0)

    for region in regions:
        x, y, w, h = region.bbox_x, region.bbox_y, region.width, region.height
        cv2.rectangle(canvas, (x, y), (x + w, y + h), COLOR_ISOLATED, 2, cv2.LINE_AA)
        _draw_label(
            canvas,
            f"Isolated #{region.region_id} {region.isolation_score:.0f} "
            f"{region.classification.split()[0]}",
            (x, max(14, y - 6)),
        )

    if not regions:
        _draw_label(canvas, "No potentially isolated land regions detected", (8, 20))

    _draw_label(canvas, DISCLAIMER, (8, canvas.shape[0] - 8), scale=0.4)
    return canvas


def render_final_analysis(
    display_bgr: np.ndarray,
    water_mask: np.ndarray,
    candidate_mask: np.ndarray,
    zones: List[ScoredZone],
    isolated: List[IsolatedRegion],
) -> np.ndarray:
    """Composite overlay used as the main result image."""
    canvas = display_bgr.copy()

    # 1. Water tint
    overlay = canvas.copy()
    overlay[water_mask > 0] = COLOR_WATER
    canvas = cv2.addWeighted(overlay, 0.40, canvas, 0.60, 0)

    # 2. All candidate regions faintly outlined
    contours, _ = cv2.findContours(
        candidate_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    cv2.drawContours(canvas, contours, -1, COLOR_ZONE_OTHER, 1, cv2.LINE_AA)

    # 3. Potentially isolated land regions
    for region in isolated:
        x, y, w, h = region.bbox_x, region.bbox_y, region.width, region.height
        cv2.rectangle(canvas, (x, y), (x + w, y + h), COLOR_ISOLATED, 2, cv2.LINE_AA)
        _draw_label(
            canvas, f"Isolated #{region.region_id} ({region.isolation_score:.0f})",
            (x, max(14, y - 6)), scale=0.4,
        )

    # 4. Ranked zones: boundary, label, drop point
    _, labels = cv2.connectedComponents(candidate_mask, connectivity=8)
    for zone in zones:
        region = zone.region
        component = _component_mask_at(labels, region.drop_x, region.drop_y)
        if component is not None:
            zone_contours, _ = cv2.findContours(
                component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )
            cv2.drawContours(canvas, zone_contours, -1, COLOR_ZONE, 2, cv2.LINE_AA)

        _draw_drop_point(canvas, region.drop_x, region.drop_y)
        _draw_label(
            canvas,
            f"Zone {zone.zone_id} | {zone.final_score:.1f} | {zone.classification}",
            (region.drop_x - 40, region.drop_y - 18),
            scale=0.45,
        )

    if not zones:
        _draw_label(canvas, "No valid candidate zones found", (8, 20))

    _draw_label(canvas, DISCLAIMER, (8, canvas.shape[0] - 8), scale=0.4)
    return canvas


def build_visualizations(
    display_bgr: np.ndarray,
    water_mask: np.ndarray,
    candidate_mask: np.ndarray,
    zones: List[ScoredZone],
    isolated: List[IsolatedRegion],
) -> Dict[str, str]:
    """Build all five visualisations as base64 PNG strings."""
    if not config.INCLUDE_IMAGES:
        return {
            key: ""
            for key in (
                "original",
                "water_mask",
                "candidate_mask",
                "isolated_regions",
                "final_analysis",
            )
        }

    return {
        "original": encode_png_base64(display_bgr),
        "water_mask": encode_png_base64(render_water_mask(display_bgr, water_mask)),
        "candidate_mask": encode_png_base64(_mask_to_bgr(candidate_mask)),
        "isolated_regions": encode_png_base64(
            render_isolated_regions(display_bgr, water_mask, isolated)
        ),
        "final_analysis": encode_png_base64(
            render_final_analysis(
                display_bgr, water_mask, candidate_mask, zones, isolated
            )
        ),
    }
