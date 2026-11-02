"""
Phase 12 — visualisations.

Produces seven real images, each returned as a base64-encoded PNG string:

  1. original            — the resized upload, untouched
  2. water_mask          — detected water filled over a dimmed copy of the
                           scene, so the mask can be judged against the image
  3. candidate_mask      — binary candidate-land mask (white = candidate)
  4. sensor_zones        — Probable Smart Sensor Drop Zones: purple circles
  5. supply_zones        — Probable Supply Drop Zone: green band of open land
                           between the inner margin (solid line) and the outer
                           margin (dashed line) around detected water
  6. isolated_regions    — potentially isolated land regions outlined + labelled
  7. final_analysis      — combined view: supply band and sensor zones together

All share the processed image's pixel grid, so every coordinate in the API
response lands on the same pixel in every view.

Every drawing happens on a copy. The uploaded image is never modified.
Wording on the overlays stays advisory ("Probable", "Candidate"). Never "safe".
"""

from __future__ import annotations

import base64
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

from .. import config
from .isolated_regions import IsolatedRegion
from .scoring import ScoredZone
from .storage_zones import StorageAnalysis, StorageZone
from .supply_zones import SupplyBand

# BGR colours
COLOR_WATER = (200, 90, 20)
COLOR_SENSOR = (247, 85, 168)  # purple  (RGB 168, 85, 247)
COLOR_SUPPLY = (94, 197, 34)  # green   (RGB 34, 197, 94)
COLOR_MARGIN = (150, 255, 170)  # light green margin lines
COLOR_CANOPY = (60, 60, 60)
COLOR_ISOLATED = (0, 140, 255)
COLOR_TEXT = (255, 255, 255)
COLOR_TEXT_BG = (24, 24, 24)
#: Dark halo drawn under strokes so they stay visible on bright and dark ground.
COLOR_OUTLINE = (18, 18, 18)

FONT = cv2.FONT_HERSHEY_SIMPLEX

DISCLAIMER = "AASRA - computer-vision estimate. Probable zones only; verify on the ground."

IMAGE_KEYS = (
    "original",
    "water_mask",
    "candidate_mask",
    "sensor_zones",
    "supply_zones",
    "isolated_regions",
    "final_analysis",
)

Rect = Tuple[int, int, int, int]  # x1, y1, x2, y2


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


def _label_geometry(
    image: np.ndarray,
    text: str,
    origin: Sequence[int],
    scale: float,
    thickness: int,
) -> Tuple[Tuple[int, int], Rect]:
    """Clamp a label origin on-image and return (origin, background rect).

    Mirrors the clamping in `_draw_label` exactly, so the rect returned here
    is the rect `_draw_label` will actually paint.
    """
    (tw, th), baseline = cv2.getTextSize(text, FONT, scale, thickness)
    x = max(2, min(int(origin[0]), image.shape[1] - tw - 4))
    y = max(th + 4, min(int(origin[1]), image.shape[0] - 4))
    return (x, y), (x - 3, y - th - 4, x + tw + 3, y + baseline + 1)


def _draw_label(
    image: np.ndarray,
    text: str,
    origin: Sequence[int],
    scale: float = 0.45,
    thickness: int = 1,
    bg_color=COLOR_TEXT_BG,
) -> None:
    """Draw text with a filled background box so it stays readable."""
    (x, y), (x1, y1, x2, y2) = _label_geometry(image, text, origin, scale, thickness)
    cv2.rectangle(image, (x1, y1), (x2, y2), bg_color, cv2.FILLED)
    cv2.putText(image, text, (x, y), FONT, scale, COLOR_TEXT, thickness, cv2.LINE_AA)


def _overlap_area(a: Rect, b: Rect) -> int:
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    return w * h if w > 0 and h > 0 else 0


def _disclaimer_rect(canvas: np.ndarray) -> Rect:
    return _label_geometry(canvas, DISCLAIMER, (8, canvas.shape[0] - 8), 0.4, 1)[1]


def _place_labels(
    canvas: np.ndarray,
    items: List[Tuple[str, int, int, int]],
    occupied: List[Rect],
    scale: float = 0.5,
    below_first: bool = False,
) -> None:
    """Draw (text, x, top_y, bottom_y) labels above top_y or below bottom_y,
    skipping positions that collide with anything already placed."""
    for text, x, top_y, bottom_y in items:
        (tw, th), baseline = cv2.getTextSize(text, FONT, scale, 1)
        above_y = top_y - baseline - 6
        below_y = bottom_y + th + 8
        rows = (below_y, above_y) if below_first else (above_y, below_y)
        # Centred first, then shifted left / right of the anchor.
        candidates = [
            (x + dx, y)
            for y in rows
            for dx in (-tw // 2, -tw - 8, 8)
        ]
        best, best_cost = None, None
        for candidate in candidates:
            origin, rect = _label_geometry(canvas, text, candidate, scale, 1)
            cost = sum(_overlap_area(rect, other) for other in occupied)
            if best_cost is None or cost < best_cost:
                best, best_cost = (origin, rect), cost
            if cost == 0:
                break
        placement = best
        occupied.append(placement[1])
        _draw_label(canvas, text, placement[0], scale=scale)


def _circle_rect(x: int, y: int, r: int) -> Rect:
    return (x - r, y - r, x + r, y + r)


def _tint(canvas: np.ndarray, mask: np.ndarray, color, alpha: float) -> np.ndarray:
    overlay = canvas.copy()
    overlay[mask > 0] = color
    return cv2.addWeighted(overlay, alpha, canvas, 1.0 - alpha, 0)


def _dimmed_gray(display_bgr: np.ndarray, factor: float) -> np.ndarray:
    gray = cv2.cvtColor(display_bgr, cv2.COLOR_BGR2GRAY)
    return (cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR) * factor).astype(np.uint8)


def render_water_mask(display_bgr: np.ndarray, water_mask: np.ndarray) -> np.ndarray:
    """Water mask drawn over a dimmed copy of the scene.

    A bare black/white mask shows *what* was detected but not *whether it was
    right*. Keeping the scene visible underneath makes it possible to see at a
    glance whether muddy floodwater was picked up and whether brown land, roof
    tiles or roads were wrongly included — which a binary mask cannot show.
    """
    canvas = _dimmed_gray(display_bgr, 0.55)
    canvas = _tint(canvas, water_mask, COLOR_WATER, 0.75)

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


def _zone_contours(candidate_mask: np.ndarray, zones: List[ScoredZone]):
    """{zone_id: outer contours of that zone's candidate component}."""
    _, labels = cv2.connectedComponents(candidate_mask, connectivity=8)
    out = {}
    for zone in zones:
        component = _component_mask_at(labels, zone.region.drop_x, zone.region.drop_y)
        if component is None:
            continue
        contours, _ = cv2.findContours(
            component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        out[zone.zone_id] = contours
    return out


def _draw_sensor_circle(canvas: np.ndarray, storage: StorageZone, fill_alpha: float) -> np.ndarray:
    """Purple filled circle with a halo outline. Nothing is drawn inside it."""
    centre = (storage.center_x, storage.center_y)
    overlay = canvas.copy()
    cv2.circle(overlay, centre, storage.radius_px, COLOR_SENSOR, cv2.FILLED, cv2.LINE_AA)
    canvas = cv2.addWeighted(overlay, fill_alpha, canvas, 1.0 - fill_alpha, 0)
    cv2.circle(canvas, centre, storage.radius_px, COLOR_OUTLINE, 4, cv2.LINE_AA)
    cv2.circle(canvas, centre, storage.radius_px, COLOR_SENSOR, 2, cv2.LINE_AA)
    return canvas


def _line_layer(mask: np.ndarray, thickness: int, dash: int = 0) -> np.ndarray:
    """Boundary of `mask` as a stroke layer (uint8, 255 = stroke).

    Segments that only trace the image frame are removed: the frame is not a
    margin. With `dash` > 0 the stroke is broken into dashes of about that
    length by a checkerboard, which works for every line direction.
    """
    layer = np.zeros(mask.shape, dtype=np.uint8)
    contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    cv2.drawContours(layer, contours, -1, 255, thickness, cv2.LINE_AA)
    edge = thickness + 1
    layer[:edge, :] = 0
    layer[-edge:, :] = 0
    layer[:, :edge] = 0
    layer[:, -edge:] = 0
    if dash > 0:
        yy, xx = np.indices(mask.shape)
        layer[((xx // dash) + (yy // dash)) % 2 == 1] = 0
    return layer


def _paint_stroke(canvas: np.ndarray, layer: np.ndarray, color) -> None:
    halo = cv2.dilate(layer, np.ones((3, 3), np.uint8))
    canvas[halo > 0] = COLOR_OUTLINE
    canvas[layer > 0] = color


def _draw_supply_band(
    canvas: np.ndarray, supply: SupplyBand, water_mask: np.ndarray, fill_alpha: float
) -> np.ndarray:
    """Green band fill, then the inner margin (solid) and outer margin (dashed).

    The margins are drawn only where they border the green band. Around tree
    canopy (excluded) or land too small to hold the band, full iso-distance
    loops would only add clutter without marking anything usable.
    """
    canvas = _tint(canvas, supply.band_mask, COLOR_SUPPLY, fill_alpha)
    if not np.any(water_mask) or not np.any(supply.band_mask):
        return canvas
    near_band = cv2.dilate(
        supply.band_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    )
    inner = cv2.bitwise_or(water_mask, supply.inner_line_mask)
    outer = cv2.bitwise_or(water_mask, supply.outer_line_mask)
    _paint_stroke(canvas, cv2.bitwise_and(_line_layer(outer, 1, dash=6), near_band), COLOR_MARGIN)
    _paint_stroke(canvas, cv2.bitwise_and(_line_layer(inner, 1), near_band), COLOR_MARGIN)
    return canvas


def _draw_legend(canvas: np.ndarray, rows: List[Tuple[str, str, tuple]]) -> Rect:
    """Top-left key. rows: (kind, text, colour) with kind fill/solid/dashed."""
    scale, pad, swatch, gap = 0.42, 6, 14, 5
    sizes = [cv2.getTextSize(text, FONT, scale, 1)[0] for _, text, _ in rows]
    width = pad * 3 + swatch + max(w for w, _ in sizes)
    height = pad * 2 + len(rows) * (swatch + gap) - gap
    x0, y0 = 8, 8
    overlay = canvas.copy()
    cv2.rectangle(overlay, (x0, y0), (x0 + width, y0 + height), COLOR_TEXT_BG, cv2.FILLED)
    cv2.addWeighted(overlay, 0.82, canvas, 0.18, 0, dst=canvas)
    for i, (kind, text, colour) in enumerate(rows):
        top = y0 + pad + i * (swatch + gap)
        sx = x0 + pad
        if kind == "fill":
            cv2.rectangle(canvas, (sx, top), (sx + swatch, top + swatch), colour, cv2.FILLED)
            cv2.rectangle(canvas, (sx, top), (sx + swatch, top + swatch), COLOR_TEXT, 1)
        elif kind == "circle":
            c = (sx + swatch // 2, top + swatch // 2)
            cv2.circle(canvas, c, swatch // 2, colour, cv2.FILLED, cv2.LINE_AA)
            cv2.circle(canvas, c, swatch // 2, COLOR_TEXT, 1, cv2.LINE_AA)
        else:
            y = top + swatch // 2
            if kind == "dashed":
                for xs in range(sx, sx + swatch, 6):
                    cv2.line(canvas, (xs, y), (min(xs + 3, sx + swatch), y), colour, 2)
            else:
                cv2.line(canvas, (sx, y), (sx + swatch, y), colour, 2)
        cv2.putText(
            canvas, text, (sx + swatch + pad, top + swatch - 2), FONT, scale,
            COLOR_TEXT, 1, cv2.LINE_AA,
        )
    return (x0, y0, x0 + width, y0 + height)


def _sensor_legend(supply: Optional[SupplyBand] = None) -> List[Tuple[str, str, tuple]]:
    rows = [("circle", "Probable Smart Sensor Drop Zone", COLOR_SENSOR)]
    if supply is not None:
        rows += _supply_legend(supply)
    return rows


def _supply_legend(supply: SupplyBand) -> List[Tuple[str, str, tuple]]:
    return [
        ("fill", "Probable Supply Drop Zone", COLOR_SUPPLY),
        ("solid", f"Inner margin - {supply.inner_margin_px} px from water", COLOR_MARGIN),
        ("dashed", f"Outer margin - {supply.outer_margin_px} px from water", COLOR_MARGIN),
    ]


def _sensor_labels(
    storage: StorageAnalysis, zones: List[ScoredZone], short: bool
) -> List[Tuple[str, int, int, int]]:
    by_id = {zone.zone_id: zone for zone in zones}
    labels: List[Tuple[str, int, int, int]] = []
    for s in storage.storage_zones:
        zone = by_id.get(s.zone_id)
        band = zone.classification.title() if zone else ""
        name = "Sensor Drop Zone" if short else "Probable Smart Sensor Drop Zone"
        labels.append((f"{name} {s.zone_id} - {band}", s.center_x, s.center_y - s.radius_px, s.center_y + s.radius_px))
    return labels


def _supply_labels(supply: SupplyBand) -> List[Tuple[str, int, int, int]]:
    return [
        (f"Supply Drop Zone S{seg.segment_id}", seg.anchor_x, seg.anchor_y - 4, seg.anchor_y + 4)
        for seg in supply.segments[: config.SUPPLY_MAX_SEGMENTS_LABELLED]
    ]


def render_sensor_zones(
    display_bgr: np.ndarray,
    water_mask: np.ndarray,
    candidate_mask: np.ndarray,
    zones: List[ScoredZone],
    storage: StorageAnalysis,
) -> np.ndarray:
    """Probable Smart Sensor Drop Zones only: candidate outlines + purple circles."""
    canvas = _tint(display_bgr.copy(), water_mask, COLOR_WATER, 0.35)

    contours = _zone_contours(candidate_mask, zones)
    for zone in zones:
        cv2.drawContours(canvas, contours.get(zone.zone_id, []), -1, COLOR_OUTLINE, 3, cv2.LINE_AA)
        cv2.drawContours(canvas, contours.get(zone.zone_id, []), -1, (170, 170, 170), 1, cv2.LINE_AA)
    for s in storage.storage_zones:
        canvas = _draw_sensor_circle(canvas, s, 0.30)

    occupied: List[Rect] = [_disclaimer_rect(canvas), _draw_legend(canvas, _sensor_legend())]
    occupied += [_circle_rect(s.center_x, s.center_y, s.radius_px) for s in storage.storage_zones]
    _place_labels(canvas, _sensor_labels(storage, zones, short=False), occupied, scale=0.45)

    if not storage.storage_zones:
        _draw_label(canvas, "No Probable Smart Sensor Drop Zone identified", (8, 60))

    _draw_label(canvas, DISCLAIMER, (8, canvas.shape[0] - 8), scale=0.4)
    return canvas


def render_supply_zones(
    display_bgr: np.ndarray,
    water_mask: np.ndarray,
    canopy_mask: np.ndarray,
    supply: SupplyBand,
) -> np.ndarray:
    """Probable Supply Drop Zone only: green band between the two margins."""
    canvas = _tint(display_bgr.copy(), water_mask, COLOR_WATER, 0.35)
    # Canopy that falls between the margins is greyed: it is why the band
    # has gaps there.
    shoreline_canopy = cv2.bitwise_and(
        canopy_mask, cv2.subtract(supply.outer_line_mask, supply.inner_line_mask)
    )
    canvas = _tint(canvas, shoreline_canopy, COLOR_CANOPY, 0.45)
    canvas = _draw_supply_band(canvas, supply, water_mask, 0.50)

    rows = _supply_legend(supply)
    if np.any(shoreline_canopy):
        rows.append(("fill", "Tree canopy (excluded)", COLOR_CANOPY))
    occupied: List[Rect] = [_disclaimer_rect(canvas), _draw_legend(canvas, rows)]
    _place_labels(canvas, _supply_labels(supply), occupied, scale=0.42)

    if not supply.segments:
        _draw_label(canvas, "No Probable Supply Drop Zone identified", (8, 100))

    _draw_label(canvas, DISCLAIMER, (8, canvas.shape[0] - 8), scale=0.4)
    return canvas


def render_final_analysis(
    display_bgr: np.ndarray,
    water_mask: np.ndarray,
    zones: List[ScoredZone],
    storage: StorageAnalysis,
    supply: SupplyBand,
) -> np.ndarray:
    """Combined view: green supply band with its margins, purple sensor zones."""
    canvas = _tint(display_bgr.copy(), water_mask, COLOR_WATER, 0.40)
    canvas = _draw_supply_band(canvas, supply, water_mask, 0.42)
    for s in storage.storage_zones:
        canvas = _draw_sensor_circle(canvas, s, 0.30)

    occupied: List[Rect] = [
        _disclaimer_rect(canvas),
        _draw_legend(canvas, _sensor_legend(supply)),
    ]
    occupied += [_circle_rect(s.center_x, s.center_y, s.radius_px) for s in storage.storage_zones]
    _place_labels(canvas, _sensor_labels(storage, zones, short=True), occupied, scale=0.45)
    _place_labels(canvas, _supply_labels(supply), occupied, scale=0.4)

    if not storage.storage_zones and not supply.segments:
        _draw_label(canvas, "No probable drop zone identified", (8, 120))

    _draw_label(canvas, DISCLAIMER, (8, canvas.shape[0] - 8), scale=0.4)
    return canvas


def render_isolated_regions(
    display_bgr: np.ndarray,
    water_mask: np.ndarray,
    regions: List[IsolatedRegion],
) -> np.ndarray:
    """Outline and label potentially isolated land regions over a water tint."""
    canvas = _tint(display_bgr.copy(), water_mask, COLOR_WATER, 0.35)

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


def build_visualizations(
    display_bgr: np.ndarray,
    water_mask: np.ndarray,
    buffer_mask: np.ndarray,
    candidate_mask: np.ndarray,
    canopy_mask: np.ndarray,
    zones: List[ScoredZone],
    storage: StorageAnalysis,
    supply: SupplyBand,
    isolated: List[IsolatedRegion],
) -> Dict[str, str]:
    """Build all seven visualisations as base64 PNG strings."""
    if not config.INCLUDE_IMAGES:
        return {key: "" for key in IMAGE_KEYS}

    return {
        "original": encode_png_base64(display_bgr),
        "water_mask": encode_png_base64(render_water_mask(display_bgr, water_mask)),
        "candidate_mask": encode_png_base64(_mask_to_bgr(candidate_mask)),
        "sensor_zones": encode_png_base64(
            render_sensor_zones(display_bgr, water_mask, candidate_mask, zones, storage)
        ),
        "supply_zones": encode_png_base64(
            render_supply_zones(display_bgr, water_mask, canopy_mask, supply)
        ),
        "isolated_regions": encode_png_base64(
            render_isolated_regions(display_bgr, water_mask, isolated)
        ),
        "final_analysis": encode_png_base64(
            render_final_analysis(display_bgr, water_mask, zones, storage, supply)
        ),
    }
