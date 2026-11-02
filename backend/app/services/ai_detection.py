"""
Optional AI supplement — supplementary object detection context.

This module is NOT part of the water-detection pipeline. It never runs
before, inside, or in place of `water_detection.py`, and its output is never
fused into the water mask, candidate regions, isolated regions or zone
scoring. Those stay exactly as they were: OpenCV heuristics over pixel
colour, texture and geometry.

What this module adds is a second, independent opinion from a general-purpose
object detector — YOLO11n, trained on COCO (80 everyday object classes). It
was never trained on flood imagery and has no concept of "floodwater", "muddy
water", "safe zone" or "rescue". It draws bounding boxes around ordinary
visible objects — people, vehicles, etc. Detecting a person or a vehicle in an
image is NOT evidence of a flood victim, a stranded person, a rescue asset, or
an emergency vehicle. This module reports only what the detector actually saw:
a labelled box and a confidence score.

Runtime: ONNX Runtime (CPU), not PyTorch
----------------------------------------
Inference runs on a pre-exported `yolo11n.onnx` through onnxruntime. The
earlier implementation used ultralytics + torch, which could not fit a 512 MB
instance: importing torch alone costs ~250-300 MB RSS before a single image is
processed. onnxruntime with this model is roughly a fifth of that, which is
what makes the AI context viable on a small deployment at all.

The trade is that ultralytics' pre/post-processing is no longer available, so
letterboxing, output decoding and NMS are implemented here explicitly. The
decode contract for a YOLO11 export is fixed and documented inline.

Memory discipline (small-instance deployment)
---------------------------------------------
  * one cached session for the process lifetime — never reloaded per request
  * single-threaded intra/inter op (a 0.1-CPU instance gains nothing from
    thread pools and pays for them in memory and contention)
  * the CPU memory arena is disabled by default, so working memory is
    released after each inference instead of being retained as a high-water
    mark. Slightly slower, materially safer under a hard RAM cap.

Failure handling
-----------------
AI context is a pure bonus. `get_object_context()` never raises: onnxruntime
not installed, a missing or corrupt model file, an out-of-memory error, or any
other failure all resolve to a result whose `success` is False and whose
`message` is a short, safe, user-facing string. No traceback, path or internal
exception detail ever reaches that message. The caller (pipeline.py) can use
the result unconditionally.

Kill switch: set the environment variable AI_ENABLED=false to disable this
module entirely without a code change or redeploy.
"""

from __future__ import annotations

import ast
import logging
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

from .visualization import encode_png_base64

logger = logging.getLogger("aasra.ai_detection")

MODEL_DISPLAY_NAME = "YOLO11n"

#: Pre-exported ONNX model. Unlike the ultralytics build, nothing is
#: downloaded at runtime — the file ships with the repository, so a cold
#: start needs no internet access and cannot half-download a cache.
#: Export it with:  yolo export model=yolo11n.pt format=onnx opset=12
_MODEL_PATH = Path(__file__).resolve().parent / "weights" / "yolo11n.onnx"


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off", ""}


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, "").strip())
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, value))


#: Master switch. AI_ENABLED=false disables the module at load time.
AI_ENABLED = _env_flag("AI_ENABLED", True)

#: Square network input edge. 640 is the export default; 480 roughly halves
#: inference cost on a CPU-starved instance at some accuracy cost. Must be a
#: multiple of 32.
INPUT_SIZE = _env_int("AI_INPUT_SIZE", 640, 320, 1280) // 32 * 32

#: Disabling onnxruntime's CPU arena keeps peak RSS down on small instances.
#: Set AI_MEM_ARENA=true to trade memory for a little speed.
USE_MEM_ARENA = _env_flag("AI_MEM_ARENA", False)

#: A detection is reported when the model's confidence reaches this value.
#: Deliberately NOT an area/pixel-percentage filter — a small-but-confident
#: detection (e.g. a distant person) must not disappear just because its box
#: is small.
MIN_DETECTION_CONFIDENCE = 0.25

#: IoU threshold for non-maximum suppression, applied per class. Matches the
#: ultralytics `predict` default so results stay comparable with the earlier
#: torch-based implementation.
NMS_IOU_THRESHOLD = 0.7

#: Hard cap on reported detections (ultralytics' max_det default).
MAX_DETECTIONS = 300

#: The categories AASRA's AI Context surfaces, in report order. YOLO11n is
#: trained on COCO-80 and knows many more classes (chair, dog, bottle, ...);
#: those are deliberately not surfaced here to keep the UI/API focused on the
#: objects relevant to a relief-imagery context.
RELEVANT_CLASSES: Tuple[str, ...] = (
    "person",
    "car",
    "truck",
    "bus",
    "boat",
    "motorcycle",
    "bicycle",
)

#: COCO-80 class names in model output order. Used only as a fallback: an
#: ultralytics ONNX export embeds the real mapping in its metadata, which is
#: read first (see `_read_class_names`).
_COCO_NAMES: Tuple[str, ...] = (
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train",
    "truck", "boat", "traffic light", "fire hydrant", "stop sign",
    "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
    "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag",
    "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
    "baseball bat", "baseball glove", "skateboard", "surfboard",
    "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon",
    "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot",
    "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant",
    "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote",
    "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
    "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
    "hair drier", "toothbrush",
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
# Lazy, cached session loading
# ---------------------------------------------------------------------------

_lock = threading.Lock()
_load_attempted = False
_session = None  # onnxruntime.InferenceSession | None
_input_name: Optional[str] = None
_names: Dict[int, str] = {}
_unavailable_reason: Optional[str] = None


def _read_class_names(session) -> Dict[int, str]:
    """Prefer the class map embedded by the ultralytics export.

    An ultralytics ONNX export stores its `names` dict in the model's custom
    metadata as a Python literal, e.g. "{0: 'person', 1: 'bicycle', ...}".
    Parsing it keeps this module correct even if a differently-trained model
    is dropped in. `ast.literal_eval` (not `eval`) — the metadata string is
    treated as data, never as code.
    """
    try:
        raw = session.get_modelmeta().custom_metadata_map.get("names")
        if raw:
            parsed = ast.literal_eval(raw)
            if isinstance(parsed, dict) and parsed:
                return {int(k): str(v) for k, v in parsed.items()}
    except Exception:
        logger.info("Could not read class names from model metadata; using COCO-80")
    return {index: name for index, name in enumerate(_COCO_NAMES)}


def _load_model_locked() -> None:
    """Attempt to create the session exactly once. Caller must hold `_lock`."""
    global _session, _input_name, _names, _unavailable_reason, _load_attempted

    _load_attempted = True

    if not AI_ENABLED:
        _unavailable_reason = "AI object detection is disabled by configuration."
        logger.info("AI object detection disabled via AI_ENABLED")
        return

    try:
        import onnxruntime as ort
    except ImportError:
        _unavailable_reason = "AI dependencies are not installed."
        logger.info("AI object detection unavailable: onnxruntime not importable")
        return

    if not _MODEL_PATH.is_file():
        _unavailable_reason = "The AI object detection model file is missing."
        logger.warning("AI object detection unavailable: %s not found", _MODEL_PATH)
        return

    try:
        options = ort.SessionOptions()
        # One thread each: a 0.1-CPU instance cannot use more, and thread
        # pools cost memory that this deployment does not have.
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.enable_cpu_mem_arena = USE_MEM_ARENA
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        options.log_severity_level = 3  # warnings and above only

        session = ort.InferenceSession(
            str(_MODEL_PATH),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )

        _session = session
        _input_name = session.get_inputs()[0].name
        _names = _read_class_names(session)
        _unavailable_reason = None
        logger.info(
            "AI object detection session ready (onnxruntime, input=%d, arena=%s)",
            INPUT_SIZE,
            USE_MEM_ARENA,
        )
    except Exception:
        # Covers: corrupt/partial model file, unsupported opset, out of memory
        # while creating the session, and anything else.
        logger.exception("AI object detection model failed to load")
        _session = None
        _unavailable_reason = "The AI object detection model could not be initialized."


def probe_availability() -> Dict[str, Any]:
    """Cheap capability report — never creates a session, never allocates.

    Used by /health. Deliberately does NOT load the model: a health check runs
    on every deploy and on Render's schedule, and an out-of-memory error while
    building the session there would fail the health check and roll the deploy
    back, rather than degrading to "AI unavailable" as intended.
    """
    if not AI_ENABLED:
        return {"available": False, "reason": "disabled by configuration"}

    try:
        import onnxruntime  # noqa: F401
    except ImportError:
        return {"available": False, "reason": "onnxruntime not installed"}

    if not _MODEL_PATH.is_file():
        return {"available": False, "reason": "model file missing"}

    return {
        "available": True,
        "loaded": _session is not None,
        "runtime": "onnxruntime",
        "model": MODEL_DISPLAY_NAME,
        "input_size": INPUT_SIZE,
    }


def _ensure_model_loaded() -> bool:
    """Load on first use only. Returns True iff a usable session is cached."""
    if _session is not None:
        return True
    if _load_attempted and _session is None:
        return False
    with _lock:
        if not _load_attempted:
            _load_model_locked()
    return _session is not None


# ---------------------------------------------------------------------------
# Pre- and post-processing (replaces ultralytics' internals)
# ---------------------------------------------------------------------------


def _letterbox(
    image_bgr: np.ndarray, size: int
) -> Tuple[np.ndarray, float, int, int]:
    """Resize preserving aspect ratio and pad to a square `size` x `size`.

    Returns (padded_image, ratio, pad_x, pad_y). Padding is grey (114), the
    value the model was trained with. The ratio and pads are what map a
    detection back onto the original image.
    """
    height, width = image_bgr.shape[:2]
    ratio = min(size / float(height), size / float(width))
    new_w = max(1, int(round(width * ratio)))
    new_h = max(1, int(round(height * ratio)))

    interpolation = cv2.INTER_AREA if ratio < 1 else cv2.INTER_LINEAR
    resized = cv2.resize(image_bgr, (new_w, new_h), interpolation=interpolation)

    canvas = np.full((size, size, 3), 114, dtype=np.uint8)
    pad_x = (size - new_w) // 2
    pad_y = (size - new_h) // 2
    canvas[pad_y : pad_y + new_h, pad_x : pad_x + new_w] = resized
    return canvas, ratio, pad_x, pad_y


def _preprocess(image_bgr: np.ndarray, size: int):
    """BGR uint8 HWC -> RGB float32 NCHW in [0, 1], letterboxed to size."""
    padded, ratio, pad_x, pad_y = _letterbox(image_bgr, size)
    rgb = cv2.cvtColor(padded, cv2.COLOR_BGR2RGB)
    tensor = rgb.astype(np.float32) / 255.0
    tensor = np.transpose(tensor, (2, 0, 1))[np.newaxis, ...]
    return np.ascontiguousarray(tensor), ratio, pad_x, pad_y


def _decode(
    raw_output: np.ndarray,
    ratio: float,
    pad_x: int,
    pad_y: int,
    original_width: int,
    original_height: int,
    allowed_class_ids: set,
) -> List[Detection]:
    """Turn a raw YOLO11 ONNX output into image-space detections.

    Output contract for a YOLO11 detection export: shape (1, 4 + num_classes,
    num_anchors) — typically (1, 84, 8400) for COCO at 640. Row order is
    [cx, cy, w, h, class_0_score, ..., class_79_score], all box values in
    *network input* pixels. There is no separate objectness channel (that is
    a YOLOv5-era layout); the class score is the confidence.

    Steps: transpose to one row per anchor, take each anchor's best class,
    drop anything below the confidence threshold and anything outside the
    reported classes, convert cxcywh -> xyxy, undo the letterbox (subtract
    the pad, divide by the resize ratio), clip to the image, then apply
    per-class NMS.
    """
    predictions = np.squeeze(raw_output, axis=0)
    if predictions.shape[0] < predictions.shape[1]:
        # (84, 8400) -> (8400, 84). Guarded rather than assumed, so an export
        # that already emits (anchors, channels) also decodes correctly.
        predictions = predictions.T

    if predictions.shape[1] < 5:
        return []

    class_scores = predictions[:, 4:]
    class_ids = np.argmax(class_scores, axis=1)
    confidences = class_scores[np.arange(class_scores.shape[0]), class_ids]

    keep = confidences >= MIN_DETECTION_CONFIDENCE
    if allowed_class_ids:
        keep &= np.isin(class_ids, list(allowed_class_ids))
    if not np.any(keep):
        return []

    boxes = predictions[keep, :4]
    class_ids = class_ids[keep]
    confidences = confidences[keep].astype(np.float32)

    # cxcywh (network input space) -> xyxy (original image space)
    half_w = boxes[:, 2] / 2.0
    half_h = boxes[:, 3] / 2.0
    x1 = (boxes[:, 0] - half_w - pad_x) / ratio
    y1 = (boxes[:, 1] - half_h - pad_y) / ratio
    x2 = (boxes[:, 0] + half_w - pad_x) / ratio
    y2 = (boxes[:, 1] + half_h - pad_y) / ratio

    x1 = np.clip(x1, 0, original_width)
    y1 = np.clip(y1, 0, original_height)
    x2 = np.clip(x2, 0, original_width)
    y2 = np.clip(y2, 0, original_height)

    detections: List[Detection] = []

    # Per-class NMS: suppressing across classes would let a confident "car"
    # erase an overlapping "person", which is not what the detector means.
    for class_id in np.unique(class_ids):
        member = class_ids == class_id
        # cv2.dnn.NMSBoxes wants [x, y, w, h] with plain Python numbers.
        rects = [
            [float(a), float(b), float(c - a), float(d - b)]
            for a, b, c, d in zip(x1[member], y1[member], x2[member], y2[member])
        ]
        scores = [float(s) for s in confidences[member]]
        if not rects:
            continue

        indices = cv2.dnn.NMSBoxes(
            rects, scores, MIN_DETECTION_CONFIDENCE, NMS_IOU_THRESHOLD
        )
        if indices is None or len(indices) == 0:
            continue

        member_x1 = x1[member]
        member_y1 = y1[member]
        member_x2 = x2[member]
        member_y2 = y2[member]
        label = _names.get(int(class_id), f"class_{int(class_id)}")

        for index in np.array(indices).flatten():
            index = int(index)
            box_x1 = int(round(float(member_x1[index])))
            box_y1 = int(round(float(member_y1[index])))
            box_x2 = int(round(float(member_x2[index])))
            box_y2 = int(round(float(member_y2[index])))
            if box_x2 <= box_x1 or box_y2 <= box_y1:
                continue  # degenerate after clipping
            detections.append(
                Detection(
                    label=label,
                    confidence=round(float(scores[index]), 4),
                    bbox=BBox(x1=box_x1, y1=box_y1, x2=box_x2, y2=box_y2),
                )
            )

    detections.sort(key=lambda d: d.confidence, reverse=True)
    return detections[:MAX_DETECTIONS]


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

    The image is never dimmed or tinted — only clean boxes and labels are
    added, so the underlying photo stays fully legible.
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
    """Run one inference pass for supplementary object context.

    Never raises. `display_bgr` is read-only here — nothing is written back
    into it, and this result is never merged into the OpenCV outputs.
    """
    try:
        if not _ensure_model_loaded():
            return AIContextResult(
                success=False,
                message=_unavailable_reason or "AI object detection is unavailable.",
            )

        height, width = display_bgr.shape[:2]

        supported_relevant = [
            name for name in RELEVANT_CLASSES if name in _names.values()
        ]
        allowed_ids = {
            class_id
            for class_id, name in _names.items()
            if name in supported_relevant
        }

        tensor, ratio, pad_x, pad_y = _preprocess(display_bgr, INPUT_SIZE)
        outputs = _session.run(None, {_input_name: tensor})
        del tensor  # release the ~4.9 MB input before post-processing

        detections = _decode(
            raw_output=outputs[0],
            ratio=ratio,
            pad_x=pad_x,
            pad_y=pad_y,
            original_width=width,
            original_height=height,
            allowed_class_ids=allowed_ids,
        )
        del outputs  # release the ~2.8 MB raw output as soon as it is decoded

        counts: Dict[str, int] = {name: 0 for name in supported_relevant}
        for detection in detections:
            if detection.label in counts:
                counts[detection.label] += 1

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
    except MemoryError:
        logger.exception("AI object detection ran out of memory")
        return AIContextResult(
            success=False,
            message="AI object detection was skipped for this image (insufficient memory).",
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
