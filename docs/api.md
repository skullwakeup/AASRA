# AASRA API

Base URL (local development): `http://127.0.0.1:8000`

## `GET /health`

200:

```json
{
  "success": true,
  "status": "ok",
  "service": "AASRA",
  "version": "0.1.0",
  "analysis_mode": { "opencv": true, "ai": false },
  "limits": {
    "max_file_size_mb": 15,
    "max_image_dimension": 1024,
    "allowed_extensions": [".jpeg", ".jpg", ".png"],
    "max_zones": 3
  }
}
```

## `POST /api/analyze`

Request: `multipart/form-data`, field `image` (JPG / JPEG / PNG, ≤ 15 MB).

200 response shape (values shown are illustrative of the *format only* — every
number in a real response is computed from the uploaded image):

```json
{
  "success": true,
  "analysis_mode": { "opencv": true, "ai": true },

  "image_info": {
    "original_width": 1920, "original_height": 1080,
    "processed_width": 1024, "processed_height": 576, "scale": 0.5333
  },

  "parameters": {
    "water_buffer_px": 18,
    "min_region_area_px": 1500,
    "min_isolated_area_px": 800,
    "max_zones": 3,
    "score_weights": { "area": 0.4, "water_clearance": 0.4, "openness": 0.2 }
  },

  "metrics": {
    "water_percentage": 0,
    "non_water_percentage": 0,
    "candidate_regions": 0,
    "isolated_regions": 0,
    "candidate_area_percentage": 0
  },

  "zones": [
    {
      "id": 1,
      "score": 91.2,
      "classification": "HIGH POTENTIAL",
      "pixel_area": 12400,
      "water_clearance": 46.0,
      "region_clearance": 38.0,
      "bounding_box": { "x": 420, "y": 250, "width": 200, "height": 140 },
      "centroid": { "x": 512.4, "y": 318.7 },
      "drop_point": { "x": 500, "y": 320 },
      "score_breakdown": {
        "area_score": 90.0,
        "water_clearance_score": 92.0,
        "openness_score": 88.0
      }
    }
  ],

  "isolated_regions": [
    {
      "id": 1,
      "isolation_score": 87.4,
      "classification": "HIGH ISOLATION",
      "pixel_area": 5300,
      "bounding_box": { "x": 700, "y": 400, "width": 90, "height": 88 },
      "centroid": { "x": 744.1, "y": 443.9 },
      "score_breakdown": {
        "water_contact_ratio": 1.0,
        "separation_px": 133.2,
        "relative_size": 0.96
      }
    }
  ],

  "ai": {
    "status": "active",
    "model": "YOLO11n",
    "message": "Supplementary object detection. Detected objects are visible-object context only ...",
    "detections": [
      {
        "label": "person",
        "confidence": 0.91,
        "bbox": { "x1": 120, "y1": 80, "x2": 220, "y2": 350 }
      }
    ],
    "counts": { "person": 1, "car": 0, "truck": 0, "bus": 0, "boat": 0, "motorcycle": 0, "bicycle": 0 }
  },

  "warnings": [],

  "images": {
    "original": "<base64 png>",
    "water_mask": "<base64 png>",
    "candidate_mask": "<base64 png>",
    "isolated_regions": "<base64 png>",
    "final_analysis": "<base64 png>",
    "ai_context": "<base64 png>"
  },

  "notice": "Decision-support prototype. ..."
}
```

Rendering an image in a browser: `data:image/png;base64,<value>`.

### `analysis_mode` and `ai`

`analysis_mode.opencv` is always `true` — the OpenCV pipeline (water
detection through zone ranking) always runs and is never skipped.
`analysis_mode.ai` is `true` only for requests where the YOLO11n model
actually loaded **and** inference actually succeeded; it is independent of
and never influences the OpenCV result.

When AI succeeds, `ai.status` is `"active"` and `ai.detections` /
`ai.counts` are populated (an empty `detections` array with `status:
"active"` is normal — it means AI ran and found nothing, which is different
from AI being unavailable). When it fails, `ai.status` is `"unavailable"`
and only `ai.message` (a safe, generic string) is included — `images.ai_context`
is then an empty string.

`isolated_regions` is always computed and returned by the API regardless of
`analysis_mode.ai` — it comes from the OpenCV pipeline, not from YOLO. The
current frontend dashboard does not display this section, but the data and
its `images.isolated_regions` view remain available to any client that wants
them.

### Units

`pixel_area`, `water_clearance`, `region_clearance`, `separation_px`,
`drop_point`, `bounding_box` and `centroid` are all in **processed-image
pixels**. Use `image_info.scale` to map back to original-image coordinates
(`original = processed / scale`). Nothing here is in metres.

### Errors

```json
{ "success": false, "error": { "code": "FILE_TOO_LARGE", "message": "..." } }
```

`UNSUPPORTED_FILE_TYPE` (415), `UNSUPPORTED_CONTENT_TYPE` (415), `EMPTY_FILE`
(400), `FILE_TOO_LARGE` (413), `CORRUPT_IMAGE` (400), `IMAGE_TOO_SMALL` (400),
`UPLOAD_READ_FAILED` (400), `ANALYSIS_FAILED` (500), `INTERNAL_ERROR` (500).

"No water detected", "no candidate zones" and "no isolated regions" are **not**
errors: the response is 200 with empty lists and a message in `warnings`.
