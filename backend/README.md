# AASRA backend

FastAPI + OpenCV. Water detection, candidate regions, zone scoring and the
probable storage / drop-zone geometry are deterministic computer vision — no
trained model, no external API, no API key. A separate module
(`app/services/ai_detection.py`) adds YOLO11n object detection on ONNX
Runtime as supplementary context; it never influences the OpenCV results and
the backend works fully without it.

## Install and run

```bash
cd backend
python -m venv .venv
# Windows:   .venv\Scripts\activate
# Linux/mac: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Start `uvicorn` from `backend/` so `app` is importable. Python 3.13 is pinned
in `.python-version` (NumPy 2.1.3 has no wheels for 3.14). A single
`pip install` is the whole build; see the comments in `requirements.txt`.

## Pipeline

```
preprocessing -> water_detection -> candidate_mask -> region_analysis
  -> isolated_regions -> scoring -> storage_zones -> visualization
ai_detection runs separately on the same resized image
```

| Module | Responsibility |
|---|---|
| `preprocessing.py` | decode, validate, resize (≤ 1024 px), analysis copy |
| `water_detection.py` | multi-cue water mask |
| `candidate_mask.py` | water buffer (18 px) and candidate mask (renamed from `drop_zone_detection.py`) |
| `region_analysis.py` | connected regions, max-clearance point, clearances, openness |
| `isolated_regions.py` | land cut off from the main landmass |
| `scoring.py` | 0–100 region score, top 3 |
| `storage_zones.py` | storage radius around each zone's max-clearance point; drop-zone sampling, filtering, scoring, spacing |
| `visualization.py` | `original`, `water_mask`, `candidate_mask`, `drop_zones`, `isolated_regions`, `final_analysis` |
| `ai_detection.py` | YOLO11n detections and `ai_context` image |

Formulas: [`docs/pipeline.md`](../docs/pipeline.md).

## Endpoints

- `GET /health` — status, limits, `ai_runtime` (whether the AI supplement can
  run, without loading it) and, on Linux, `memory.rss_mb`.
- `POST /api/analyze` — `multipart/form-data`, field **`image`** (JPG, JPEG
  or PNG, ≤ 15 MB).

```bash
curl -X POST http://127.0.0.1:8000/api/analyze -F "image=@flood.jpg"
```

Success returns `success`, `analysis_mode`, `ai`, `image_info`,
`parameters`, `metrics`, `zones`, `storage_zones`, `storage_analysis`,
`isolated_regions`, `warnings`, `images` and `notice`. Field reference and a
real example: [`docs/api.md`](../docs/api.md).

Errors use a clean envelope and never include a traceback:

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

No water, no candidate zone or no viable storage zone is not an error: the
response is 200 with empty lists and a `warnings` entry.

## Configuration

Everything tunable lives in `app/config.py`, documented inline. Storage and
drop-zone settings:

| Setting | Default | Meaning |
|---|---|---|
| `STORAGE_RADIUS_MARGIN_PX` | 4 | pixel gap kept from the nearest excluded pixel |
| `MIN_STORAGE_RADIUS_PX` | 12 | smaller storage circles are reported as not viable |
| `MAX_STORAGE_RADIUS_PX` | 180 | upper bound on the storage radius |
| `DROP_POINT_MIN_CLEARANCE_PX` | 10 | drop-zone radius; minimum clearance of a drop point |
| `MIN_DROP_POINT_DISTANCE_PX` | 28 | spacing between drop points and from the centre |
| `MAX_DROP_POINTS_PER_STORAGE_ZONE` | 8 | cap per storage zone |
| `DROP_SCORE_WEIGHT_CLEARANCE` / `_WATER_CLEARANCE` / `_PROXIMITY` | 0.40 / 0.30 / 0.30 | drop-point score weights |

All values are pixels of the processed image, not metres, and "margin" /
"clearance" are computational distances, not safety distances.

Environment variables:

| Variable | Default | Effect |
|---|---|---|
| `CORS_ORIGINS` | *(none)* | extra allowed origins, comma-separated; `http://localhost:3000` and `http://127.0.0.1:3000` are always allowed |
| `AI_ENABLED` | `true` | `false` disables object detection; everything else is unaffected |
| `AI_INPUT_SIZE` | `640` | network input edge (multiple of 32) |
| `AI_MEM_ARENA` | `false` | enable onnxruntime's CPU arena (faster, more memory) |

## Supplementary AI object detection

`ai_detection.py` runs **YOLO11n** through **ONNX Runtime (CPU)** from the
committed `app/services/weights/yolo11n.onnx` (~10 MB). Nothing is downloaded
at runtime. The session is created on first use and cached; it runs
single-threaded with the memory arena off so it fits a 512 MB instance. It
reports `person`, `car`, `truck`, `bus`, `boat`, `motorcycle` and `bicycle`.
Any failure returns `analysis_mode.ai = false` with a short message; the
OpenCV result is complete either way. A detected person or vehicle is
reported only as a visible object.

To regenerate the model (in a scratch environment with ultralytics):

```bash
yolo export model=yolo11n.pt format=onnx opset=12
```

## Tests

```bash
cd backend
python -m tests.test_storage_zones             # geometry tests, plain asserts
python -m tests.smoke_test                     # synthetic scene
python -m tests.smoke_test path/to/real.jpg    # a real image
python -m tests.verify_onnx                    # AI module (add --loops 20 for memory)
```

`test_storage_zones.py` checks, against brute-force geometry: radius limited
by the image edge, by nearby water, by one-sided water, by an irregular
region and by the nearest of several water bodies; tiny regions; drop-point
filtering and spacing; de-duplication; coordinate alignment after resizing a
2048 × 1536 upload (it reads the marker pixels back out of the rendered
image); the no-zone case; and the stage's runtime. `smoke_test.py` prints
metrics, zones, storage and drop zones and writes every image to
`tests/output/`; it is not an accuracy benchmark.
