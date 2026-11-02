# AASRA pipeline — algorithms and formulas

All distances and areas below are **pixels of the processed image** (longest
edge resized to `MAX_IMAGE_DIMENSION`). They are never metres, and none of them
encode safety.

```
IMAGE
  -> 1 preprocessing
  -> 2 water detection                 cues + per-scene colour model -> WaterMask
  -> 3 canopy, buffer, candidate mask  Canopy, WaterBuffer, CandidateMask
  -> 4 connected regions               max-clearance point, clearances, openness
  -> 5 isolated land regions           (reported only; feeds nothing)
  -> 6 zone scoring, top N
  -> 7 Probable Smart Sensor Drop Zones   purple circles: centre = max-clearance point, valid radius
  -> 8 Probable Supply Drop Zone          green band: open land between two margins around water
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

### Per-scene colour model (built-surface rejection)

The cues above passed pale concrete, roofs and car parks as water: they are
as smooth and as grey/beige as muddy floodwater, and no fixed threshold
separates them (on the bundled samples, Tennessee floodwater is S≈40, V≈180
and the Pakistan concrete pad S≈61, V≈199). What separates them is the scene:
a flood carries one sediment colour, and built surfaces are brighter than it.

```
seeds     = cue-stage water pixels with support >= 0.85
colours   = Lab of the seeds (un-enhanced image), L* weighted by 0.6
clusters  = k-means, k = 6 (deterministic seed)
primary   = largest cluster (must hold >= 20 % of seeds, else skip the model)
accepted  = primary, then (chained) any cluster whose a*/b* centre is within
            13 of an accepted cluster AND whose L* <= primary L* + 18,
            and any clearly blue cluster (b* <= -8)
rejected  = the rest (measured: concrete and roofs sit +27 to +54 L* above)
match     = ramp(dist to nearest rejected - dist to nearest accepted, ±3)
evidence  = evidence * max(match, blue_exemption)
```

On the four bundled photographs: Pakistan water drops from 64.9 % to 38.1 %
(concrete pad, roofs and walls become land), Tennessee from 58.3 % to 52.7 %
(white roofs and pale lots become land), and both Missouri images are
unchanged. `USE_SCENE_COLOUR_MODEL = False` restores the previous behaviour.

### Known failure modes

A wide, smooth, uniformly coloured dirt road or bare earth field can still
read as muddy water — from a single RGB frame the two are genuinely close,
and the usual remedy (NDWI) needs a near-infrared band this pipeline does not
have. Grey asphalt car parks and dark-grey roofs can still read as water
when the scene's water is itself grey (Tennessee sample). Deep shadow can
read as water; sun glint and whitecaps can read as land; sky in an oblique
photograph reads as water. A trained segmentation model is the real fix.

## 3. Canopy, water buffer and candidate mask (`services/canopy.py`, `services/candidate_mask.py`)

**Tree canopy.** Without it the zones sat on tree tops — the one kind of land
where nothing dropped from the air reaches the ground.

```
vegetation = max(green hue band with S >= 45, excess-green index ramp)
texture    = ramp(local luminance std (11x11), 8 -> 20)
Canopy     = box_blur(vegetation * texture, 15x15) >= 0.35
             -> open/close 7x7 -> drop blobs < 150 px -> never on water
```

Smooth vegetation (lawns, crop fields) stays open land. Canopy still counts as
land for isolation (§5).

```
WaterBuffer   = dilate(WaterMask, radius = WATER_BUFFER_SIZE)   # pixels only
NonWaterMask  = NOT WaterMask
OpenLandMask  = NonWaterMask AND NOT Canopy
CandidateMask = OpenLandMask AND NOT WaterBuffer
```

followed by an open+close with a 5×5 elliptical kernel. Buildings, vehicles
and power lines are **not** modelled.

## 4. Regions, max-clearance point, openness (`services/region_analysis.py`)

`cv2.connectedComponentsWithStats` on the candidate mask gives id, area, bbox,
width, height and centroid. Regions below `MIN_REGION_AREA` are rejected.

The candidate mask is zero-padded by one pixel before `cv2.distanceTransform`
so the image border counts as a boundary. Within each region, the pixel of
maximum distance is the **max-clearance point** (returned as
`max_clearance_point` on each zone, and used as the sensor-zone centre in §7);
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

## 7. Probable Smart Sensor Drop Zones (`services/storage_zones.py`)

Purple circles: places to drop flood sensors or cameras. (The geometry was
called the "probable storage zone" in earlier versions; internal names such
as `StorageZone` and `compute_storage_radius` are unchanged so the verified
geometry and its tests stay as they were.)

For each ranked zone, with centre `(cx, cy)` = its max-clearance point:

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

- Bounding the circle by the zone's **own component** means it can never
  cross water, the buffer, tree canopy or the image edge, or spill onto
  unrelated land.
- `limiting_factor` records what stopped the circle: `water_buffer`,
  `candidate_boundary` (canopy, cleanup or another region), `image_boundary`,
  or `max_radius`.
- `radius < MIN_STORAGE_RADIUS_PX` → listed in `sensor_analysis.not_viable`
  (`radius_below_minimum`) and not drawn. A centre on an invalid pixel →
  `center_in_excluded_area`; a repeated centre → `duplicate_center`.
- `MAX_STORAGE_RADIUS_PX` stops a nearly water-free image from producing a
  circle that describes the whole frame instead of a local area.

Nothing is drawn inside the circle. The earlier drop-point sampler (small
circles inside each zone) is still in the module and its tests, but is off:
`SENSOR_INCLUDE_DROP_POINTS = False`.

| Setting | Default | Meaning |
|---|---|---|
| `STORAGE_RADIUS_MARGIN_PX` | 4 | pixel gap kept from the nearest excluded pixel |
| `MIN_STORAGE_RADIUS_PX` | 12 | smaller circles are reported as not viable |
| `MAX_STORAGE_RADIUS_PX` | 180 | cap on the radius |

## 8. Probable Supply Drop Zone (`services/supply_zones.py`)

A green band of open land along the detected shoreline, so supplies land near
the water's edge where people reaching the shore can collect them.

```
d(p)       = distance from land pixel p to the nearest water pixel
InnerArea  = land with d <= SUPPLY_INNER_MARGIN_PX       (18 px)
OuterArea  = land with d <= SUPPLY_OUTER_MARGIN_PX       (60 px)
Band       = (OuterArea AND NOT InnerArea) AND NOT Canopy
             -> open 3x3 -> drop pieces < SUPPLY_MIN_SEGMENT_AREA_PX (250 px)
Segments   = connected pieces of Band, largest first (S1, S2, ...)
```

The **inner margin** is the boundary of InnerArea (a standoff from the water's
edge, equal to the water buffer); the **outer margin** is the boundary of
OuterArea (how far back from the water the band reaches). Both are
iso-distance lines on the land side of the water edge. Each segment reports
area, share of the band, bounding box, centroid and an anchor (the band pixel
farthest from the segment's edges, used for labels — not a recommended
point). The response also reports how much land between the margins was
removed as canopy.

| Setting | Default | Meaning |
|---|---|---|
| `SUPPLY_INNER_MARGIN_PX` | 18 | inner margin, from the water's edge |
| `SUPPLY_OUTER_MARGIN_PX` | 60 | outer margin, from the water's edge |
| `SUPPLY_MIN_SEGMENT_AREA_PX` | 250 | smaller fragments are dropped |
| `SUPPLY_MAX_SEGMENTS_REPORTED` | 8 | segments listed in the response |

"Margin" and "clearance" are pixel distances used by the algorithm, not
physical safety distances. The band is land near detected water in this image
— its surface, slope, structures and obstacles are not assessed.

## 9. Visualisations (`services/visualization.py`)

Seven base64 PNGs, always returned, all on the processed image's pixel grid:

| Key | Content |
|---|---|
| `original` | the resized upload |
| `water_mask` | detected water over a dimmed greyscale copy of the scene |
| `candidate_mask` | binary candidate mask (open land outside the buffer) |
| `sensor_zones` | water tint, ranked region outlines, purple sensor circles with labels — nothing inside the circles |
| `supply_zones` | water tint, green band, inner margin (solid line) and outer margin (dashed line), canopy between the margins greyed, largest segments labelled `S1…` |
| `isolated_regions` | potentially isolated land regions, outlined and scored |
| `final_analysis` | combined: green band with both margins, purple sensor circles, labels and a legend |

Margins are drawn only where they border the green band, so canopy-covered
shoreline does not fill the image with loops. Labels are tried above and
below their anchor, then shifted sideways; the position with the least overlap
wins. Every drawing happens on a copy; the upload itself is never modified.

## 10. Supplementary object detection (`services/ai_detection.py`)

An eighth image, `ai_context`, is added to the response only when this stage
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
  scoring, sensor drop zones or the supply drop zone in any way. It reads the processed image and writes only to
  its own part of the response (`ai` and `images.ai_context`).
- Fails safe: if `onnxruntime` isn't installed, the model file is missing,
  `AI_ENABLED=false`, or inference raises for any reason, the function
  returns a failure result instead of raising. The caller then reports `analysis_mode.ai = false` and
  every other field in the response is unaffected.

## Not implemented

- Obstacle detection (buildings, power lines, vehicles). Tree canopy is the
  only obstacle modelled.
- Georeferencing — pixel distances never convert to real-world distances.
- Any check of what is physically inside a sensor or supply drop zone (surface,
  slope, obstacles, people).
- Multi-image or temporal (before/after) analysis.
- Any accuracy evaluation against a labelled flood-imagery dataset.
