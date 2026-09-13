"""
Optional AI supplement — supplementary object detection context.

This module is NOT part of the water-detection pipeline. It never runs
before, inside, or in place of `water_detection.py`, and its output is never
fused into the water mask, candidate regions, isolated regions or zone
scoring. Those stay exactly as they were: OpenCV heuristics over pixel
colour, texture and geometry.

What this module adds is a second, independent opinion from a general-purpose
object detector — Ultralytics YOLO11n, trained on COCO (80 everyday object
classes). It was never trained on flood imagery and has no concept of
"floodwater", "muddy water", "safe zone" or "rescue". It draws bounding boxes
around ordinary visible objects — people, vehicles, etc. Detecting a person or
a vehicle in an image is NOT evidence of a flood victim, a stranded person, a
rescue asset, or an emergency vehicle. This module reports only what the
detector actually saw: a labelled box and a confidence score.

Why YOLO11n: it is Ultralytics' smallest officially supported "nano" model
(~5.6 MB, ~2.6M parameters), runs comfortably on CPU in well under a second
per image at the resolution this pipeline already uses, and needs no GPU.

Failure handling
-----------------
AI context is a pure bonus. `get_object_context()` never raises: ultralytics
not installed, no internet for the first weight download, a corrupt cache, an
out-of-memory error, or any other failure all resolve to a result whose
`success` is False and whose `message` is a short, safe, user-facing string.
No traceback, path or internal exception detail ever reaches that message.
The caller (pipeline.py) can use the result unconditionally.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import numpy as np

from .visualization import encode_png_base64

logger = logging.getLogger("aasra.ai_detection")

MODEL_DISPLAY_NAME = "YOLO11n"

#: Local cache path for the model weights. Ultralytics downloads the file
#: here automatically on first use if it is not already present (needs
#: internet only that first time); every later call re-loads this same file.
#: An explicit path (rather than relying on ultralytics' default of "wherever
#: the process's current working directory happens to be") keeps the weight
#: file out of the repo root regardless of how the server is launched.
_MODEL_PATH = Path(__file__).resolve().parent / "weights" / "yolo11n.pt"

#: A detection is reported when the model's confidence reaches this value.
#: Deliberately NOT an area/pixel-percentage filter (unlike the previous
#: segmentation-based AI component) — a small-but-confident detection (e.g. a
#: distant person) must not disappear just because its box is small.
MIN_DETECTION_CONFIDENCE = 0.25

#: The categories AASRA's AI Context surfaces, in report order. YOLO11n is
#: trained on COCO-80 and knows many more classes (chair, dog, bottle, ...);
#: those are deliberately not surfaced here to keep the UI/API focused on the
#: objects relevant to a relief-imagery context, per Option A in the design
#: (only relevant classes are returned, rather than a relevant/other split).
RELEVANT_CLASSES: tuple[str, ...] = (
    "person",
    "car",
    "truck",
    "bus",
    "boat",
    "motorcycle",
    "bicycle",
)

#: Fixed, distinct BGR colour per relevant class — a display aid only.
_CLASS_COLORS: Dict[str, tuple] = {
    "person": (60, 200, 60),  # green
    "car": (0, 140, 255),  # orange
    "truck": (0, 0, 255),  # red
    "bus": (0, 210, 210),  # yellow
    "boat": (255, 120, 0),  # blue
    "motorcycle": (220, 220, 0),  # cyan
    "bicycle": (200, 0, 220),  # magenta
}
_DEFAULT_COLOR = (255, 255, 255)

_DISCLAIMER = (
    "Supplementary object detection (YOLO11n) - visible objects only, "
    "not flood/victim/rescue identification"
)


@dataclass
class BBox:
    x1: int
    y1: int
    x2: int
    y2: int


@dataclass
class Detection:
    label: str
    confidence: float
    bbox: BBox


@dataclass
class AIContextResult:
    """Outcome of one AI-context attempt. Always constructed, never raised."""

    success: bool
    message: str
    model_name: Optional[str] = None
    detections: List[Detection] = field(default_factory=list)
    counts: Dict[str, int] = field(default_factory=dict)
    visualization_bgr: Optional[np.ndarray] = None


# ---------------------------------------------------------------------------
# Lazy, cached model loading
# ---------------------------------------------------------------------------

_lock = threading.Lock()
_load_attempted = False
_model = None  # ultralytics.YOLO | None
_device = "cpu"
_names: Dict[int, str] = {}
_unavailable_reason: Optional[str] = None


def _load_model_locked() -> None:
    """Attempt to load the model exactly once. Caller must hold `_lock`."""
    global _model, _device, _names, _unavailable_reason, _load_attempted

    _load_attempted = True

    try:
        from ultralytics import YOLO
    except ImportError:
        _unavailable_reason = "AI dependencies are not installed."
        logger.info("AI object detection unavailable: ultralytics not importable")
        return

    try:
        import torch

        device = "cuda" if torch.cuda.is_available() else "cpu"

        # Downloads the ~5.6 MB weight file to _MODEL_PATH on first use if it
        # is not already cached there (requires internet that first time
        # only); every subsequent call in this process reuses `_model`.
        _MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
        model = YOLO(str(_MODEL_PATH))
        model.to(device)

        _model = model
        _device = device
        _names = dict(model.names)
        _unavailable_reason = None
        logger.info("AI object detection model loaded on %s", device)
    except Exception:
        # Covers: no internet for the first download, corrupt/partial cache,
        # out-of-memory while constructing the model, and anything else.
        logger.exception("AI object detection model failed to load")
        _model = None
        _unavailable_reason = "The AI object detection model could not be initialized."


def _ensure_model_loaded() -> bool:
    """Load on first use only. Returns True iff a usable model is cached."""
    if _model is not None:
        return True
    if _load_attempted and _model is None:
        return False
    with _lock:
        if not _load_attempted:
            _load_model_locked()
    return _model is not None


# ---------------------------------------------------------------------------
# Visualization
# ---------------------------------------------------------------------------


def _draw_tag(image: np.ndarray, text: str, x: int, y: int, color: tuple) -> None:
    """Filled label tag anchored above-left of a box, clamped on-image."""
    scale, thickness = 0.5, 1
    font = cv2.FONT_HERSHEY_SIMPLEX
    (tw, th), baseline = cv2.getTextSize(text, font, scale, thickness)
    tag_x = max(0, min(x, image.shape[1] - tw - 6))
    tag_y = y - 6 if y - th - 10 >= 0 else y + th + 10
    cv2.rectangle(
        image,
        (tag_x, tag_y - th - 6),
        (tag_x + tw + 6, tag_y + baseline - 2),
        color,
        cv2.FILLED,
    )
    text_color = (0, 0, 0) if sum(color) > 380 else (255, 255, 255)
    cv2.putText(
        image, text, (tag_x + 3, tag_y - 4), font, scale, text_color, thickness, cv2.LINE_AA
    )


def _draw_footer(image: np.ndarray, text: str, top: bool) -> None:
    """Small readable footer strip — kept local, no dependency on
    visualization.py's private helpers."""
    scale, thickness = 0.42, 1
    font = cv2.FONT_HERSHEY_SIMPLEX
    (tw, th), baseline = cv2.getTextSize(text, font, scale, thickness)
    x = max(2, min(8, image.shape[1] - tw - 4))
    y = (th + 6) if top else (image.shape[0] - 8)
    cv2.rectangle(
        image, (x - 2, y - th - 3), (x + tw + 2, y + baseline), (30, 30, 30), cv2.FILLED
    )
    cv2.putText(image, text, (x, y), font, scale, (255, 255, 255), thickness, cv2.LINE_AA)


def _render_visualization(
    display_bgr: np.ndarray, detections: List[Detection]
) -> np.ndarray:
    """Draw bounding boxes over an UNALTERED copy of the scene.

    Unlike the previous segmentation visualization, the image is never dimmed
    or tinted — only clean boxes and labels are added, so the underlying
    photo stays fully legible.
    """
    canvas = display_bgr.copy()

    for d in detections:
        color = _CLASS_COLORS.get(d.label, _DEFAULT_COLOR)
        cv2.rectangle(canvas, (d.bbox.x1, d.bbox.y1), (d.bbox.x2, d.bbox.y2), color, 2, cv2.LINE_AA)
        _draw_tag(
            canvas, f"{d.label.capitalize()} {d.confidence * 100:.0f}%", d.bbox.x1, d.bbox.y1, color
        )

    if not detections:
        _draw_footer(canvas, "No relevant objects detected", top=True)
    _draw_footer(canvas, _DISCLAIMER, top=False)
    return canvas


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def get_object_context(
    display_bgr: np.ndarray, build_visualization: bool = True
) -> AIContextResult:
    """Run one YOLO inference pass for supplementary object context.

    Never raises. `display_bgr` is read-only here — nothing is written back
    into it, and this result is never merged into the OpenCV outputs.
    """
    try:
        if not _ensure_model_loaded():
            return AIContextResult(
                success=False,
                message=_unavailable_reason
                or "AI object detection is unavailable.",
            )

        height, width = display_bgr.shape[:2]
        results = _model.predict(
            source=display_bgr,
            conf=MIN_DETECTION_CONFIDENCE,
            device=_device,
            verbose=False,
        )
        boxes = results[0].boxes

        supported_relevant = [name for name in RELEVANT_CLASSES if name in _names.values()]
        counts: Dict[str, int] = {name: 0 for name in supported_relevant}
        detections: List[Detection] = []

        for box in boxes:
            class_id = int(box.cls[0])
            label = _names.get(class_id, f"class_{class_id}")
            if label not in counts:
                continue  # Option A: only the relevant classes are surfaced

            confidence = round(float(box.conf[0]), 4)
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            bbox = BBox(
                x1=int(max(0, min(width, round(x1)))),
                y1=int(max(0, min(height, round(y1)))),
                x2=int(max(0, min(width, round(x2)))),
                y2=int(max(0, min(height, round(y2)))),
            )
            detections.append(Detection(label=label, confidence=confidence, bbox=bbox))
            counts[label] += 1

        detections.sort(key=lambda d: d.confidence, reverse=True)

        visualization = (
            _render_visualization(display_bgr, detections) if build_visualization else None
        )

        return AIContextResult(
            success=True,
            message="Object detection completed successfully.",
            model_name=MODEL_DISPLAY_NAME,
            detections=detections,
            counts=counts,
            visualization_bgr=visualization,
        )
    except Exception:
        logger.exception("AI object detection inference failed")
        return AIContextResult(
            success=False,
            message="AI object detection failed for this image.",
        )


def to_response_dict(result: AIContextResult) -> Dict[str, Any]:
    """Build the `ai` section of the API response from a result."""
    if not result.success:
        return {"status": "unavailable", "message": result.message}

    return {
        "status": "active",
        "model": result.model_name,
        "message": (
            "Supplementary object detection. Detected objects are visible-"
            "object context only — not flood, victim, rescue or hazard "
            "identification, and never fused into the OpenCV water/zone "
            "analysis."
        ),
        "detections": [
            {
                "label": d.label,
                "confidence": d.confidence,
                "bbox": {
                    "x1": d.bbox.x1,
                    "y1": d.bbox.y1,
                    "x2": d.bbox.x2,
                    "y2": d.bbox.y2,
                },
            }
            for d in result.detections
        ],
        "counts": dict(result.counts),
    }


def encode_visualization(result: AIContextResult) -> str:
    """Base64-encode the AI visualization, or "" if none was produced."""
    if result.visualization_bgr is None:
        return ""
    return encode_png_base64(result.visualization_bgr)
