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
  "analysis_mode": { "opencv": true, "ai": false },

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

  "warnings": [],

  "images": {
    "original": "<base64 png>",
    "water_mask": "<base64 png>",
    "candidate_mask": "<base64 png>",
    "isolated_regions": "<base64 png>",
    "final_analysis": "<base64 png>"
  },

  "notice": "Decision-support prototype. ..."
}
```

Rendering an image in a browser: `data:image/png;base64,<value>`.

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
