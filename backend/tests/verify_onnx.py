"""
Local verification for the ONNX object-detection swap.

Run this on your own machine BEFORE pushing. It answers the three questions
that matter for the deployment:

  1. Does onnxruntime load the exported model at all?
  2. Do the detections match what ultralytics produced? (parity check — only
     runs if ultralytics is still installed in this environment)
  3. Does memory plateau, or climb, across repeated images?

Usage:
    cd backend
    python -m tests.verify_onnx                      # uses tests/output/*.png
    python -m tests.verify_onnx path/to/image.jpg    # one specific image
    python -m tests.verify_onnx --loops 20           # repeat-run memory check

Nothing here is imported by the application.
"""

from __future__ import annotations

import argparse
import glob
import os
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import ai_detection  # noqa: E402


def memory_mb():
    """Current RSS in MB — psutil if present, procfs otherwise, else None."""
    try:
        import psutil

        return psutil.Process().memory_info().rss / (1024 * 1024)
    except Exception:
        pass
    try:
        with open("/proc/self/status", "r", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("VmRSS:"):
                    return float(line.split()[1]) / 1024.0
    except Exception:
        return None
    return None


def show_memory(label):
    value = memory_mb()
    print(f"  RSS {label:<22} {value:7.1f} MB" if value else f"  RSS {label:<22}  (unavailable)")
    return value


def collect_images(explicit):
    if explicit:
        return [explicit]
    here = os.path.dirname(os.path.abspath(__file__))
    found = sorted(glob.glob(os.path.join(here, "output", "*.png")))
    found += sorted(glob.glob(os.path.join(here, "output", "*.jpg")))
    return found


def parity_check(image_bgr, onnx_detections):
    """Compare against ultralytics, if it is still installed locally."""
    try:
        from ultralytics import YOLO
    except ImportError:
        print("\n[parity] ultralytics not installed here — skipping comparison.")
        print("         (That is expected once you have removed it. Run this")
        print("          check on a machine that still has it if you want the")
        print("          side-by-side.)")
        return

    weights = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "app", "services", "weights", "yolo11n.pt",
    )
    if not os.path.isfile(weights):
        print("\n[parity] yolo11n.pt not found — skipping comparison.")
        return

    print("\n[parity] ultralytics vs onnxruntime on the same image")
    model = YOLO(weights)
    results = model.predict(source=image_bgr, conf=0.25, verbose=False)
    names = model.names

    reference = []
    for box in results[0].boxes:
        label = names.get(int(box.cls[0]), "?")
        if label not in ai_detection.RELEVANT_CLASSES:
            continue
        x1, y1, x2, y2 = (float(v) for v in box.xyxy[0].tolist())
        reference.append((label, float(box.conf[0]), (x1, y1, x2, y2)))
    reference.sort(key=lambda r: -r[1])

    print(f"  ultralytics: {len(reference)} relevant detections")
    print(f"  onnxruntime: {len(onnx_detections)} relevant detections")

    if len(reference) != len(onnx_detections):
        print("  !! COUNT MISMATCH — inspect before deploying")

    for ref, got in zip(reference, onnx_detections):
        label_ok = ref[0] == got.label
        conf_delta = abs(ref[1] - got.confidence)
        box_delta = max(
            abs(ref[2][0] - got.bbox.x1),
            abs(ref[2][1] - got.bbox.y1),
            abs(ref[2][2] - got.bbox.x2),
            abs(ref[2][3] - got.bbox.y2),
        )
        verdict = "OK" if (label_ok and conf_delta < 0.05 and box_delta <= 3) else "CHECK"
        print(
            f"  [{verdict}] {ref[0]:<10} conf {ref[1]:.3f} vs {got.confidence:.3f} "
            f"(d={conf_delta:.3f})  max box delta {box_delta:.1f}px"
        )
    print(
        "  Small deltas are normal: the ONNX graph and ultralytics' torch path\n"
        "  do not produce bit-identical floats. Labels must match; boxes within\n"
        "  a few pixels and confidence within ~0.05 is a pass."
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", nargs="?", default=None)
    parser.add_argument("--loops", type=int, default=10)
    args = parser.parse_args()

    print("=" * 68)
    print("AASRA — ONNX object detection verification")
    print("=" * 68)

    print(f"\n[config] AI_ENABLED     = {ai_detection.AI_ENABLED}")
    print(f"[config] INPUT_SIZE     = {ai_detection.INPUT_SIZE}")
    print(f"[config] mem arena      = {ai_detection.USE_MEM_ARENA}")
    print(f"[config] model path     = {ai_detection._MODEL_PATH}")
    print(f"[config] model present  = {ai_detection._MODEL_PATH.is_file()}")

    probe = ai_detection.probe_availability()
    print(f"[probe ] {probe}")
    if not probe.get("available"):
        print("\nFAILED: model not available. Fix the reason above first.")
        print("Export the model with:")
        print("    yolo export model=yolo11n.pt format=onnx opset=12")
        print("then move yolo11n.onnx to app/services/weights/")
        return 1

    baseline = show_memory("at start")

    images = collect_images(args.image)
    if not images:
        print("\nNo images found. Pass one explicitly:")
        print("    python -m tests.verify_onnx path/to/aerial.jpg")
        return 1

    first = cv2.imread(images[0])
    if first is None:
        print(f"\nCould not read {images[0]}")
        return 1
    print(f"\n[input ] {images[0]}  ({first.shape[1]}x{first.shape[0]})")

    started = time.time()
    result = ai_detection.get_object_context(first, build_visualization=True)
    first_call = time.time() - started

    print(f"\n[first inference] {first_call:.2f}s  (includes session creation)")
    print(f"[success] {result.success}  message: {result.message}")
    if not result.success:
        print("FAILED: inference did not succeed.")
        return 1

    after_load = show_memory("after model load")

    print(f"\n[detections] {len(result.detections)}")
    for d in result.detections[:15]:
        print(
            f"  {d.label:<10} {d.confidence * 100:5.1f}%  "
            f"({d.bbox.x1},{d.bbox.y1})-({d.bbox.x2},{d.bbox.y2})"
        )
    print(f"[counts] {result.counts}")

    if result.visualization_bgr is not None:
        out_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "output", "onnx_verify.png"
        )
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        cv2.imwrite(out_path, result.visualization_bgr)
        print(f"[visual] written to {out_path} — open it and check the boxes sit on")
        print("         the right objects. Misplaced boxes mean the letterbox")
        print("         mapping is wrong, which no unit test will tell you.")

    # ---- repeat-run memory behaviour --------------------------------------
    print(f"\n[memory] {args.loops} repeated inferences (the demo scenario)")
    pool = images * ((args.loops // max(1, len(images))) + 1)
    timings = []
    for index in range(args.loops):
        image = cv2.imread(pool[index])
        if image is None:
            continue
        started = time.time()
        ai_detection.get_object_context(image, build_visualization=True)
        timings.append(time.time() - started)
        if index % max(1, args.loops // 5) == 0 or index == args.loops - 1:
            value = memory_mb()
            print(
                f"  run {index + 1:>3}/{args.loops}  {timings[-1]:5.2f}s  "
                + (f"RSS {value:7.1f} MB" if value else "")
            )

    end = memory_mb()
    if timings:
        print(
            f"\n[timing] median {np.median(timings):.2f}s  "
            f"min {min(timings):.2f}s  max {max(timings):.2f}s  "
            "(your machine — a 0.1-CPU Render free instance will be far slower)"
        )
    if baseline and after_load and end:
        print(f"[memory] start {baseline:.1f} -> after load {after_load:.1f} -> "
              f"after {args.loops} runs {end:.1f} MB")
        growth = end - after_load
        print(f"[memory] growth after the model was loaded: {growth:+.1f} MB")
        if growth > 40:
            print("  !! That is a climb, not a plateau. Investigate before deploying")
            print("     to a 512 MB instance.")
        else:
            print("  Plateau confirmed — repeated images do not accumulate memory.")

    parity_check(first, result.detections)

    print("\n" + "=" * 68)
    print("Verification complete. Check the visual output before you push.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
