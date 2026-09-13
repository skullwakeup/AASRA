# AASRA — AI-Assisted Relief Area Identification

A **computer-vision decision-support prototype** for aerial flood imagery.

Given a single aerial image, AASRA identifies:

1. Floodwater
2. Non-water land
3. Potential candidate supply-drop regions
4. Potentially isolated land regions
5. Top-ranked potential relief zones

## Scope and limitations (read this first)

AASRA is a **prototype**. It performs image heuristics on a single photograph.
It does **not**:

- guarantee safety of any kind
- assess or certify helicopter landing suitability
- perform autonomous rescue or any aircraft control
- detect people, or claim anyone is trapped

All outputs are **candidates** that require verification by trained personnel.
Terminology used throughout the code and API: *Potential Supply-Drop Zone*,
*Candidate Zone*, *Potentially Isolated Land Region*, *High Potential*.
All distances and areas are **pixel** measurements of the processed image —
never metres.

## Status

- Backend: implemented (Phases 1–12), OpenCV only.
- AI / deep-learning module: **not implemented yet** (`analysis_mode.ai = false`).
- Frontend: implemented (Next.js + TypeScript + Tailwind). Consumes the live
  backend only — no mock data anywhere.

## Structure

```
AASRA/
  backend/
    app/
      main.py            FastAPI app: GET /health, POST /api/analyze
      config.py          every tunable threshold, documented
      pipeline.py        orchestrates the phases, builds the JSON payload
      services/
        preprocessing.py       decode, resize, analysis copy (blur + CLAHE)
        water_detection.py     multi-stage floodwater heuristic
        drop_zone_detection.py water buffer + candidate mask
        region_analysis.py     connected components, distance transform, openness
        isolated_regions.py    potentially isolated land regions + isolation score
        scoring.py             transparent 0-100 zone scoring and ranking
        visualization.py       five base64 PNG visualisations
    tests/smoke_test.py  offline end-to-end pipeline check
    requirements.txt
    README.md
  frontend/            Next.js + TypeScript + Tailwind interface
    app/               layout, page shell, stage machine, design tokens
    components/        header, upload, viewer, zone/isolation cards, states
    lib/api.ts         the only module that calls the backend
    types/api.ts       TypeScript mirror of the real backend payloads
    README.md
  docs/                  pipeline and API notes
```

## Quick start

```bash
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate
# Linux/mac: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Then:

- `GET  http://127.0.0.1:8000/health`
- `POST http://127.0.0.1:8000/api/analyze` (multipart form field `image`)
- Interactive docs: `http://127.0.0.1:8000/docs`

Then start the frontend in a second terminal:

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

It reads the backend URL from `NEXT_PUBLIC_API_URL` (default
`http://localhost:8000`); copy `frontend/.env.example` to `frontend/.env.local`
to change it. No API keys are required.

See `backend/README.md` for details, `frontend/README.md` for the interface and
`docs/pipeline.md` for the algorithms.

## Processing pipeline

```
IMAGE
 -> WATER DETECTION
 -> WATER MASK
 -> WATER BUFFER (pixel dilation)
 -> CANDIDATE MASK (non-water AND NOT buffer)
 -> CONNECTED COMPONENTS
 -> DISTANCE TRANSFORM
 -> CANDIDATE DROP POINTS
 -> ZONE SCORING
 -> TOP 3 ZONES
```
