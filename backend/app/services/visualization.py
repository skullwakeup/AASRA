"""
Phase 12 — visualisations.

Produces six real images, each returned as a base64-encoded PNG string:

  1. original            — the resized upload, untouched
  2. water_mask          — detected water filled over a dimmed copy of the
                           scene, so the mask can be judged against what is
                           actually in the image
  3. candidate_mask      — binary candidate-region mask (white = candidate)
  4. drop_zones          — how each storage zone was derived: water buffer,
                           candidate region, storage circle, the radius and
                           the pixel that limited it, sampling rings,
                           rejected samples and the numbered drop zones
  5. isolated_regions    — potentially isolated land regions outlined + labelled
  6. final_analysis      — the at-a-glance result: water tint, each probable
                           storage zone (circle + centre) and its probable
                           drop zones

All six share the processed image's pixel grid, so every coordinate in the
API response lands on the same pixel in every view.

Every drawing happens on a copy. The uploaded image is never modified.
Wording on the overlays stays advisory ("Probable Storage Zone", "Candidate").
Never "safe".
"""

from __future__ import annotations

import base64
import math
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

from .. import config
from .isolated_regions import IsolatedRegion
from .scoring import ScoredZone
from .storage_zones import StorageAnalysis, StorageZone

# BGR colours
COLOR_WATER = (200, 90, 20)
COLOR_BUFFER = (150, 110, 70)
COLOR_STORAGE = (120, 211, 52)  # signal green
COLOR_DROP = (240, 240, 240)
COLOR_REJECTED = (80, 80, 225)  # muted red
COLOR_ISOLATED = (0, 140, 255)
COLOR_TEXT = (255, 255, 255)
COLOR_TEXT_BG = (24, 24, 24)
#: Dark halo drawn under strokes so they stay visible on bright and dark ground.
COLOR_OUTLINE = (18, 18, 18)

FONT = cv2.FONT_HERSHEY_SIMPLEX

DISCLAIMER = "AASRA - computer-vision estimate. Probable zones only; verify on the ground."

#: Outer radius of the storage-centre marker, including its halo (px).
CENTER_MARKER_RADIUS = 10

IMAGE_KEYS = (
    "original",
    "water_mask",
    "candidate_mask",
    "drop_zones",
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


def _draw_radial_label(
    canvas: np.ndarray, text: str, cx: int, cy: int, x: int, y: int,
    distance: int, scale: float, occupied: List[Rect],
) -> None:
    """Label a point on the side facing away from (cx, cy)."""
    angle = math.atan2(y - cy, x - cx) if (x, y) != (cx, cy) else -math.pi / 2
    (tw, th), baseline = cv2.getTextSize(text, FONT, scale, 1)
    lx = int(round(x + (distance + tw / 2) * math.cos(angle) - tw / 2))
    ly = int(round(y + (distance + th / 2) * math.sin(angle) + th / 2))
    origin, rect = _label_geometry(canvas, text, (lx, ly), scale, 1)
    occupied.append(rect)
    _draw_label(canvas, text, origin, scale=scale)


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


def _draw_storage_circle(canvas: np.ndarray, storage: StorageZone, fill_alpha: float) -> np.ndarray:
    centre = (storage.center_x, storage.center_y)
    overlay = canvas.copy()
    cv2.circle(overlay, centre, storage.radius_px, COLOR_STORAGE, cv2.FILLED, cv2.LINE_AA)
    canvas = cv2.addWeighted(overlay, fill_alpha, canvas, 1.0 - fill_alpha, 0)
    cv2.circle(canvas, centre, storage.radius_px, COLOR_OUTLINE, 4, cv2.LINE_AA)
    cv2.circle(canvas, centre, storage.radius_px, COLOR_STORAGE, 2, cv2.LINE_AA)
    return canvas


def _draw_storage_center(image: np.ndarray, x: int, y: int) -> None:
    """Strong centre marker: green core, white ring, dark halo."""
    cv2.circle(image, (x, y), CENTER_MARKER_RADIUS, COLOR_OUTLINE, cv2.FILLED, cv2.LINE_AA)
    cv2.circle(image, (x, y), CENTER_MARKER_RADIUS - 2, COLOR_TEXT, 2, cv2.LINE_AA)
    cv2.circle(image, (x, y), 4, COLOR_STORAGE, cv2.FILLED, cv2.LINE_AA)


def _draw_drop_zone(image: np.ndarray, x: int, y: int, radius: int) -> None:
    """Thin light ring (the drop zone) around a small dot (the drop point)."""
    cv2.circle(image, (x, y), radius, COLOR_OUTLINE, 3, cv2.LINE_AA)
    cv2.circle(image, (x, y), radius, COLOR_DROP, 1, cv2.LINE_AA)
    cv2.circle(image, (x, y), 3, COLOR_OUTLINE, cv2.FILLED, cv2.LINE_AA)
    cv2.circle(image, (x, y), 2, COLOR_DROP, cv2.FILLED, cv2.LINE_AA)


def _draw_dashed_line(image, p1, p2, color, thickness=1, dash=6) -> None:
    length = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    if length < 1:
        return
    steps = int(length // dash)
    for i in range(0, steps + 1, 2):
        a = i / max(1, steps)
        b = min(1.0, (i + 1) / max(1, steps))
        start = (int(round(p1[0] + (p2[0] - p1[0]) * a)), int(round(p1[1] + (p2[1] - p1[1]) * a)))
        end = (int(round(p1[0] + (p2[0] - p1[0]) * b)), int(round(p1[1] + (p2[1] - p1[1]) * b)))
        cv2.line(image, start, end, color, thickness, cv2.LINE_AA)


def _draw_dotted_circle(image, centre, radius, color, spacing=7) -> None:
    count = max(8, int(2 * math.pi * radius / spacing))
    for i in range(count):
        angle = 2 * math.pi * i / count
        point = (
            int(round(centre[0] + radius * math.cos(angle))),
            int(round(centre[1] + radius * math.sin(angle))),
        )
        cv2.circle(image, point, 1, color, cv2.FILLED)


def _draw_cross(image, x, y, color, size=3) -> None:
    cv2.line(image, (x - size, y - size), (x + size, y + size), color, 1, cv2.LINE_AA)
    cv2.line(image, (x - size, y + size), (x + size, y - size), color, 1, cv2.LINE_AA)


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


def render_drop_zone_analysis(
    display_bgr: np.ndarray,
    water_mask: np.ndarray,
    buffer_mask: np.ndarray,
    candidate_mask: np.ndarray,
    zones: List[ScoredZone],
    storage: StorageAnalysis,
) -> np.ndarray:
    """Explain each storage zone: what bounded its radius and why each drop
    point was kept or rejected."""
    canvas = _dimmed_gray(display_bgr, 0.6)
    ring_only = cv2.subtract(buffer_mask, water_mask)
    canvas = _tint(canvas, water_mask, COLOR_WATER, 0.7)
    canvas = _tint(canvas, ring_only, COLOR_BUFFER, 0.45)

    contours = _zone_contours(candidate_mask, zones)
    for zone in zones:
        cv2.drawContours(canvas, contours.get(zone.zone_id, []), -1, COLOR_STORAGE, 1, cv2.LINE_AA)

    labels: List[Tuple[str, int, int, int]] = []
    storage_labels: List[Tuple[str, int, int, int]] = []
    occupied: List[Rect] = [_disclaimer_rect(canvas)]

    for zone_storage in storage.storage_zones:
        canvas = _draw_storage_circle(canvas, zone_storage, 0.12)
        centre = (zone_storage.center_x, zone_storage.center_y)

        for ring in zone_storage.ring_radii:
            if ring < zone_storage.radius_px:  # the boundary is drawn already
                _draw_dotted_circle(canvas, centre, ring, (150, 150, 150))

        for point in zone_storage.rejected_points:
            if point.reason != "outside_image":
                _draw_cross(canvas, point.x, point.y, COLOR_REJECTED)

        # Radius line to the pixel that limited it (or due east for the cap).
        if zone_storage.limiting_point is not None:
            lx, ly = zone_storage.limiting_point
            angle = math.atan2(ly - centre[1], lx - centre[0])
        else:
            lx = ly = None
            angle = 0.0
        edge = (
            int(round(centre[0] + zone_storage.radius_px * math.cos(angle))),
            int(round(centre[1] + zone_storage.radius_px * math.sin(angle))),
        )
        _draw_dashed_line(canvas, centre, edge, COLOR_OUTLINE, 3)
        _draw_dashed_line(canvas, centre, edge, COLOR_TEXT, 1)
        if lx is not None:
            cv2.circle(canvas, (lx, ly), 4, COLOR_OUTLINE, cv2.FILLED, cv2.LINE_AA)
            cv2.circle(canvas, (lx, ly), 3, COLOR_REJECTED, cv2.FILLED, cv2.LINE_AA)

        for drop in zone_storage.drop_zones:
            _draw_drop_zone(canvas, drop.x, drop.y, drop.radius_px)
            occupied.append((drop.x - 3, drop.y - 3, drop.x + 3, drop.y + 3))

        _draw_storage_center(canvas, *centre)
        occupied.append(_circle_rect(*centre, CENTER_MARKER_RADIUS))
        for drop in zone_storage.drop_zones:
            _draw_radial_label(
                canvas, f"D{drop.drop_id}", centre[0], centre[1],
                drop.x, drop.y, drop.radius_px + 3, 0.38, occupied,
            )
        mid = ((centre[0] + edge[0]) // 2, (centre[1] + edge[1]) // 2)
        labels.append((f"r = {zone_storage.radius_px} px", mid[0], mid[1] - 4, mid[1] + 4))
        storage_labels.append(
            (f"Storage Zone {zone_storage.zone_id}", centre[0],
             centre[1] - zone_storage.radius_px, centre[1] + zone_storage.radius_px)
        )

    for item in storage.not_viable:
        zone = next((z for z in zones if z.zone_id == item.zone_id), None)
        if zone is None:
            continue
        x, y = zone.region.drop_x, zone.region.drop_y
        _draw_cross(canvas, x, y, COLOR_REJECTED, 5)
        labels.append((f"Zone {zone.zone_id}: radius {item.radius_px} px - not viable", x, y - 6, y + 6))

    _place_labels(canvas, labels, occupied, scale=0.42)
    _place_labels(canvas, storage_labels, occupied, scale=0.45, below_first=True)

    if not storage.storage_zones:
        _draw_label(canvas, "No probable storage zone identified", (8, 20))

    _draw_label(canvas, DISCLAIMER, (8, canvas.shape[0] - 8), scale=0.4)
    return canvas


def render_final_analysis(
    display_bgr: np.ndarray,
    water_mask: np.ndarray,
    candidate_mask: np.ndarray,
    zones: List[ScoredZone],
    storage: StorageAnalysis,
) -> np.ndarray:
    """The headline result: water, probable storage zones and drop zones.

    Draw order is region outlines, storage circles, drop zones, centres, then
    labels, so nothing important sits under a stroke. Only what the pipeline
    returned is drawn, at the coordinates it computed.
    """
    canvas = _tint(display_bgr.copy(), water_mask, COLOR_WATER, 0.40)

    contours = _zone_contours(candidate_mask, zones)
    for zone in zones:
        cv2.drawContours(canvas, contours.get(zone.zone_id, []), -1, COLOR_OUTLINE, 3, cv2.LINE_AA)
        cv2.drawContours(canvas, contours.get(zone.zone_id, []), -1, (170, 170, 170), 1, cv2.LINE_AA)

    for zone_storage in storage.storage_zones:
        canvas = _draw_storage_circle(canvas, zone_storage, 0.22)
    for zone_storage in storage.storage_zones:
        for drop in zone_storage.drop_zones:
            _draw_drop_zone(canvas, drop.x, drop.y, drop.radius_px)
    for zone_storage in storage.storage_zones:
        _draw_storage_center(canvas, zone_storage.center_x, zone_storage.center_y)

    by_id = {zone.zone_id: zone for zone in zones}
    # Labels may not cover any storage circle, drop zone or the disclaimer.
    occupied: List[Rect] = [_disclaimer_rect(canvas)]
    for zone_storage in storage.storage_zones:
        occupied.append(
            _circle_rect(zone_storage.center_x, zone_storage.center_y, zone_storage.radius_px)
        )
    labels: List[Tuple[str, int, int, int]] = []
    for zone_storage in storage.storage_zones:
        zone = by_id.get(zone_storage.zone_id)
        band = zone.classification.title() if zone else ""
        cx, cy, r = zone_storage.center_x, zone_storage.center_y, zone_storage.radius_px
        labels.append((f"Probable Storage Zone {zone_storage.zone_id} - {band}", cx, cy - r, cy + r))
    for item in storage.not_viable:
        zone = by_id.get(item.zone_id)
        if zone is not None:
            x, y = zone.region.drop_x, zone.region.drop_y
            labels.append((f"Zone {zone.zone_id} - no storage zone", x, y - 4, y + 4))
    _place_labels(canvas, labels, occupied, scale=0.45)

    if not storage.storage_zones:
        _draw_label(canvas, "No probable storage zone identified", (8, 20))

    _draw_label(canvas, DISCLAIMER, (8, canvas.shape[0] - 8), scale=0.4)
    return canvas


def build_visualizations(
    display_bgr: np.ndarray,
    water_mask: np.ndarray,
    buffer_mask: np.ndarray,
    candidate_mask: np.ndarray,
    zones: List[ScoredZone],
    storage: StorageAnalysis,
    isolated: List[IsolatedRegion],
) -> Dict[str, str]:
    """Build all six visualisations as base64 PNG strings."""
    if not config.INCLUDE_IMAGES:
        return {key: "" for key in IMAGE_KEYS}

    return {
        "original": encode_png_base64(display_bgr),
        "water_mask": encode_png_base64(render_water_mask(display_bgr, water_mask)),
        "candidate_mask": encode_png_base64(_mask_to_bgr(candidate_mask)),
        "drop_zones": encode_png_base64(
            render_drop_zone_analysis(
                display_bgr, water_mask, buffer_mask, candidate_mask, zones, storage
            )
        ),
        "isolated_regions": encode_png_base64(
            render_isolated_regions(display_bgr, water_mask, isolated)
        ),
        "final_analysis": encode_png_base64(
            render_final_analysis(display_bgr, water_mask, candidate_mask, zones, storage)
        ),
    }
