"""
Generate the input files used by aasra.e2e.js (written to ./fixtures).

    cd frontend/e2e
    ../../backend/.venv/Scripts/python make_fixtures.py     (Windows)
    ../../backend/.venv/bin/python make_fixtures.py         (Linux/macOS)
"""

from pathlib import Path

import cv2
import numpy as np

OUT = Path(__file__).resolve().parent / "fixtures"
OUT.mkdir(exist_ok=True)
rng = np.random.default_rng(3)


def land(height: int, width: int) -> np.ndarray:
    base = np.full((height, width, 3), (60, 110, 70), np.float32)
    return np.clip(base + rng.normal(0, 18, (height, width, 3)), 0, 255).astype(np.uint8)


# Large upload: 6000 x 4000 with a muddy river and a round pond.
big = land(4000, 6000)
river = np.zeros(big.shape[:2], np.uint8)
cv2.rectangle(river, (0, 1500), (6000, 2300), 255, cv2.FILLED)
cv2.circle(river, (4700, 800), 450, 255, cv2.FILLED)
big[river > 0] = (58, 96, 128)
cv2.imwrite(str(OUT / "large-6000x4000.jpg"), big, [cv2.IMWRITE_JPEG_QUALITY, 85])

# All water: no candidate region, so no storage zone.
water = np.full((600, 900, 3), (160, 90, 30), np.uint8)
cv2.imwrite(str(OUT / "all-water.png"), water)

# Round islands in open water, one storage zone each:
#   r=62 -> small storage zone that still holds drop zones
#   r=54 -> every sampled drop point rejected for clearance
#   r=46 -> radius too small for any sampling ring
for name, radius in (("small-island", 62), ("island-all-rejected", 54), ("island-no-ring", 46)):
    island = np.full((600, 900, 3), (160, 90, 30), np.uint8)
    patch = np.zeros(island.shape[:2], np.uint8)
    cv2.circle(patch, (450, 300), radius, 255, cv2.FILLED)
    island[patch > 0] = land(600, 900)[patch > 0]
    cv2.imwrite(str(OUT / f"{name}.png"), island)

# Too small to analyse (below MIN_IMAGE_DIMENSION).
cv2.imwrite(str(OUT / "tiny-32px.png"), land(32, 32))

# Not an image at all, but with an image extension.
(OUT / "corrupt.jpg").write_bytes(rng.integers(0, 256, 4096, dtype=np.uint8).tobytes())

# Wrong type.
(OUT / "notes.txt").write_text("not an image\n", encoding="utf-8")

print("fixtures written to", OUT)
