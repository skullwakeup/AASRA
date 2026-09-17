# AASRA visual system

A quiet, editorial interface for a computer-vision analysis tool. The aerial
photograph carries the page; the chrome stays flat and restrained so that the
analysis overlays are the only strong colour on screen.

Tokens live in `frontend/app/globals.css` (CSS variables exposed to Tailwind
as colours); shared action classes are in `frontend/lib/ui.ts`.

## Principles

1. **Imagery first.** Hero and band photographs are full-bleed. Analysis
   images are shown as large as the viewport allows, letterboxed on near-black.
2. **Chapters, not boxes.** The page alternates a near-black canvas (imagery,
   analysis) and an off-white canvas (explanation, results). The change of
   canvas is the divider; there are no decorative separators.
3. **Colour means something.** Blue is water. Green is a probable storage
   zone or a high-potential result. Amber is moderate. Red is an error, a
   rejected sample or a not-viable result. Nothing else is coloured.
4. **Flat.** Hairline borders, 8 px card radius, no shadows, no glass, no
   glow, no gradients on chrome. The only gradients are legibility scrims
   over photographs.
5. **Light display type.** Large headings use weight 300 with slight negative
   tracking; body text stays regular and short.
6. **Plain language.** Probable, candidate, image pixels. Never safe,
   guaranteed or rescue.

## Colour

| Token | Value | Use |
|---|---|---|
| `canvas` | `#050607` | dark chapters, header, footer |
| `surface` | `#0e1012` | cards and panels on the dark canvas |
| `raised` | `#16181b` | nested cards on the dark canvas |
| `line` / `line-strong` | white 10 % / 20 % | hairlines on dark |
| `ink` / `muted` / `faint` | `#f2f1ed` at 100 / 68 / 46 % | text on dark |
| `paper` | `#f3f2ee` | light chapters |
| `paper-card` | `#ffffff` | cards on the light canvas |
| `paper-line` | `#deddd6` | hairlines on light |
| `paper-ink` / `-muted` / `-faint` | `#0b0c0d` at 100 / 64 / 46 % | text on light |
| `water` | `#3a8ee6` | water, primary action, focus ring, highlight ring |
| `signal` / `signal-ink` | `#34d378` / `#0f7a3f` | storage zones, high potential (dark / light canvas) |
| `caution` / `caution-ink` | `#e0b24f` / `#8a6210` | moderate potential |
| `warning` / `warning-ink` | `#ef5a5f` / `#b3262b` | errors, not recommended, service offline |

Low potential uses neutral grey.

### Overlay colours (backend, `visualization.py`)

| Element | RGB | Drawing |
|---|---|---|
| Water | `#145ac8` | translucent fill (40 % in Final Result) |
| Water buffer | `#466e96` | translucent band (Drop Zones view) |
| Candidate region | `#aaaaaa` | 1 px outline on a dark halo |
| Probable storage zone | `#34d378` | 22 % fill, 2 px ring on a 4 px dark halo |
| Storage centre | `#34d378` core | white ring, dark disc behind |
| Probable drop zone | `#f0f0f0` | 1 px ring on a dark halo, 2 px dot at the drop point |
| Limiting pixel, rejected sample | `#e15050` | dot / small cross |
| Radius, sampling rings | white / grey | dashed line / dotted circles |
| Labels | white on `#181818` | boxed, placed to avoid circles and each other |

Every stroke has a dark halo so it reads on bright land and dark water alike.
The frontend legends use these exact values.

## Typography

Geist (sans) and Geist Mono, via `next/font`.

| Role | Size | Weight |
|---|---|---|
| Hero wordmark | 64 / 96 / 128 px | 300 |
| Chapter heading | 36–54 px | 300, −0.02 em |
| Section heading | 30–38 px | 300 |
| Metric and stat values | 24–40 px | 300, tabular figures |
| Body | 14–18 px | 400 |
| Eyebrow | 11 px mono, uppercase, +0.14 em | 400 |
| Button | 13–14 px | 600 |

Mono is used only for small uppercase labels, never for large numbers.

## Spacing and layout

- Chapter padding 48 / 64 / 96 px (mobile / tablet / desktop), class
  `.chapter`.
- Content width 1280 px, gutters 16 / 24 / 32 px.
- Card padding 16–24 px; grids use 12–16 px gaps, or 1 px gaps on a
  hairline background for joined tiles.

## Components

- **Pill button** (`pillPrimary`): water blue, white text, 44 px high, fully
  rounded. One per view.
- **Outline pill** (`pillSecondary`): hairline border, transparent.
- **Chip** (`chip`): 36 px outline pill for samples.
- **Stage tabs**: 36 px pills; the active tab is solid off-white with dark
  text. The row scrolls horizontally on narrow screens.
- **Metric tile**: label, large light number, optional 2 px proportion bar,
  one-line caption.
- **Storage zone card** (light): eyebrow "Probable storage zone 01", potential
  badge, four stats (centre, valid radius, drop zones, water clearance), the
  limiting factor, and an expandable region score. The selected card has a
  dark border.
- **Drop zone card** (light): drop point, drop-point score and band, three
  distances, three score bars.
- **Not-viable card**: dashed border, plain reason.
- **Highlight ring**: 3–4 px water-blue SVG circle over the image, dashed for
  storage zones, solid for drop zones.
- **Empty state**: dashed border, one heading, one sentence of reason.

## Motion

Fades of 0.35–0.5 s on entry, one scan line during analysis, an
indeterminate bar. All disabled under `prefers-reduced-motion`.

## Responsive behaviour

| Width | Changes |
|---|---|
| < 640 px | single column; metrics in two columns; tabs scroll; hero 64 px |
| 640–1023 px | two-column step grid and card grids |
| ≥ 1024 px | method and workspace split 5 : 7 and 4 : 8; five metrics in a row; storage/drop chapter shows a sticky Final Result beside the cards |

The end-to-end suite checks for horizontal overflow at 390 px and 820 px.

## Logo

The official AASRA logo (emblem, wordmark, "From imagery to impact") is
the source for every brand asset. Its wordmark is dark navy on transparent,
so on the dark interface only the emblem is used:

| Asset | Content |
|---|---|
| `public/brand/aasra-mark.png` | emblem, 128 px square, transparent — header mark (36 px) |
| `app/icon.png`, `app/favicon.ico` | emblem, 192 px and 16/32/48 px |
| `app/apple-icon.png` | emblem on `#050607`, 180 px (iOS ignores transparency) |
| `app/opengraph-image.png` | full logo on white, 1200 × 630 |

The emblem is cropped square from the original, never stretched.

## Imagery

Photographs are public-domain U.S. government works (FEMA, U.S. Army),
credited on the image and in `frontend/public/imagery/CREDITS.md`.
