# AASRA pipeline — algorithms and formulas

All distances and areas below are **pixels of the processed image** (longest
edge resized to `MAX_IMAGE_DIMENSION`). They are never metres, and none of them
encode safety.

```
IMAGE
  -> 1 preprocessing
  -> 2 water detection                 WaterMask
  -> 3 water buffer + candidate mask   WaterBuffer, CandidateMask
  -> 4 connected regions               max-clearance point, clearances, openness
  -> 5 isolated land regions           (reported only; feeds nothing)
  -> 6 zone scoring, top N
  -> 7 probable storage zones          centre = max-clearance point, valid radius
  -> 8 probable drop zones             sampled, filtered, scored, spaced
  -> 9 visualisations
IMAGE -> 10 supplementary object detection (independent branch)
```

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

### Known failure modes

A wide, smooth, uniformly coloured dirt road or bare earth field can still
read as muddy water — from a single RGB frame the two are genuinely close,
and the usual remedy (NDWI) needs a near-infrared band this pipeline does not
have. Dark roofs and deep shadow can read as water; sun glint and whitecaps
can read as land.

## 3. Water buffer and candidate mask (`services/candidate_mask.py`)

(This module was called `drop_zone_detection.py` before the storage/drop-zone
stage existed; it was renamed because it builds masks, not drop zones.)

```
WaterBuffer   = dilate(WaterMask, radius = WATER_BUFFER_SIZE)   # pixels only
NonWaterMask  = NOT WaterMask
CandidateMask = NonWaterMask AND NOT WaterBuffer
```

followed by an open+close with a 5×5 elliptical kernel. There is **no obstacle
detection** yet — buildings, trees, vehicles and power lines are not modelled.

## 4. Regions, max-clearance point, openness (`services/region_analysis.py`)

`cv2.connectedComponentsWithStats` on the candidate mask gives id, area, bbox,
width, height and centroid. Regions below `MIN_REGION_AREA` are rejected.

The candidate mask is zero-padded by one pixel before `cv2.distanceTransform`
so the image border counts as a boundary. Within each region, the pixel of
maximum distance is the **max-clearance point** (returned as `drop_point` on
each zone for backward compatibility, and used as the storage centre in §7);
that distance is the region clearance. Regions whose clearance is below `MIN_REGION_CLEARANCE` are dropped
as slivers.

`water_clearance` is sampled separately from a distance transform of the
inverted water mask: the pixel distance from that point to the nearest
detected water pixel. With no water in the image the transform is capped at
the image diagonal (OpenCV would otherwise report `FLT_MAX`).

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

## 7. Probable storage zones (`services/storage_zones.py`)

Terminology used everywhere in the code, API and UI:

| Term | Meaning |
|---|---|
| **Probable storage zone** | circular candidate area around the storage centre |
| **Storage centre** | the ranked zone's max-clearance point from §4, unchanged |
| **Probable drop zone** | small circle inside the storage zone |
| **Drop point** | the exact pixel at the centre of a drop zone |

For each ranked zone, with centre `(cx, cy)`:

```
component  = the candidate-mask component containing the centre
prohibited = WaterBuffer                       # water dilated by WATER_BUFFER_SIZE
valid      = component AND NOT prohibited

d_invalid  = exact Euclidean distance to the nearest non-valid pixel
             (searched in a window of half-size MAX + margin + 1)
d_border   = min(cx, cy, W-1-cx, H-1-cy) + 1   # first pixel outside the image
d_limit    = min(d_invalid, d_border)

r_geo      = ceil(d_limit) - 1                 # largest integer r < d_limit
radius     = min(r_geo - STORAGE_RADIUS_MARGIN_PX, MAX_STORAGE_RADIUS_PX)
```

Then every pixel centre with `(x-cx)² + (y-cy)² ≤ radius²` is checked against
`valid` and the image bounds, and `radius` is decreased until that holds.
(With the formula above it already holds; the check guards against future
changes.)

- The candidate mask is defined as "not buffer", but its morphological close
  can re-add a few buffer pixels, so both `component` and `prohibited` are
  checked explicitly.
- Bounding the circle by the zone's **own component** means it can never
  cross water, the buffer or the image edge, or spill onto unrelated land.
- `limiting_factor` records what stopped the circle: `water_buffer` (the
  nearest invalid pixel is water or buffer), `candidate_boundary` (land
  removed by the candidate-mask cleanup, or another region),
  `image_boundary`, or `max_radius`. `limiting_point` is that pixel.
- `radius < MIN_STORAGE_RADIUS_PX` → the zone is listed in
  `storage_analysis.not_viable` (`radius_below_minimum`) and not drawn as a
  storage zone. A centre on an invalid pixel → `center_in_excluded_area`; a
  repeated centre → `duplicate_center`. The radius is always a non-negative
  integer.
- `MAX_STORAGE_RADIUS_PX` stops a nearly water-free image from producing a
  circle that describes the whole frame instead of a local area.

Cost: one bounded window search and one disk check per zone — no
O(W × H × r) scan.

## 8. Probable drop zones (`services/storage_zones.py`)

Let `ρ = DROP_POINT_MIN_CLEARANCE_PX` (drop-zone radius) and
`s = max(MIN_DROP_POINT_DISTANCE_PX, 2ρ)` (spacing).

**Sampling rings** (outermost first, none closer than `s` to the centre):

1. `radius − 1` — just inside the boundary. Where the boundary is tight,
   these samples have about `margin` px of clearance and are rejected; they
   are the red crosses in the Drop Zones view.
2. `radius + margin − ρ` — the farthest ring on which every sample has
   at least `ρ` px of valid land (the nearest invalid pixel is at least
   `radius + margin + 1` from the centre; one pixel is kept for rounding).
3. every `s` inward from ring 2.

A ring of radius `r` gets `max(6, ⌊2πr / s⌋)` samples; alternate rings are
offset by half a step. Samples are rounded to pixels and de-duplicated.

**Filters**, in order (the first that fails is recorded as the reason):
`outside_image`, `outside_storage_zone`, `water`, `water_buffer`,
`outside_candidate_region`, `insufficient_clearance` (clearance < ρ, where
clearance comes from an exact, border-padded distance transform of `valid`).

**Score** (0–100, separate from the zone score in §6):

```
clearance_score = min(1, clearance_px / radius)
water_score     = min(1, water_clearance_px / CLEARANCE_SCORE_SATURATION_PX)
proximity_score = 1 - distance_from_centre_px / radius

score = 100 * (0.40*clearance_score + 0.30*water_score + 0.30*proximity_score)
```

The bands from §6 are applied to it (`HIGH POTENTIAL` …).

**Selection:** candidates sorted by score (ties: outer ring order, then
angle) are accepted greedily when they are at least `s` px from the centre
and from every accepted point, up to `MAX_DROP_POINTS_PER_STORAGE_ZONE`.
Accepted points are numbered 1..n in score order. Because `s ≥ 2ρ`, drop
zones never overlap.

A storage zone can legitimately have no drop zones: when `radius − 1 < s`
there is no ring at all, and on a small round island every boundary sample
fails the clearance test while ring 2 is closer than `s` to the
centre. The UI states which of the two happened.

Settings (all in `config.py`):

| Setting | Default | Meaning |
|---|---|---|
| `STORAGE_RADIUS_MARGIN_PX` | 4 | pixel gap kept from the nearest excluded pixel |
| `MIN_STORAGE_RADIUS_PX` | 12 | smaller circles are reported as not viable |
| `MAX_STORAGE_RADIUS_PX` | 180 | cap on the storage radius |
| `DROP_POINT_MIN_CLEARANCE_PX` | 10 | drop-zone radius and minimum clearance |
| `MIN_DROP_POINT_DISTANCE_PX` | 28 | spacing between drop points, and from the centre |
| `MAX_DROP_POINTS_PER_STORAGE_ZONE` | 8 | cap per storage zone |
| `DROP_SCORE_WEIGHT_*` | 0.40 / 0.30 / 0.30 | clearance / water clearance / proximity |

"Margin" and "clearance" are pixel distances used by the algorithm, not
physical safety distances.

## 9. Visualisations (`services/visualization.py`)

Six base64 PNGs, always returned, all on the processed image's pixel grid:

| Key | Content |
|---|---|
| `original` | the resized upload |
| `water_mask` | detected water over a dimmed greyscale copy of the scene |
| `candidate_mask` | binary candidate mask |
| `drop_zones` | water, water buffer, ranked regions, each storage circle, its radius line to the limiting pixel (red dot) labelled `r = N px`, sampling rings, rejected samples (red crosses), numbered drop zones `D1…`, and a note for each not-viable zone |
| `isolated_regions` | potentially isolated land regions, outlined and scored |
| `final_analysis` | water tint, ranked region outlines, storage circles (translucent green), drop zones (small light rings with a dot), storage centres (green core, white ring) and one label per storage zone |

Labels are tried above and below their anchor, then shifted sideways; the
position with the least overlap with labels, circles and the disclaimer strip
already on the image wins. Every drawing happens on a copy of the resized
image; the upload itself is never modified.

## 10. Supplementary object detection (`services/ai_detection.py`)

A seventh image, `ai_context`, is added to the response only when this stage
succeeds. It is produced by a small, separate module that is **not part of**
the pipeline above:

- Model: **YOLO11n**, pretrained on COCO (80 general object classes), run
  through **ONNX Runtime (CPU)** from the committed
  `backend/app/services/weights/yolo11n.onnx` (~10 MB). Nothing is
  downloaded at runtime. The session is created on first use and cached for
  the life of the process. Letterboxing, output decoding and per-class NMS
  are implemented in the module.
- Runs once per request on the same resized (`display_bgr`) image the OpenCV
  stages use, with a fixed confidence threshold
  (`MIN_DETECTION_CONFIDENCE = 0.25`).
- Reports only seven classes relevant to a relief-imagery context: `person`,
  `car`, `truck`, `bus`, `boat`, `motorcycle`, `bicycle`. Every other COCO
  class YOLO11n can technically detect is discarded.
- Output: a list of detections (label, confidence, pixel bounding box), a
  per-class count, and an annotated image with clean bounding boxes and
  `Label NN%` tags — no dimming, no tinting.
- **Never influences** water detection, candidate regions, clearance, zone
  scoring, storage zones or drop zones in any way. It reads the processed image and writes only to
  its own part of the response (`ai` and `images.ai_context`).
- Fails safe: if `onnxruntime` isn't installed, the model file is missing,
  `AI_ENABLED=false`, or inference raises for any reason, the function
  returns a failure result instead of raising. The caller then reports `analysis_mode.ai = false` and
  every other field in the response is unaffected.

## Not implemented

- Obstacle detection (buildings, trees, power lines) beyond what the water
  buffer implicitly avoids.
- Georeferencing — pixel distances never convert to real-world distances.
- Any check of what is physically inside a storage or drop zone (surface,
  slope, obstacles, people).
- Multi-image or temporal (before/after) analysis.
- Any accuracy evaluation against a labelled flood-imagery dataset.
