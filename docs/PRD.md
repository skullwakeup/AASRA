# AASRA — Product Requirements Document

## 1. Overview

AASRA (AI-Assisted Relief Area Identification) is an image-based
decision-support prototype. A user uploads a single aerial or drone
photograph of a flooded area; the system estimates water coverage, ranks
candidate relief zones on dry land, and optionally reports visible people and
vehicles as supplementary context. It is a college/portfolio project
demonstrating a computer-vision pipeline, not a production emergency-response
tool.

## 2. Problem statement

After a flood, the fastest available view of an area is often a single
aerial or drone photo, taken before ground teams can reach the scene. Reading
that image manually — judging where the water is, how much dry land remains,
and which patches of land look usable — does not scale and is inconsistent
between observers. There is no lightweight, dependency-free way to turn one
photo into a structured, ranked shortlist of candidate areas for a human to
check first.

## 3. Target users

- **Primary:** the project author/evaluator, as an academic
  computer-vision/full-stack project.
- **Illustrative secondary audience:** a hypothetical volunteer or
  early-response coordinator triaging a batch of aerial images, who wants a
  quick, explainable first pass before manual review. This project does not
  claim to be validated or deployed for that use — it demonstrates the
  concept.

## 4. Goals

- Estimate floodwater coverage in a single image using classical computer
  vision (no training data required).
- Identify and rank candidate relief zones on dry land, each with a
  transparent, inspectable score.
- Produce a clear drop point for each ranked zone.
- Provide human-readable visualizations of every stage, not just a final
  number.
- Add a small, genuinely supplementary object-detection pass (YOLO11n) that
  reports visible people/vehicles without influencing the core analysis.
- Fail gracefully: the core analysis must never break because the optional
  AI component is unavailable.
- Present all of this through a clean, responsive web interface with no
  fabricated or mock data.

## 5. Non-goals

- Detecting flood victims, trapped or stranded people, or any claim about
  human presence or occupancy.
- Assessing helicopter/aircraft landing suitability or any aviation safety
  property.
- Real-world distance, elevation, or georeferenced output — all
  measurements are in processed-image pixels.
- Making an operational, safety-critical, or emergency-dispatch decision.
- Achieving or claiming a specific accuracy, precision or recall figure —
  the project has not been evaluated against a labelled dataset.
- Multi-image, video, or temporal (before/after) analysis.
- User accounts, persistence, or any stored history of past analyses.

## 6. Core features

1. Image upload (JPG/JPEG/PNG) with client- and server-side validation.
2. Water coverage estimation (percentage of the processed image).
3. Candidate land-region detection outside a water safety buffer.
4. Per-region clearance (from water, and internally) via distance transform.
5. Transparent 0–100 relief-zone scoring and ranking, with the weighted
   formula exposed in the API response.
6. Candidate drop-point generation for each ranked zone.
7. Potentially-isolated-land-region detection (computed and returned by the
   API; not currently surfaced in the dashboard UI).
8. A multi-tab visualization viewer (Original, Water Analysis, Candidate
   Areas, Final Result, and AI Context when available).
9. Supplementary YOLO11n object detection for seven classes (person, car,
   truck, bus, boat, motorcycle, bicycle), with per-class counts and an
   annotated image.
10. Graceful AI failure handling, reported honestly via `analysis_mode.ai`.
11. A responsive results dashboard across desktop, tablet and mobile widths.

## 7. Functional requirements

| ID | Requirement |
|---|---|
| FR-1 | The system shall accept a single JPG/JPEG/PNG upload up to a configured size limit and reject anything else with a clear error. |
| FR-2 | The system shall classify pixels as water or non-water using a deterministic, documented computer-vision heuristic. |
| FR-3 | The system shall exclude a configurable buffer distance around detected water from candidate land regions. |
| FR-4 | The system shall reject candidate regions below a configurable minimum area or minimum internal clearance. |
| FR-5 | The system shall compute a 0–100 score for each candidate region from area, water clearance and openness, using documented, fixed weights. |
| FR-6 | The system shall return the top N ranked zones (configurable, default 3), each with its score, classification band, measurements and drop point. |
| FR-7 | The system shall attempt supplementary object detection on every request, and shall report success/failure honestly via `analysis_mode.ai` without ever raising an error that stops the primary analysis. |
| FR-8 | Object-detection output shall never be written into, or read by, any water-detection, region-analysis or scoring computation. |
| FR-9 | The system shall return annotated PNG visualizations for each major stage of the analysis. |
| FR-10 | The frontend shall render only values present in the backend response; it shall not fabricate, default, or hardcode any metric. |
| FR-11 | Error responses shall never include a stack trace, file path, or internal exception detail. |

## 8. Non-functional requirements

- **Reliability:** the optional AI component failing (missing dependency,
  failed download, inference error) must never prevent the core OpenCV
  pipeline from completing and returning a full result.
- **Performance:** a single-image analysis (OpenCV pipeline + YOLO11n
  inference) should complete in a few seconds on a typical CPU-only
  development machine, given the bounded processing resolution (1024px
  longest edge by default).
- **Transparency:** every threshold, weight and formula used by the scoring
  and water-detection heuristics is documented in `app/config.py` and
  `docs/pipeline.md` — none are opaque or learned.
- **No external dependencies at request time:** no API keys, no third-party
  network calls, no cloud services. The only network requirement is the
  one-time YOLO11n weight download.
- **Statelessness:** the backend holds no database and no session/user
  state; each request is analyzed independently.
- **Honesty in UI/API:** status indicators (service health, AI status) must
  reflect the real, current state — never a hardcoded "active"/"online"
  value.

## 9. System architecture overview

```
User → Frontend (Next.js) → Backend API (FastAPI)
                                   │
                    ┌──────────────┴───────────────┐
                    │                               │
        OpenCV pipeline (primary)        YOLO11n detection (supplementary)
        preprocessing → water detection  runs on the same processed image,
        → region analysis → clearance    independently, in parallel
        → zone scoring/ranking →                    │
        visualization generation                    │
                    │                               │
                    └──────────────┬────────────────┘
                                   │
                         Combined JSON response
                                   │
                          Frontend dashboard
```

The two branches share only their input image; the YOLO branch's output is
attached to the response but never read back into the OpenCV branch. See the
Mermaid diagram in the root `README.md` for the detailed per-stage view.

## 10. Technology stack

- **Backend:** Python 3.13, FastAPI, OpenCV (`opencv-python`), NumPy,
  Pillow. Supplementary AI: PyTorch (CPU), Torchvision (CPU), Ultralytics
  (YOLO11n).
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind
  CSS 4, `lucide-react` for icons.
- **No database, no queue, no cache layer, no authentication.**

## 11. Current limitations

- Water detection is a hand-tuned heuristic over colour, texture and edge
  cues — not a trained segmentation model — and has known confusions (bare
  earth vs. muddy water, dark roofs vs. shadowed water).
- All measurements are in the processed image's pixel grid; there is no
  georeferencing or real-world unit conversion.
- Zone scores are a ranking heuristic, not a validated safety or
  landing-suitability metric.
- YOLO11n is trained on ordinary ground-level photography; its accuracy on
  aerial/top-down imagery is lower and unverified against any benchmark.
- No labelled-dataset evaluation exists for either the water-detection
  heuristic or the object detector's performance on flood imagery
  specifically.
- Single-image analysis only; no temporal or multi-image comparison.

## 12. Future improvements

- Optional obstacle detection (buildings, trees, power lines) within
  candidate regions.
- A trained water/flood segmentation model as an additional, still
  supplementary, signal — without replacing the transparent OpenCV
  heuristic as the primary method.
- Georeferencing support (e.g. from image EXIF/GPS metadata) to convert
  pixel measurements to real-world distances where available.
- Batch or multi-image analysis for comparing the same area over time.
- A labelled evaluation set to quantify water-detection and zone-ranking
  quality, rather than relying on heuristic thresholds alone.
