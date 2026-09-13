# AASRA backend

FastAPI + OpenCV. The core water-detection and zone-scoring pipeline is pure
computer vision — no trained model, no external API, no API key, no cloud
service. A separate, optional module (`app/services/ai_detection.py`) adds a
small YOLO11n object-detection pass as supplementary context; see
[Supplementary AI](#supplementary-ai-object-detection) below. It never
influences the OpenCV pipeline and the backend works fully without it.

## Install and run

```bash
cd backend
python -m venv .venv
# Windows:   .venv\Scripts\activate
# Linux/mac: source .venv/bin/activate
pip install -r requirements.txt
pip install --no-deps ultralytics==8.3.253
uvicorn app.main:app --reload --port 8000
```

Two install commands, not one: `ultralytics` declares a hard dependency on
`opencv-python`, which conflicts with this project's `opencv-python-headless`
(both provide the `cv2` module). Installing it separately with `--no-deps`
avoids that conflict — see the comment at the bottom of `requirements.txt`
for the full explanation. Every other dependency `ultralytics` needs is
already listed in `requirements.txt`.

`uvicorn` must be started from the `backend/` directory so that `app` is
importable. Requires Python 3.13 (pinned in `.python-version`).

For CORS and Render/Vercel-specific deployment notes, see
[`docs/deployment.md`](../docs/deployment.md).

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

`analysis_mode` here is a static configuration snapshot, not a per-request
result — `/health` always reports `ai: false`. The real, per-request value is
only in the `POST /api/analyze` response (see below), where `ai` is `true`
only when the YOLO model actually loaded and inference actually succeeded for
that specific image.

### `POST /api/analyze`

`multipart/form-data`, single field **`image`** — JPG, JPEG or PNG, max 15 MB.

```bash
curl -X POST http://127.0.0.1:8000/api/analyze -F "image=@flood.jpg"
```

Success (200) returns `success`, `analysis_mode`, `ai` (YOLO detection
summary), `image_info`, `parameters`, `metrics`, `zones`, `isolated_regions`,
`warnings`, `images` (base64 PNG) and a `notice`. See `docs/api.md` for the
full shape.

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
`MIN_ISOLATED_AREA`, scoring weights and `MAX_ZONES`. YOLO's own confidence
threshold (`MIN_DETECTION_CONFIDENCE`) lives separately in
`app/services/ai_detection.py`, since it is not part of the OpenCV pipeline.

One environment variable is read at startup, in `app/main.py`:
`CORS_ORIGINS` — a comma-separated list of extra allowed origins for the
deployed frontend (e.g. a Vercel URL). `http://localhost:3000` and
`http://127.0.0.1:3000` are always allowed and need no configuration for
local development. No other environment variable is required anywhere in
this project.

## Supplementary AI object detection

`app/services/ai_detection.py` runs a small Ultralytics **YOLO11n** model
over the same resized image the OpenCV stages use, to report visible
`person`, `car`, `truck`, `bus`, `boat`, `motorcycle` and `bicycle` objects as
extra context. It:

- loads lazily (never at process startup) and is cached after the first
  successful load;
- downloads its ~5.6 MB weight file automatically on first use to
  `app/services/weights/` (needs internet only that first time);
- runs once per request, independently of the OpenCV pipeline — its output
  is attached to the response and never fed back into water detection,
  candidate regions, or zone scoring;
- fails safe: if `ultralytics`/`torch` aren't installed, the download fails,
  or inference errors, `/api/analyze` still returns a complete OpenCV result
  with `analysis_mode.ai = false` and a short, safe `ai.message`. No
  traceback ever reaches the client.

Detecting a person or vehicle is reported only as a visible object — never as
a flood victim, a stranded person, or a rescue asset.

## Offline pipeline check

```bash
cd backend
python tests/smoke_test.py                    # synthetic scene
python tests/smoke_test.py path/to/real.jpg   # a real aerial image
```

Prints metrics, zones, isolated regions and the YOLO detection summary, and
writes every visualisation to `tests/output/`. The synthetic scene proves the
pipeline runs end to end; it is **not** an accuracy benchmark.

> Run it as a script (`python tests/smoke_test.py`), not as
> `python -m tests.smoke_test`: the `ultralytics` package installs its own
> `tests/` directory into `site-packages`, which shadows this project's
> `tests` package under `-m` module resolution. Running the file directly
> avoids the collision.
