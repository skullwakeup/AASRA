"""
Offline smoke test for the AASRA pipeline (no web server required).

It builds a SYNTHETIC aerial-flood-like scene (muddy river + land + a detached
land patch), runs the full pipeline over it and prints the resulting metrics.

The synthetic scene exists only to prove the pipeline executes end to end and
produces self-consistent numbers. It is NOT a detection-accuracy benchmark and
says nothing about performance on real aerial imagery.

Usage:
    cd backend
    python -m tests.smoke_test [path/to/real_image.jpg]
"""

from __future__ import annotations

import base64
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.pipeline import run_analysis  # noqa: E402

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")


def build_synthetic_scene(width: int = 900, height: int = 600) -> np.ndarray:
    """Draw a coarse synthetic scene: textured land, a muddy river, an island."""
    rng = np.random.default_rng(42)

    # Textured green/brown land background.
    image = np.zeros((height, width, 3), dtype=np.uint8)
    image[:, :] = (60, 110, 70)
    noise = rng.normal(0, 18, (height, width, 3))
    image = np.clip(image.astype(np.float32) + noise, 0, 255).astype(np.uint8)

    # Add coarse vegetation blotches so land is NOT smooth.
    for _ in range(220):
        cx, cy = int(rng.integers(0, width)), int(rng.integers(0, height))
        r = int(rng.integers(6, 26))
        color = (
            int(rng.integers(35, 80)),
            int(rng.integers(90, 150)),
            int(rng.integers(40, 90)),
        )
        cv2.circle(image, (cx, cy), r, color, cv2.FILLED)

    # Muddy brown water: a wide diagonal river plus a flooded pocket.
    water = np.zeros((height, width), dtype=np.uint8)
    cv2.fillPoly(
        water,
        [np.array([[0, 210], [width, 300], [width, 400], [0, 330]], dtype=np.int32)],
        255,
    )
    cv2.ellipse(water, (700, 480), (150, 80), 20, 0, 360, 255, cv2.FILLED)

    muddy = np.zeros_like(image)
    muddy[:, :] = (58, 96, 128)  # BGR: brown-ochre
    muddy = np.clip(
        muddy.astype(np.float32) + rng.normal(0, 3, muddy.shape), 0, 255
    ).astype(np.uint8)  # water is smooth: very low noise
    image[water > 0] = muddy[water > 0]

    # A detached land patch inside the flooded pocket (potential isolated region).
    island = np.zeros((height, width), dtype=np.uint8)
    cv2.circle(island, (700, 480), 45, 255, cv2.FILLED)
    land_patch = np.zeros_like(image)
    land_patch[:, :] = (70, 120, 80)
    land_patch = np.clip(
        land_patch.astype(np.float32) + rng.normal(0, 16, land_patch.shape), 0, 255
    ).astype(np.uint8)
    image[island > 0] = land_patch[island > 0]

    return image


def main() -> int:
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    if len(sys.argv) > 1:
        path = sys.argv[1]
        with open(path, "rb") as handle:
            data = handle.read()
        label = f"real image: {path}"
    else:
        scene = build_synthetic_scene()
        ok, buffer = cv2.imencode(".png", scene)
        if not ok:
            print("Failed to encode the synthetic scene")
            return 1
        data = buffer.tobytes()
        cv2.imwrite(os.path.join(OUTPUT_DIR, "synthetic_input.png"), scene)
        label = "synthetic scene (not a real aerial photo)"

    result = run_analysis(data)

    print(f"Input: {label}")
    print("Metrics:", json.dumps(result["metrics"], indent=2))
    print("Warnings:", result["warnings"])
    print(f"Zones returned: {len(result['zones'])}")
    for zone in result["zones"]:
        print(
            f"  Zone {zone['id']}: score={zone['score']} "
            f"({zone['classification']}), area={zone['pixel_area']}px, "
            f"water_clearance={zone['water_clearance']}px, "
            f"drop_point=({zone['drop_point']['x']}, {zone['drop_point']['y']}), "
            f"breakdown={zone['score_breakdown']}"
        )
    print(f"Probable storage zones: {len(result['storage_zones'])}")
    for storage in result["storage_zones"]:
        drops = storage["candidate_drop_zones"]
        print(
            f"  Storage {storage['id']}: centre=({storage['center']['x']}, "
            f"{storage['center']['y']}), radius={storage['radius_px']}px "
            f"(limited by {storage['limiting_factor']}), drop zones={len(drops)}"
        )
        for drop in drops:
            print(
                f"    D{drop['id']}: ({drop['point']['x']}, {drop['point']['y']}) "
                f"score={drop['score']} clearance={drop['clearance_px']}px"
            )
    for item in result["storage_analysis"]["not_viable"]:
        print(f"  Zone {item['zone_id']}: no storage zone ({item['reason']}, radius {item['radius_px']}px)")
    print(f"Potentially isolated land regions: {len(result['isolated_regions'])}")
    for region in result["isolated_regions"]:
        print(
            f"  Region {region['id']}: isolation={region['isolation_score']} "
            f"({region['classification']}), area={region['pixel_area']}px, "
            f"breakdown={region['score_breakdown']}"
        )

    for name, payload in result["images"].items():
        if not payload:
            continue
        out_path = os.path.join(OUTPUT_DIR, f"{name}.png")
        with open(out_path, "wb") as handle:
            handle.write(base64.b64decode(payload))
    print(f"Visualisations written to: {OUTPUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
