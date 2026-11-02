# AASRA API

Base URL (local development): `http://127.0.0.1:8000`. Interactive docs:
`/docs`.

All coordinates, distances and areas are **pixels of the processed image**
(longest edge ≤ 1024 px). Use `image_info.scale` to map back to the upload
(`original = processed / scale`). Nothing is in metres.

## `GET /health`

Cheap liveness and capability probe. It never loads the AI model.

```json
{
  "success": true,
  "status": "ok",
  "service": "AASRA",
  "version": "0.1.0",
  "analysis_mode": { "opencv": true, "ai": true },
  "ai_runtime": {
    "available": true,
    "loaded": true,
    "runtime": "onnxruntime",
    "model": "YOLO11n",
    "input_size": 640
  },
  "limits": {
    "max_file_size_mb": 15,
    "max_image_dimension": 1024,
    "allowed_extensions": [".jpeg", ".jpg", ".png"],
    "max_zones": 3
  }
}
```

`analysis_mode.ai` here reports whether the AI supplement *can* run
(`AI_ENABLED`, `onnxruntime` importable, model file present). When it cannot,
`ai_runtime` is `{ "available": false, "reason": "..." }`. On Linux the
response also carries `memory.rss_mb`.

## `POST /api/analyze`

Request: `multipart/form-data`, field **`image`** (JPG / JPEG / PNG, ≤ 15 MB).

```bash
curl -X POST http://127.0.0.1:8000/api/analyze -F "image=@flood.jpg"
```

### 200 response

A real response for `frontend/public/imagery/sample-pakistan-2010.jpg`,
trimmed to one entry per list (the full response has 3 zones, 3 sensor drop
zones, 8 supply-band segments and 4 isolated regions) and with image data
replaced by its length:

```json
{
  "success": true,
  "analysis_mode": {
    "opencv": true,
    "ai": true
  },
  "ai": {
    "status": "active",
    "model": "YOLO11n",
    "message": "Supplementary object detection. Detected objects are visible-object context only \u2014 not flood, victim, rescue or hazard identification, and never fused into the OpenCV water/zone analysis.",
    "detections": [],
    "counts": {
      "person": 0,
      "car": 0,
      "truck": 0,
      "bus": 0,
      "boat": 0,
      "motorcycle": 0,
      "bicycle": 0
    }
  },
  "image_info": {
    "original_width": 1600,
    "original_height": 935,
    "processed_width": 1024,
    "processed_height": 598,
    "scale": 0.64
  },
  "parameters": {
    "water_buffer_px": 18,
    "min_region_area_px": 1500,
    "min_isolated_area_px": 800,
    "max_zones": 3,
    "sensor": {
      "radius_margin_px": 4,
      "min_radius_px": 12,
      "max_radius_px": 180
    },
    "supply": {
      "inner_margin_px": 18,
      "outer_margin_px": 60,
      "min_segment_area_px": 250
    },
    "canopy_excluded": true,
    "scene_colour_model": true,
    "score_weights": {
      "area": 0.4,
      "water_clearance": 0.4,
      "openness": 0.2
    }
  },
  "metrics": {
    "water_percentage": 38.06,
    "non_water_percentage": 61.94,
    "candidate_regions": 5,
    "isolated_regions": 4,
    "sensor_zones": 3,
    "supply_zone_segments": 8,
    "supply_area_percentage": 14.72,
    "canopy_percentage": 26.68,
    "candidate_area_percentage": 17.35
  },
  "zones": [
    {
      "id": 1,
      "score": 86.9,
      "classification": "HIGH POTENTIAL",
      "pixel_area": 64249,
      "water_clearance": 102.48,
      "region_clearance": 84.2,
      "bounding_box": {
        "x": 85,
        "y": 119,
        "width": 490,
        "height": 382
      },
      "centroid": { "x": 289.4, "y": 334.4 },
      "max_clearance_point": { "x": 219, "y": 384 },
      "score_breakdown": {
        "area_score": 100.0,
        "water_clearance_score": 100.0,
        "openness_score": 34.4
      }
    }
  ],
  "sensor_zones": [
    {
      "id": 1,
      "zone_id": 1,
      "score": 86.9,
      "classification": "HIGH POTENTIAL",
      "center": { "x": 219, "y": 384 },
      "radius_px": 80,
      "limiting_factor": "water_buffer",
      "limiting_distance_px": 84.01,
      "water_clearance_px": 102.48,
      "score_breakdown": {
        "area_score": 100.0,
        "water_clearance_score": 100.0,
        "openness_score": 34.4
      }
    }
  ],
  "supply_zone": {
    "inner_margin_px": 18,
    "outer_margin_px": 60,
    "pixel_area": 90155,
    "area_percentage": 14.72,
    "shoreline_land_px": 170445,
    "canopy_excluded_px": 78985,
    "segment_count": 8,
    "segments": [
      {
        "id": 1,
        "pixel_area": 50035,
        "share_of_band": 55.5,
        "bounding_box": {
          "x": 84,
          "y": 118,
          "width": 492,
          "height": 384
        },
        "centroid": { "x": 303.5, "y": 318.4 },
        "anchor": { "x": 330, "y": 292 }
      }
    ]
  },
  "sensor_analysis": {
    "evaluated": 3,
    "viable": 3,
    "not_viable": []
  },
  "isolated_regions": [
    {
      "id": 1,
      "isolation_score": 74.6,
      "classification": "MODERATE ISOLATION",
      "pixel_area": 5919,
      "bounding_box": {
        "x": 61,
        "y": 147,
        "width": 100,
        "height": 80
      },
      "centroid": { "x": 110.7, "y": 189.4 },
      "score_breakdown": {
        "water_contact_ratio": 1.0,
        "separation_px": 33.97,
        "relative_size": 0.9837
      }
    }
  ],
  "warnings": [],
  "images": {
    "original": "<base64 PNG, 1,440,472 chars>",
    "water_mask": "<base64 PNG, 812,752 chars>",
    "candidate_mask": "<base64 PNG, 13,212 chars>",
    "sensor_zones": "<base64 PNG, 1,409,444 chars>",
    "supply_zones": "<base64 PNG, 1,358,172 chars>",
    "isolated_regions": "<base64 PNG, 1,403,492 chars>",
    "final_analysis": "<base64 PNG, 1,376,932 chars>",
    "ai_context": "<base64 PNG, 1,434,272 chars>"
  },
  "notice": "Computer-vision decision-support prototype. Probable Smart Sensor Drop Zones and the Probable Supply Drop Zone are derived from image geometry only, in image pixels, and must be verified by trained personnel on the ground. No safety, landing, access or rescue claim is made."
}
```

Rendering an image in a browser: `data:image/png;base64,<value>`. The whole
response for a 1024-px image is several MB (≈7 MB here), almost all of it
image data.

### Drop-zone fields

The storage zones and their inner drop points have been replaced by two
separate results. `storage_zones`, `storage_analysis`, `metrics.storage_zones`,
`metrics.drop_zones`, `parameters.storage` and `images.drop_zones` are gone;
`zones[].drop_point` is renamed `zones[].max_clearance_point`.

| Field | Meaning |
|---|---|
| `metrics.sensor_zones` | ranked zones that produced a Probable Smart Sensor Drop Zone |
| `metrics.supply_zone_segments` | pieces of the Probable Supply Drop Zone band |
| `metrics.supply_area_percentage` | share of the image covered by the band |
| `metrics.canopy_percentage` | share of the image classified as tree canopy (excluded) |
| `parameters.sensor` | radius margin, minimum and maximum radius |
| `parameters.supply` | inner margin, outer margin, minimum segment area |
| `parameters.canopy_excluded`, `scene_colour_model` | whether canopy was excluded / the per-scene water colour model ran |
| `sensor_zones[]` | one purple circle per viable ranked zone, in rank order |
| `sensor_zones[].id`, `zone_id` | both equal the ranked zone's `zones[].id` |
| `sensor_zones[].score`, `classification`, `score_breakdown` | copied from that zone (region score) |
| `sensor_zones[].center` | the zone's `max_clearance_point`, unchanged |
| `sensor_zones[].radius_px` | integer radius of the verified circle |
| `sensor_zones[].limiting_factor` | `water_buffer`, `candidate_boundary` (incl. canopy), `image_boundary` or `max_radius` |
| `sensor_zones[].limiting_distance_px` | centre → limiting pixel, before the margin |
| `sensor_zones[].water_clearance_px` | centre → nearest detected water |
| `sensor_analysis.evaluated` / `viable` | ranked zones considered / that produced a sensor zone |
| `sensor_analysis.not_viable[]` | `{ zone_id, reason, radius_px }`; reason is `radius_below_minimum`, `center_in_excluded_area` or `duplicate_center` |
| `supply_zone.inner_margin_px` / `outer_margin_px` | the two margins, measured from the water's edge |
| `supply_zone.pixel_area`, `area_percentage` | size of the green band |
| `supply_zone.shoreline_land_px` / `canopy_excluded_px` | land between the margins / how much of it was canopy |
| `supply_zone.segment_count` | number of band pieces |
| `supply_zone.segments[]` | the largest pieces (up to 8): `id` (S1…), `pixel_area`, `share_of_band`, `bounding_box`, `centroid`, `anchor` |
| `images.sensor_zones` / `supply_zones` | each result on its own |
| `images.final_analysis` | both results together |

Formulas: [`docs/pipeline.md`](pipeline.md) §7–§8.

### `analysis_mode` and `ai`

`analysis_mode.opencv` is always `true`. `analysis_mode.ai` is `true` only
when the YOLO11n model loaded **and** inference succeeded for this request.
AI output never influences water, zones, sensor drop zones or the supply drop zone.

When AI succeeds, `ai.status` is `"active"` with `detections` and `counts`
(an empty `detections` list is normal). When it fails or is disabled,
`ai` is `{ "status": "unavailable", "message": "..." }` and
`images.ai_context` is an empty string.

### Empty results are not errors

No water, no candidate zone, no viable sensor zone, no supply band or no
isolated region still returns 200, with empty lists and an entry in
`warnings` (for example `"No open land was found between the inner and outer
margins around the detected water, so no Probable Supply Drop Zone is
shown."`). All seven analysis images are still returned.

### Errors

```json
{ "success": false, "error": { "code": "FILE_TOO_LARGE", "message": "File is too large. Maximum size is 15 MB." } }
```

| Code | HTTP | Cause |
|---|---|---|
| `UNSUPPORTED_FILE_TYPE` | 415 | extension is not .jpg/.jpeg/.png |
| `UNSUPPORTED_CONTENT_TYPE` | 415 | declared MIME type is not JPEG/PNG |
| `EMPTY_FILE` | 400 | zero-byte upload |
| `FILE_TOO_LARGE` | 413 | above 15 MB |
| `CORRUPT_IMAGE` | 400 | bytes could not be decoded |
| `IMAGE_TOO_SMALL` | 400 | shorter side below 64 px |
| `UPLOAD_READ_FAILED` | 400 | the upload stream could not be read |
| `IMAGE_TOO_LARGE_TO_PROCESS` | 413 | out of memory during analysis |
| `ANALYSIS_FAILED` | 500 | unexpected internal error (logged server-side) |
| `INTERNAL_ERROR` | 500 | any other unhandled error |

A request without the `image` field is rejected by FastAPI's own validation
with 422 and its standard `{"detail": [...]}` body. Stack traces are never
returned.
