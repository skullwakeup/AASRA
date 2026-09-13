# AASRA backend

FastAPI + OpenCV. No AI/ML, no external APIs, no API keys, no cloud services.

## Install and run

```bash
cd backend
python -m venv .venv
# Windows:   .venv\Scripts\activate
# Linux/mac: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

`uvicorn` must be started from the `backend/` directory so that `app` is
importable.

## Endpoints

### `GET /health`

```json
{
  "success": true,
  "status": "ok",
  "service": "AASRA",
  "version": "0.1.0",
  "analysis_mode": { "opencv": true, "ai": false },
  "limits": { "max_file_size_mb": 15, "max_image_dimension": 1024, "...": "..." }
}
```

### `POST /api/analyze`

`multipart/form-data`, single field **`image`** — JPG, JPEG or PNG, max 15 MB.

```bash
curl -X POST http://127.0.0.1:8000/api/analyze -F "image=@flood.jpg"
```

Success (200) returns `success`, `analysis_mode`, `image_info`, `parameters`,
`metrics`, `zones`, `isolated_regions`, `warnings`, `images` (base64 PNG) and a
`notice`. See `docs/api.md` for the full shape.

Errors return a clean envelope — never a stack trace:

```json
{ "success": false, "error": { "code": "CORRUPT_IMAGE", "message": "..." } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `UNSUPPORTED_FILE_TYPE` | 415 | extension is not .jpg/.jpeg/.png |
| `UNSUPPORTED_CONTENT_TYPE` | 415 | declared MIME type is not JPEG/PNG |
| `EMPTY_FILE` | 400 | zero-byte upload |
| `FILE_TOO_LARGE` | 413 | above `MAX_FILE_SIZE_MB` |
| `CORRUPT_IMAGE` | 400 | bytes could not be decoded |
| `IMAGE_TOO_SMALL` | 400 | below `MIN_IMAGE_DIMENSION` |
| `ANALYSIS_FAILED` | 500 | unexpected internal error (logged server-side) |

Conditions that are *not* errors — they return 200 with a `warnings` entry and
empty `zones` / `isolated_regions`: no water detected, no valid candidate zone,
no isolated region.

## Configuration

Everything tunable lives in `app/config.py`, documented inline: image limits,
water-detection thresholds and weights, `WATER_BUFFER_SIZE`, `MIN_REGION_AREA`,
`MIN_ISOLATED_AREA`, scoring weights and `MAX_ZONES`.

## Offline pipeline check

```bash
cd backend
python -m tests.smoke_test                  # synthetic scene
python -m tests.smoke_test path/to/real.jpg # a real aerial image
```

Prints metrics, zones and isolated regions, and writes the five visualisations
to `tests/output/`. The synthetic scene proves the pipeline runs end to end; it
is **not** an accuracy benchmark.
