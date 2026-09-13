# AASRA frontend

Next.js + TypeScript + Tailwind CSS interface for the AASRA analysis backend.
Icons: `lucide-react` (the only icon library used).

Every number, classification and image shown in the UI is read from the live
backend response. There is no mock data, no fallback sample and no hardcoded
metric anywhere in this app.

## Prerequisites

The backend must be running (see `../backend/README.md`):

```bash
cd ../backend
.venv\Scripts\activate        # Windows  (source .venv/bin/activate elsewhere)
uvicorn app.main:app --reload --port 8000
```

## Run

```bash
npm install
cp .env.example .env.local     # or copy on Windows
npm run dev                    # http://localhost:3000
```

Production:

```bash
npm run build
npm start
```

## Configuration

| Variable              | Default                 | Purpose                       |
| --------------------- | ----------------------- | ----------------------------- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Base URL of the AASRA backend |

No API keys. No secrets.

## Backend contract

Both calls live in [`lib/api.ts`](lib/api.ts) — nothing else in the app fetches.

- `GET /health` — polled on load and every 20s. Drives the header status pill
  (`SYSTEM READY` / `SYSTEM OFFLINE`) and supplies the real upload size limit.
  The pill never claims the service is up when the probe fails.
- `POST /api/analyze` — `multipart/form-data`, form field **`image`** (fixed by
  the backend signature `analyze(image: UploadFile = File(...))`).

Response types in [`types/api.ts`](types/api.ts) mirror the real payload built
in `backend/app/pipeline.py`.

### Visualisation images

`images.*` are **raw base64 PNG strings** with no `data:` prefix (verified: they
begin with the PNG signature `iVBORw0KGgo`). `toDataUrl()` in
[`lib/format.ts`](lib/format.ts) prefixes `data:image/png;base64,` and passes
through anything that already is a data URL. Tabs are built only from keys that
arrive non-empty, so a missing view is omitted rather than rendered broken.

### Errors

The backend returns `{ success: false, error: { code, message } }` and never
leaks tracebacks. `lib/api.ts` surfaces that message as-is and substitutes a
clean message for network failures and malformed responses. No Python
exception, stack trace or FastAPI internal ever reaches the screen.

## Structure

```
frontend/
  app/
    layout.tsx            fonts, metadata, page shell
    page.tsx              stage machine: idle -> ready -> analyzing -> results | error
    globals.css           design tokens, grid background, motion
  components/
    Header.tsx            wordmark + live /health status pill
    UploadZone.tsx        drag-and-drop + browse, client-side pre-validation
    ImagePreview.tsx      staged file, "READY FOR ANALYSIS", analyze / remove
    AnalysisProgress.tsx  loading experience for the single analyze request
    ResultsDashboard.tsx  composes the results view
    MetricCard.tsx        headline metric tile
    ImageWorkspace.tsx    tabbed viewer over the five backend visualisations
    ZoneCard.tsx          ranked candidate zone + expandable score breakdown
    IsolationCard.tsx     potentially isolated land region + its sub-features
    ScoreBreakdown.tsx    score bar / factor row primitives
    AIStatus.tsx          honest analysis_mode reporting
    ScanParameters.tsx    the parameters the backend actually used
    PipelineStrip.tsx     compact description of the pipeline (upload screen)
    Disclaimer.tsx        prototype disclaimer
    States.tsx            error state + empty states
    Panel.tsx             surface / heading primitives
  lib/
    api.ts                the only place that talks to the backend
    format.ts             number, byte and base64 -> data URL helpers
    classification.ts     backend classification string -> colour tone
  types/
    api.ts                TypeScript mirror of the real backend payloads
```

## Wording rules

The UI follows the project's terminology: *Potential Zone*, *Candidate Zone*,
*Potentially Isolated Land Region*, *HIGH / MODERATE / LOW POTENTIAL*.
Never "safe", never "landing zone", never any claim about people. Classification
strings are rendered verbatim from the backend. All distances and areas are
pixels of the processed image — never metres.

`analysis_mode.ai` is reported honestly: while the backend ships `ai: false`
the AI panel reads **NOT ENABLED** and states that results come from the OpenCV
pipeline. If the backend later sets the flag, the panel updates with no
frontend change.
