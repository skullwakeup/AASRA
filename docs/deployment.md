# Deployment guide — Render (backend) + Vercel (frontend)

This is a production-readiness reference for deploying AASRA as:

- **Backend** → Render (Python web service)
- **Frontend** → Vercel (Next.js)

Nothing in this document changes the OpenCV pipeline or YOLO detection
behavior. It only covers packaging, configuration and hosting. The storage
and drop-zone stage added no dependency and no environment variable; its
settings are constants in `app/config.py`.

## Release order

The frontend now requires `storage_zones` and `parameters.storage` in the
analysis response. **Deploy the backend first**, confirm
`POST /api/analyze` returns `storage_zones`, then deploy the frontend. A new
frontend talking to an older backend shows an "older version" error
(`INCOMPATIBLE_BACKEND`) instead of results.

The live service is `https://aasra-api.onrender.com`, while `render.yaml`
names the service `aasra-backend`. If the live service was created by hand,
the Blueprint is not in use and this does not matter; if you do sync the
Blueprint, rename the service in `render.yaml` first so Render does not
create a second service.

## Backend — Render

### Root Directory

Set the service's **Root Directory** to `backend` in the Render dashboard
(or `rootDir: backend` if using the included `render.yaml` Blueprint — see
below). All commands and paths below assume this.

### Build command

```
pip install -r requirements.txt
```

One step. This replaced an earlier two-step build
(`... && pip install --no-deps ultralytics==8.3.253`) that existed solely
because `ultralytics` declares a hard dependency on `opencv-python` (not
`-headless`), and pip cannot apply `--no-deps` to one line of a requirements
file while resolving the rest normally. Without the separate step, pip
installed **both** `opencv-python` and `opencv-python-headless` side by side
— a broken combination, since both provide the same `cv2` module.

The AI supplement now runs on ONNX Runtime, which has no opencv dependency,
so the conflict no longer exists. See "ONNX Runtime instead of PyTorch"
below for why the swap happened.

### Start command

```
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Verified locally: the app starts and serves `/health` correctly when
launched this way with an arbitrary `$PORT` value, from the `backend/`
directory.

### Python version

`backend/.python-version` pins `3.13` (Render reads this file and selects
the latest 3.13.x patch automatically). `render.yaml` also sets
`PYTHON_VERSION=3.13` as a second, explicit guarantee, in case a monorepo
root-directory setup affects where Render looks for the file. Without a
pin, Render's default Python version depends on when the service was
created and is not guaranteed to match this project's tested version.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `CORS_ORIGINS` | Recommended once the frontend URL is known | Comma-separated list of extra allowed origins, e.g. `https://aasra.vercel.app,https://aasra-git-main-you.vercel.app`. Local dev origins (`http://localhost:3000`, `http://127.0.0.1:3000`) are always allowed by the app itself and need no configuration. |
| `PYTHON_VERSION` | Recommended | `3.13` — see above. |
| `PORT` | Set automatically by Render | Do not set manually; `$PORT` in the start command reads it. |
| `AI_ENABLED` | Optional (`true`) | Kill switch for the AI supplement. |
| `AI_INPUT_SIZE` | Optional (`640`) | YOLO input edge; `480` is cheaper. |
| `AI_MEM_ARENA` | Optional (`false`) | onnxruntime CPU arena. |

No API keys or secrets are required anywhere in this project.

### YOLO model weights

The model ships with the repository as
`backend/app/services/weights/yolo11n.onnx` (~10 MB). Nothing is downloaded
at runtime.

This replaced a lazy download of `yolo11n.pt` on first use. Render's
filesystem is **ephemeral** — a redeploy or restart wiped the cache, so the
first request after every deploy paid the download cost again, and a
transient network failure produced a half-written file. Committing the
exported model removes both problems: a cold start needs no outbound
internet for the AI path, and the file cannot be partially present.

If the model file is missing or `onnxruntime` is not installed, the app does
not crash: `analysis_mode.ai` reports `false`, `ai.message` explains which of
the two it was, and every OpenCV result is still returned normally.
`GET /health` reports the same thing under `ai_runtime` without loading the
model, so you can check a deployment's AI state without sending an image.

### OpenCV compatibility

Switched `opencv-python` → `opencv-python-headless` in
`requirements.txt`. `opencv-python` requires GUI/X11 shared libraries
(`libGL.so.1` and similar) that minimal Linux deployment images frequently
lack, which is one of the most common OpenCV deployment failures on
platforms like Render, Heroku, and slim Docker images. This codebase never
calls a GUI OpenCV function (`imshow`, `waitKey`, `namedWindow`,
`VideoCapture`, etc. — confirmed by search), so `opencv-python-headless` is
a safe, behavior-identical replacement. Verified by re-running the full
pipeline (water detection → zone scoring) and a real YOLO inference against
a fresh install of the headless package: identical output.

### ONNX Runtime instead of PyTorch

The AI supplement originally ran on `torch` + `torchvision` + `ultralytics`.
That stack does not fit Render's **free instance type: 0.1 CPU / 512 MB
RAM**. Importing `torch` alone costs roughly 250-300 MB RSS before a single
image is processed; adding OpenCV, NumPy, FastAPI and per-request image
buffers leaves no headroom under a hard 512 MB cap, and the process is
OOM-killed rather than degrading gracefully.

Install size was a secondary problem: `requirements.txt` had to pin
`torch==2.6.0+cpu` via `--extra-index-url https://download.pytorch.org/whl/cpu`,
because plain `torch==2.6.0` resolves to the default PyPI Linux wheel that
bundles CUDA at **~730 MB** versus **~180 MB** for the CPU-only wheel — for a
service that never touches a GPU.

ONNX Runtime with `yolo11n.onnx` is roughly a fifth of the memory, which is
what makes the AI supplement viable on the free tier at all. The trade is
that ultralytics' pre/post-processing is no longer available, so letterboxing,
output decoding and per-class NMS are implemented explicitly in
`ai_detection.py` and covered by `backend/tests/verify_onnx.py`.

Note that upgrading the Render plan does **not** solve the memory problem
cheaply: the Starter plan is also 512 MB (it adds CPU, not RAM). The first
plan with real headroom is 1 CPU / 2 GB.

#### Memory behaviour on a 512 MB instance

Approximate steady-state budget with the AI supplement active:

| Component | Approx. RSS |
|---|---|
| Python + FastAPI + uvicorn | ~70 MB |
| NumPy + OpenCV (headless) | ~110 MB |
| onnxruntime session + yolo11n | ~120 MB |
| Per-request buffers + base64 PNGs | ~40-60 MB, transient (estimate from the earlier five-image response) |

These figures were measured before the storage/drop-zone stage was added
and were not re-measured on Linux for this change. The stage itself adds one
distance transform and a few small masks per ranked zone (at most three
1024 × 1024 arrays at a time) and one more PNG to the response: in the tested
images the `drop_zones` image was about 0.7 MB of base64, and a complete
response for a 1024-px image was about 7 MB. Check `memory.rss_mb` on the
deployed instance after the first few analyses.

Memory **plateaus** across repeated images rather than climbing: the session
is created once and cached for the process lifetime, and the CPU memory arena
is disabled (`AI_MEM_ARENA=false`) so working memory is released after each
inference instead of being retained as a high-water mark. The risk on this
tier is a *spike* — two simultaneous uploads, or one unusually large image —
not gradual accumulation. `POST /api/analyze` is an `async def` that calls
blocking CPU code, so requests serialise on the event loop, which limits that
spike in practice.

`GET /health` reports this process's RSS under `memory.rss_mb`. Watch it
during a demo. If it approaches the cap, set `AI_ENABLED=false` in the Render
dashboard: the service restarts in about a minute and returns to
OpenCV-only behaviour with no redeploy and no code change.

### File upload size

`config.MAX_FILE_SIZE_MB = 15` is enforced in `app/main.py` after the
request body is fully read. This is unchanged and does not need to change
for deployment — Render's own platform-level request limits (if any) were
not found documented publicly at the time of writing; if very large uploads
ever fail before reaching this app-level check, that would be a
Render-platform limit to check directly with Render, not an application bug.

### Filesystem assumptions

The request-handling code writes nothing to disk: every image is processed in memory (NumPy arrays)
and returned as base64-encoded PNGs in the JSON response. `tests/smoke_test.py`
writes files to `tests/output/`, but that script is a local/offline
developer check, not part of the deployed API path.

## Frontend — Vercel

No code changes were needed here; this section documents what's already
correct.

- `frontend/lib/api.ts` reads the backend URL as
  `process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"` — the only
  place in the frontend that references a base URL. No Render/production URL
  is hardcoded anywhere (confirmed by search).
- **Local development:** works with zero configuration (falls back to
  `http://localhost:8000`), or via `frontend/.env.local` (gitignored, not
  committed).
- **Production (Vercel):** set the environment variable
  `NEXT_PUBLIC_API_URL` to the deployed Render backend's public URL
  (currently `https://aasra-api.onrender.com`) in the Vercel project's
  dashboard under Settings → Environment Variables. It is inlined at build
  time, so redeploy the frontend after changing it.
- Standard Vercel deployment for a Next.js App Router project needs no
  `vercel.json` — none was added.

## CORS

`app/main.py` now builds its allowed-origins list from
`["http://localhost:3000", "http://127.0.0.1:3000"]` plus whatever is in
`CORS_ORIGINS` (comma-separated), instead of `allow_origins=["*"]`. Verified
locally:

- A preflight request from `http://localhost:3000` is allowed with no
  environment variable set.
- A preflight request from an arbitrary, unlisted origin receives no
  `Access-Control-Allow-Origin` header (rejected).
- Setting `CORS_ORIGINS=https://aasra-demo.vercel.app` allows that origin
  **in addition to** localhost, not instead of it.

`allow_credentials=False` is unchanged — the API uses no cookies or
authentication, so this was never a credential-theft risk either way, but a
fixed origin list is safer against arbitrary third-party sites relaying
traffic through a visitor's browser, and is no harder to operate than a
wildcard.

If Vercel preview deployments (each on a random `*.vercel.app` subdomain)
need API access too, add each preview URL to `CORS_ORIGINS` as it comes up,
or extend `app/main.py` with an `allow_origin_regex` for
`https://.*\.vercel\.app` — not done here, to keep this change minimal.

## `render.yaml`

A Render Blueprint is included at the repo root, defining the backend
service with the exact build/start commands, root directory, health check
path, and the two environment variables above (`CORS_ORIGINS` is left for
manual entry via `sync: false`, since its value depends on the frontend's
URL, which doesn't exist yet). It does not define the frontend — Vercel
does not use `render.yaml`.

Using it is optional: the same service can be created by hand in the Render
dashboard using the build/start commands documented above.

## Pre-deployment checklist recap

| Item | Status |
|---|---|
| Backend `requirements.txt` pinned and Linux/Render-compatible | Done — headless OpenCV; the AI supplement runs on ONNX Runtime, so a single `pip install -r requirements.txt` is the whole build |
| Python version pinned | Done — `backend/.python-version` (`3.13`) + `PYTHON_VERSION` in `render.yaml` |
| FastAPI start command matches `uvicorn app.main:app --host 0.0.0.0 --port $PORT` | Confirmed — tested locally with an arbitrary `$PORT` |
| CORS allows the deployed frontend without a wildcard | Done — `CORS_ORIGINS` env var, localhost always allowed, tested both cases |
| Environment variables identified | `CORS_ORIGINS` (backend), `NEXT_PUBLIC_API_URL` (frontend) — both optional-with-safe-defaults for local dev |
| YOLO weights | Committed as `yolo11n.onnx`; no runtime download, so the ephemeral filesystem is no longer a factor |
| File upload size handling | Unchanged, already enforced in-app at 15 MB |
| Temporary files / filesystem assumptions | No disk writes during request handling |
| OpenCV deployment compatibility | Fixed — switched to `opencv-python-headless`, verified no behavior change |
| AI runtime fits the deployment tier | Fixed — torch/ultralytics replaced with ONNX Runtime to fit 0.1 CPU / 512 MB; `AI_ENABLED` kill switch and `/health` memory reporting added |
| Frontend API URL configuration | Already correct — env-var driven, no code change needed |
| No hardcoded localhost/Render URLs | Confirmed — only the documented dev-fallback default in `lib/api.ts` |
| `.gitignore` completeness | Covers venvs, build artifacts, `.env*`, Vercel/Next.js artifacts, `backend/tests/output/` and the end-to-end QA artefacts (`frontend/e2e/fixtures/`, `frontend/e2e/screenshots/`, `.playwright-cli/`) |
| Frontend static assets | `frontend/public/imagery/` holds four public-domain JPEGs (~1.4 MB total) served by Vercel as static files |
