# AASRA frontend

Next.js 16 (App Router) + TypeScript + Tailwind CSS 4. Icons: `lucide-react`.

Every number, classification and analysis image comes from the live backend
response — no mock data and no hardcoded metrics. The only bundled images are
public-domain photographs in `public/imagery/` (hero, a band image and two
sample inputs; see `public/imagery/CREDITS.md`).

## Run

The backend must be running on port 8000 (see `../backend/README.md`).

```bash
npm install
cp .env.example .env.local     # NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev                    # http://localhost:3000
```

Production: `npm run build && npm start`.

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | backend base URL |

`next.config.ts` sets `agentRules: false` so `next dev` does not write
`AGENTS.md` / `CLAUDE.md` into the repository.

## Page

`app/page.tsx` is a single page with a stage machine:
`idle → ready → analyzing → results | error`.

- **Landing** (`components/Landing.tsx`): full-bleed hero photograph, the
  nine-step method with a storage/drop-zone diagram, the analysis workspace,
  and a scope statement over a second photograph.
- **Workspace**: drag-and-drop or file picker, plus two sample images
  (`UploadZone.tsx`), preview (`ImagePreview.tsx`), progress
  (`AnalysisProgress.tsx`), error (`States.tsx`). Uploads are disabled while
  `GET /health` fails (polled every 20 s).
- **Results** (`ResultsDashboard.tsx`), in alternating dark / light chapters:
  1. header and five metrics (water, non-water, candidate regions, probable
     storage zones, probable drop zones);
  2. stage viewer (`ImageWorkspace.tsx`) with tabs *Original, Water Analysis,
     Candidate Areas, Drop Zones, Land Isolation, Final Result, AI Context*,
     legends, a "Why these points" explanation under Drop Zones, and the
     run's parameters (`ScanParameters.tsx`);
  3. probable storage zones (primary) and the selected zone's probable drop
     zones (secondary) (`StorageZones.tsx`), next to a sticky copy of the
     Final Result;
  4. AI object context (`AIStatus.tsx`);
  5. limitations (`Disclaimer.tsx`).

Refreshing the page returns to the landing page; results are not stored.

### Highlight overlay

Hovering or focusing a storage or drop-zone card rings it on the Final Result
and Drop Zones images. The ring is an SVG whose `viewBox` is the processed
image size and whose `preserveAspectRatio` is `xMidYMid meet` — the same
letterboxing as the image's `object-contain` — and pixel `(x, y)` is drawn at
`x + 0.5, y + 0.5`. The end-to-end suite checks that the ring's centre lands
within 1 CSS pixel of the reported centre and that the screen pixel there is
the backend's green centre marker.

## Backend contract

Both calls live in `lib/api.ts`. `types/api.ts` mirrors the payload built in
`backend/app/pipeline.py`, including `storage_zones`, `storage_analysis` and
`parameters.storage`. `images.*` are raw base64 PNGs; `toDataUrl()` in
`lib/format.ts` adds the `data:` prefix, and tabs appear only for images that
arrived non-empty. Backend error messages are shown as-is; network failures
and malformed responses get a clean generic message.

## Design

Tokens are in `app/globals.css`; the system is described in
[`docs/design.md`](../docs/design.md). Shared action classes (pills) are in
`lib/ui.ts`, classification colours in `lib/classification.ts`.

Brand assets come from the official AASRA logo: `public/brand/aasra-mark.png`
(header emblem) and the `app/` file conventions `favicon.ico`, `icon.png`,
`apple-icon.png` and `opengraph-image.png`. See `docs/design.md` → Logo.

## Wording

*Probable Storage Zone*, *Probable Drop Zone*, *Candidate Drop Point*,
*High / Moderate / Low Potential*. Never "safe", "guaranteed", "rescue zone"
or "landing zone". Two scores are always labelled apart: the **region score**
(on storage zones) and the **drop-point score** (on drop zones). All
distances are image pixels.

## Checks

```bash
npx tsc --noEmit
npm run lint
npm run build
```

End-to-end (`e2e/`, driven by `playwright-cli`; needs both servers running):

```bash
cd e2e
../../backend/.venv/Scripts/python make_fixtures.py   # Linux/macOS: .venv/bin/python
playwright-cli open http://localhost:3000
playwright-cli run-code --filename=aasra.e2e.js
```

It covers the landing page, invalid and corrupt uploads, the sample analysis,
every tab, the highlight alignment, storage-zone selection, refresh, a
6000 × 4000 upload, an all-water image, small storage zones with and without
drop zones, 390 px and 820 px layouts, an unreachable backend, an
older-backend response (`INCOMPATIBLE_BACKEND`), a failed
analysis request, and console errors. Screenshots are written to
`e2e/screenshots/` (gitignored).
