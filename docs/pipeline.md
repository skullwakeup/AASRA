# AASRA pipeline — algorithms and formulas

All distances and areas below are **pixels of the processed image** (longest
edge resized to `MAX_IMAGE_DIMENSION`). They are never metres, and none of them
encode safety.

## 1. Preprocessing (`services/preprocessing.py`)

- decode upload → BGR; reject unreadable data and images below
  `MIN_IMAGE_DIMENSION`
- resize preserving aspect ratio; keep the original and a clean display copy
- build a separate **analysis copy**: small Gaussian blur (5×5) + CLAHE on the
  LAB L-channel (clip 2.0, 8×8 tiles). Detection runs on the analysis copy,
  drawing on the display copy.

## 2. Water detection (`services/water_detection.py`)

Colour says what a pixel *could* be; three colour-independent "support" cues
decide whether it behaves like a water surface. The two are combined
multiplicatively rather than summed, so colour alone can never make water.

**Colour cues** — each a graded 0–1 membership, not a hard threshold:

| Cue | Definition | Support floor |
|---|---|---|
| Blue / clear | hue 85–135 with S≥35, V≥25, **or** B − max(G,R) ≥ 6; both require B not to be beaten by R | 0.27 |
| Turbid / muddy | hue 5–35, S 25–215, V 35–255 | 0.05 |
| Dark / shadowed | V ≤ 70 and S ≤ 110 | 0.15 |
| Low saturation / reflective | S ≤ 45, V 55–235 | 0.12 |
| Vegetation (penalty) | hue 36–84 with S ≥ 45, **or** excess-green index | −0.45 |

**Support cues** — colour-blind measures of surface behaviour:

| Cue | Definition | Weight |
|---|---|---|
| Chromatic homogeneity | local std-dev of Lab a\* + b\* over 15×15, ramped down 6 → 16 | 0.40 |
| Smoothness | local std-dev of luminance over 9×9, ramped down 10 → 34 | 0.20 |
| Edge freedom | Canny (60/150) density over 15×15, ramped down 0.05 → 0.22 | 0.40 |

Combination, per colour cue *c*:

```
likelihood_c = strength_c * (floor_c + (1 - floor_c) * support)
likelihood   = max over c, minus the vegetation penalty
```

`floor_c` is how far a colour is trusted with no supporting evidence. Blue
is specific enough to need little support; brown is shared with soil, tile and
dry terrain, so it is given almost none of its own — **a brown pixel becomes
water only when the support cues agree.** That is what separates muddy water
from ordinary brown land. Local standard deviation is computed with box
filters: `std = sqrt(E[x²] − E[x]²)`.

A pixel is water when likelihood ≥ `WATER_LIKELIHOOD_THRESHOLD` (0.45). Then:
morphological open (3×3) → close (7×7) → fill interior holes below
`MAX_WATER_HOLE_AREA` → drop connected components below
`MIN_WATER_COMPONENT_AREA` → **region verification**: a component is dropped
only if it is *both* weakly supported (mean support < 0.22) *and* smaller than
`REGION_LARGE_AREA_FRACTION` of the frame, so small genuine flood pockets
survive. Output: uint8 mask, 255 = water.

**Known failure modes:** a wide, smooth, uniformly coloured dirt road or bare
earth field can still read as muddy water — from a single RGB frame the two are
genuinely close, and the usual remedy (NDWI) needs a near-infrared band this
pipeline does not have. Dark roofs and deep shadow can read as water; sun glint
and whitecaps can read as land.

## 3. Water buffer and candidate mask (`services/drop_zone_detection.py`)

```
WaterBuffer   = dilate(WaterMask, radius = WATER_BUFFER_SIZE)   # pixels only
NonWaterMask  = NOT WaterMask
CandidateMask = NonWaterMask AND NOT WaterBuffer
```

followed by an open+close with a 5×5 elliptical kernel. There is **no obstacle
detection** yet — buildings, trees, vehicles and power lines are not modelled.

## 4. Regions, drop points, openness (`services/region_analysis.py`)

`cv2.connectedComponentsWithStats` on the candidate mask gives id, area, bbox,
width, height and centroid. Regions below `MIN_REGION_AREA` are rejected.

The candidate mask is zero-padded by one pixel before `cv2.distanceTransform`
so the image border counts as a boundary. Within each region, the pixel of
maximum distance is the **candidate drop point**; that distance is the region
clearance. Regions whose clearance is below `MIN_REGION_CLEARANCE` are dropped
as slivers.

`water_clearance` is sampled separately from a distance transform of the
inverted water mask: the pixel distance from the drop point to the nearest
detected water pixel.

Openness (0–1), from three real geometric properties:

```
normalised_clearance = min(1, clearance / (0.5 * min(bbox_w, bbox_h)))
compactness          = min(1, 4*pi*area / perimeter^2)
extent               = area / (bbox_w * bbox_h)

openness = 0.50*normalised_clearance + 0.30*compactness + 0.20*extent
```

## 5. Potentially isolated land regions (`services/isolated_regions.py`)

No person detection of any kind. Land geometry only.

Connected components of the non-water mask; the largest is the reference
landmass. Every other component with area ≥ `MIN_ISOLATED_AREA` is measured:

```
water_contact = water pixels in the 1-px ring around the component / ring pixels
separation    = min distance from the component to the largest land component
relative_size = 1 - min(1, area / largest_land_area)

isolation = 100 * ( 0.45*water_contact
                  + 0.35*min(1, separation / ISOLATION_SEPARATION_SATURATION_PX)
                  + 0.20*relative_size )
```

Bands: **80–100 HIGH ISOLATION**, **50–79 MODERATE ISOLATION**, **<50 LOW
ISOLATION**.

## 6. Zone scoring and ranking (`services/scoring.py`)

```
area_score            = 100 * min(1, (area / image_area) / AREA_SCORE_SATURATION_FRACTION)
water_clearance_score = 100 * min(1, water_clearance_px / CLEARANCE_SCORE_SATURATION_PX)
openness_score        = 100 * openness

final_score = 0.40*area_score + 0.40*water_clearance_score + 0.20*openness_score
```

Bands: **80–100 HIGH POTENTIAL**, **60–79 MODERATE POTENTIAL**, **40–59 LOW
POTENTIAL**, **<40 NOT RECOMMENDED**. Zones are sorted by `final_score` and the
top `MAX_ZONES` (default 3) are returned, renumbered 1..N.

## 7. Visualisations (`services/visualization.py`)

Five base64 PNGs: `original`, `water_mask`, `candidate_mask`,
`isolated_regions`, `final_analysis`. `water_mask` fills the detected water
over a dimmed greyscale copy of the scene, so the mask can be judged against
what is actually in the image rather than read as a context-free binary map.
The final overlay draws the water tint,
all candidate boundaries, the ranked zone outlines with zone number + score,
the candidate drop point crosshair, the isolated-region boxes, and a standing
disclaimer. Every drawing happens on a copy.

## Planned (not implemented)

- obstacle detection (buildings, trees, vehicles, wires)
- segmentation model to replace/assist the water heuristic (`analysis_mode.ai`)
- georeferencing so pixel distances can become real-world distances
- multi-image / temporal analysis
