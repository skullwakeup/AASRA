# Deployment guide — Render (backend) + Vercel (frontend)

This is a production-readiness reference for deploying AASRA as:

- **Backend** → Render (Python web service)
- **Frontend** → Vercel (Next.js)

Nothing in this document changes the OpenCV pipeline or YOLO detection
behavior. It only covers packaging, configuration and hosting.

## Backend — Render

### Root Directory

Set the service's **Root Directory** to `backend` in the Render dashboard
(or `rootDir: backend` if using the included `render.yaml` Blueprint — see
below). All commands and paths below assume this.

### Build command

```
pip install -r requirements.txt && pip install --no-deps ultralytics==8.3.253
```

Two steps are required, not one. `ultralytics` declares a hard dependency on
`opencv-python` (not `opencv-python-headless`), and pip has no way to apply
`--no-deps` to a single line of a requirements file while resolving
everything else normally. Installing `ultralytics` separately with
`--no-deps` after everything else is in place avoids pip additionally
installing a second, conflicting `opencv-python` package alongside
`opencv-python-headless` (verified: without this, `pip install -r
requirements.txt` with a naive `ultralytics` line installs **both**
`opencv-python` and `opencv-python-headless` side by side, which is a
broken, unsupported combination since both packages provide the same `cv2`
module). This is documented in a comment at the bottom of
`backend/requirements.txt`.

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

No API keys or secrets are required anywhere in this project.

### YOLO model weight download

`app/services/ai_detection.py` downloads the ~5.6 MB YOLO11n weight file to
`app/services/weights/yolo11n.pt` the first time it's needed (lazily, not at
process startup), and reuses it for the life of the running instance. On
Render:

- The service needs outbound internet access for that first download —
  Render web services have this by default.
- The instance's local filesystem is writable at runtime, so the download
  itself will succeed without any extra configuration.
- The filesystem is **ephemeral**: a redeploy or restart wipes it, so the
  first request after every deploy/restart pays the download cost again
  (a few seconds). This does not require a persistent disk to work
  correctly — the code already handles a missing/re-downloaded weight file
  transparently — but it does mean the very first request after a deploy is
  slower than the rest.
- **Optional improvement, not required for correctness:** add a
  pre-warming step to the build command so the weight is already present
  before the instance starts serving traffic, catching any download failure
  at build time instead of on a user's first request:

  ```
  pip install -r requirements.txt && pip install --no-deps ultralytics==8.3.253 && python -c "from ultralytics import YOLO; YOLO('app/services/weights/yolo11n.pt')"
  ```

  If the AI dependencies or the download fail for any reason (with or
  without this pre-warm step), the app does not crash: `analysis_mode.ai`
  reports `false` and every OpenCV result is still returned normally — this
  was verified in an earlier pass of this project by simulating both a
  missing `ultralytics` import and a model-load exception.

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

### PyTorch / Ultralytics wheel size

`requirements.txt` uses `--extra-index-url https://download.pytorch.org/whl/cpu`
with explicit `torch==2.6.0+cpu` / `torchvision==0.21.0+cpu` pins. Without
this, plain `torch==2.6.0` resolves to the default PyPI Linux wheel, which
bundles full CUDA support and is **~730 MB** (verified against PyPI's own
published file size) versus **~180 MB** for the genuine CPU-only wheel this
project actually needs, since no code here uses a GPU. This directly affects
Render build time and deploy size for no benefit.

### File upload size

`config.MAX_FILE_SIZE_MB = 15` is enforced in `app/main.py` after the
request body is fully read. This is unchanged and does not need to change
for deployment — Render's own platform-level request limits (if any) were
not found documented publicly at the time of writing; if very large uploads
ever fail before reaching this app-level check, that would be a
Render-platform limit to check directly with Render, not an application bug.

### Filesystem assumptions

Aside from the one-time YOLO weight cache (above), the request-handling code
writes nothing to disk: every image is processed in memory (NumPy arrays)
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
  `NEXT_PUBLIC_API_URL` to the deployed Render backend's public URL (e.g.
  `https://aasra-backend.onrender.com`) in the Vercel project's dashboard
  under Settings → Environment Variables. Do not commit this value anywhere.
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
| Backend `requirements.txt` pinned and Linux/Render-compatible | Done — headless OpenCV, CPU-only PyTorch wheels, ultralytics installed via a documented two-step command |
| Python version pinned | Done — `backend/.python-version` (`3.13`) + `PYTHON_VERSION` in `render.yaml` |
| FastAPI start command matches `uvicorn app.main:app --host 0.0.0.0 --port $PORT` | Confirmed — tested locally with an arbitrary `$PORT` |
| CORS allows the deployed frontend without a wildcard | Done — `CORS_ORIGINS` env var, localhost always allowed, tested both cases |
| Environment variables identified | `CORS_ORIGINS` (backend), `NEXT_PUBLIC_API_URL` (frontend) — both optional-with-safe-defaults for local dev |
| YOLO weight download behavior understood | Lazy, cached, ephemeral-filesystem-safe; optional build-time pre-warm documented |
| File upload size handling | Unchanged, already enforced in-app at 15 MB |
| Temporary files / filesystem assumptions | No disk writes during request handling other than the one-time model cache |
| OpenCV deployment compatibility | Fixed — switched to `opencv-python-headless`, verified no behavior change |
| PyTorch/Ultralytics dependency compatibility | Fixed — CPU-only wheels, verified `--no-deps` install avoids the opencv conflict, verified full pipeline + YOLO still run correctly |
| Frontend API URL configuration | Already correct — env-var driven, no code change needed |
| No hardcoded localhost/Render URLs | Confirmed — only the documented dev-fallback default in `lib/api.ts` |
| `.gitignore` completeness | Reviewed — already covers venvs, model weights, `runs/`, build artifacts, `.env*.local`, Vercel/Next.js artifacts; nothing missing found |
