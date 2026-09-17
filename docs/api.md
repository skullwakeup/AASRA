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
trimmed to one entry per list (the full response has 3 zones, 3 storage
zones, 18 drop zones and 19 isolated regions) and with image data replaced by
its length:

```json
{
  "success": true,
  "analysis_mode": { "opencv": true, "ai": true },
  "ai": {
    "status": "active",
    "model": "YOLO11n",
    "message": "Supplementary object detection. Detected objects are visible-object context only — not flood, victim, rescue or hazard identification, and never fused into the OpenCV water/zone analysis.",
    "detections": [],
    "counts": { "person": 0, "car": 0, "truck": 0, "bus": 0, "boat": 0, "motorcycle": 0, "bicycle": 0 }
  },
  "image_info": {
    "original_width": 1600, "original_height": 935,
    "processed_width": 1024, "processed_height": 598, "scale": 0.64
  },
  "parameters": {
    "water_buffer_px": 18,
    "min_region_area_px": 1500,
    "min_isolated_area_px": 800,
    "max_zones": 3,
    "storage": {
      "radius_margin_px": 4,
      "min_radius_px": 12,
      "max_radius_px": 180,
      "drop_zone_radius_px": 10,
      "min_drop_point_distance_px": 28,
      "max_drop_points_per_storage_zone": 8,
      "drop_score_weights": { "clearance": 0.4, "water_clearance": 0.3, "proximity": 0.3 }
    },
    "score_weights": { "area": 0.4, "water_clearance": 0.4, "openness": 0.2 }
  },
  "metrics": {
    "water_percentage": 64.86,
    "non_water_percentage": 35.14,
    "candidate_regions": 3,
    "isolated_regions": 19,
    "storage_zones": 3,
    "drop_zones": 18,
    "candidate_area_percentage": 16.52
  },
  "zones": [
    {
      "id": 1,
      "score": 92.0,
      "classification": "HIGH POTENTIAL",
      "pixel_area": 42656,
      "water_clearance": 98.86,
      "region_clearance": 80.98,
      "bounding_box": { "x": 657, "y": 386, "width": 367, "height": 212 },
      "centroid": { "x": 861.5, "y": 508.7 },
      "drop_point": { "x": 859, "y": 516 },
      "score_breakdown": { "area_score": 100.0, "water_clearance_score": 100.0, "openness_score": 59.9 }
    }
  ],
  "storage_zones": [
    {
      "id": 1,
      "zone_id": 1,
      "score": 92.0,
      "classification": "HIGH POTENTIAL",
      "center": { "x": 859, "y": 516 },
      "radius_px": 77,
      "limiting_factor": "water_buffer",
      "limiting_distance_px": 81.39,
      "limiting_point": { "x": 919, "y": 461 },
      "water_clearance_px": 98.86,
      "sampled_points": 41,
      "sampling_ring_radii_px": [76, 71, 43],
      "candidate_drop_zones": [
        {
          "id": 1,
          "point": { "x": 819, "y": 501 },
          "radius_px": 10,
          "score": 74.6,
          "classification": "MODERATE POTENTIAL",
          "clearance_px": 60.14,
          "water_clearance_px": 77.78,
          "distance_from_storage_center_px": 42.72,
          "score_breakdown": { "clearance_score": 78.1, "water_clearance_score": 100.0, "proximity_score": 44.5 }
        }
      ],
      "rejected_points": [
        { "x": 866, "y": 592, "reason": "insufficient_clearance" }
      ]
    }
  ],
  "storage_analysis": { "evaluated": 3, "viable": 3, "not_viable": [] },
  "isolated_regions": [
    {
      "id": 1,
      "isolation_score": 99.9,
      "classification": "HIGH ISOLATION",
      "pixel_area": 832,
      "bounding_box": { "x": 378, "y": 0, "width": 56, "height": 21 },
      "centroid": { "x": 408.3, "y": 7.5 },
      "score_breakdown": { "water_contact_ratio": 1.0, "separation_px": 304.06, "relative_size": 0.994 }
    }
  ],
  "warnings": [],
  "images": {
    "original": "<base64 PNG, 1,456,360 chars>",
    "water_mask": "<base64 PNG, 824,204 chars>",
    "candidate_mask": "<base64 PNG, 8,576 chars>",
    "drop_zones": "<base64 PNG, 723,416 chars>",
    "isolated_regions": "<base64 PNG, 1,315,860 chars>",
    "final_analysis": "<base64 PNG, 1,343,948 chars>",
    "ai_context": "<base64 PNG, 1,444,432 chars>"
  },
  "notice": "Computer-vision decision-support prototype. Storage and drop zones are probable locations derived from image geometry only, in image pixels, and must be verified by trained personnel on the ground. No safety, landing, access or rescue claim is made."
}
```

Rendering an image in a browser: `data:image/png;base64,<value>`. The whole
response for a 1024-px image is several MB (≈7 MB here), almost all of it
image data.

### Fields added for storage and drop zones

The response is a strict superset of the previous version: every earlier
field is still present with the same meaning.

| Field | Meaning |
|---|---|
| `metrics.storage_zones` | ranked zones that produced a probable storage zone |
| `metrics.drop_zones` | probable drop zones across all storage zones |
| `parameters.storage` | the storage / drop-zone settings used for this run |
| `storage_zones[]` | one per viable ranked zone, in rank order |
| `storage_zones[].id`, `zone_id` | both equal the ranked zone's `zones[].id` |
| `storage_zones[].score`, `classification` | copied from that zone (region score) |
| `storage_zones[].center` | the zone's `drop_point` (max-clearance point), unchanged |
| `storage_zones[].radius_px` | integer radius of the verified circle |
| `storage_zones[].limiting_factor` | `water_buffer`, `candidate_boundary`, `image_boundary` or `max_radius` |
| `storage_zones[].limiting_distance_px` | centre → limiting pixel, before the margin |
| `storage_zones[].limiting_point` | that pixel; `null` for `max_radius` |
| `storage_zones[].water_clearance_px` | centre → nearest detected water |
| `storage_zones[].sampled_points`, `sampling_ring_radii_px` | how drop points were searched |
| `candidate_drop_zones[]` | accepted drop zones, best score first |
| `candidate_drop_zones[].point` | the drop point |
| `candidate_drop_zones[].radius_px` | drop-zone radius (= required clearance) |
| `candidate_drop_zones[].score`, `classification`, `score_breakdown` | spatial drop-point score (0–100) — **not** the region score |
| `candidate_drop_zones[].clearance_px` | distance to the nearest excluded pixel or image edge |
| `candidate_drop_zones[].water_clearance_px` | distance to the nearest detected water |
| `candidate_drop_zones[].distance_from_storage_center_px` | distance to the storage centre |
| `rejected_points[]` | samples that failed a filter, with `reason` (`outside_image`, `outside_storage_zone`, `water`, `water_buffer`, `outside_candidate_region`, `insufficient_clearance`) |
| `storage_analysis.evaluated` / `viable` | ranked zones considered / that produced a storage zone |
| `storage_analysis.not_viable[]` | `{ zone_id, reason, radius_px }`; reason is `radius_below_minimum`, `center_in_excluded_area` or `duplicate_center` |
| `images.drop_zones` | the derivation view (see `docs/pipeline.md` §9) |

Formulas: [`docs/pipeline.md`](pipeline.md) §7–§8.

### `analysis_mode` and `ai`

`analysis_mode.opencv` is always `true`. `analysis_mode.ai` is `true` only
when the YOLO11n model loaded **and** inference succeeded for this request.
AI output never influences water, zones, storage zones or drop zones.

When AI succeeds, `ai.status` is `"active"` with `detections` and `counts`
(an empty `detections` list is normal). When it fails or is disabled,
`ai` is `{ "status": "unavailable", "message": "..." }` and
`images.ai_context` is an empty string.

### Empty results are not errors

No water, no candidate zone, no viable storage zone or no isolated region
still returns 200, with empty lists and an entry in `warnings` (for example
`"Candidate zones were found, but none had enough clearance for a probable
storage zone (minimum radius 12 px)."`). All six analysis images are still
returned.

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
