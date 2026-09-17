/**
 * Landing chapters: hero, method, concept diagram, imagery band, footer.
 * Static explanatory copy only — no measurements are shown here.
 * Imagery: public-domain U.S. government photographs (public/imagery/CREDITS.md).
 */

import { pillPrimary, pillSecondary } from "@/lib/ui";

/* eslint-disable @next/next/no-img-element */

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden" aria-labelledby="hero-title">
      <img
        src="/imagery/hero-tennessee-2010.jpg"
        alt="Aerial photograph of a flooded town: water surrounds houses, roads and parked vehicles."
        className="absolute inset-0 -z-20 size-full object-cover"
        fetchPriority="high"
      />
      {/* Legibility scrim over the photograph only. */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-canvas via-canvas/60 to-canvas/5" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-canvas/70 via-canvas/10 to-transparent" />

      <div className="mx-auto flex min-h-[calc(88svh-56px)] max-w-[1280px] flex-col justify-end px-4 pb-16 pt-28 sm:px-6 sm:pb-20 lg:px-8">
        <p className="eyebrow anim-fade-up text-ink/80">
          Computer-vision decision support for flood imagery
        </p>
        <h1
          id="hero-title"
          className="display anim-fade-up mt-5 text-[64px] sm:text-[96px] lg:text-[128px]"
        >
          AASRA
        </h1>
        <p className="anim-fade-up mt-2 text-xl font-light text-ink sm:text-[28px]">
          AI-Assisted Relief Area Identification
        </p>
        <p className="anim-fade-up mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
          Image-derived spatial analysis identifies candidate land regions and
          computes probable storage and drop zones.
        </p>
        <div className="anim-fade-up mt-9 flex flex-wrap gap-3">
          <a href="#analyze" className={pillPrimary}>
            Analyze an image
          </a>
          <a href="#method" className={pillSecondary}>
            How it works
          </a>
        </div>
      </div>

      <p className="absolute bottom-3 right-4 max-w-[60%] text-right text-[10px] leading-snug text-ink/45 sm:right-6 lg:right-8">
        Flooding in Tennessee, 2010 · FEMA / David Fine · Public domain
      </p>
    </section>
  );
}

const STEPS: { title: string; detail: string }[] = [
  { title: "Upload aerial flood imagery", detail: "JPG or PNG. Resized so the longest edge is at most 1024 px." },
  { title: "Detect water", detail: "Colour, texture and edge cues combine into a water mask." },
  { title: "Separate valid land", detail: "Water is widened by a pixel buffer; the land that remains is candidate land." },
  { title: "Find high-clearance regions", detail: "Connected candidate regions are measured and ranked 0–100." },
  { title: "Select the storage centre", detail: "The region pixel farthest from any excluded pixel." },
  { title: "Calculate the storage radius", detail: "The largest circle around the centre that stays on the region's candidate land." },
  { title: "Generate probable drop zones", detail: "Points sampled on rings inside the circle, filtered for clearance and spacing." },
  { title: "Rank and explain", detail: "Each drop zone carries a transparent score built from measured distances." },
  { title: "Add object context", detail: "A separate detector labels visible vehicles and people. It changes no zone." },
];

export function Method() {
  return (
    <section id="method" className="chapter scroll-mt-14 bg-paper text-paper-ink">
      <div className="mx-auto grid max-w-[1280px] gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16 lg:px-8">
        <div>
          <p className="eyebrow text-paper-faint">Method</p>
          <h2 className="display mt-4 text-[36px] sm:text-[44px]">
            From one image to probable drop zones
          </h2>
          <p className="mt-5 max-w-md text-base leading-relaxed text-paper-muted">
            Every result is geometry measured on the image itself. The storage
            zone is the primary result; drop zones sit inside it.
          </p>
          <ConceptDiagram />
        </div>

        <ol className="grid grid-cols-1 gap-px self-start overflow-hidden rounded-lg border border-paper-line bg-paper-line sm:grid-cols-2 xl:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="bg-paper-card p-5">
              <span className="font-mono text-xs text-paper-faint tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-3 text-[15px] font-semibold leading-snug">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-paper-muted">{step.detail}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const CX = 176;
const CY = 118;
const R = 90;

/** Schematic of the result hierarchy. Illustrative, not data. */
export function ConceptDiagram() {
  const ink = "#0b0c0d";
  // Circle stops a few units short of the buffer edge (x ~ 79 at CY).
  const drops = [30, 90, 150, 210, 270, 330].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return { x: CX + 50 * Math.cos(a), y: CY + 50 * Math.sin(a) };
  });
  return (
    <figure className="mt-10">
      <svg
        viewBox="0 0 300 236"
        className="w-full max-w-[420px]"
        role="img"
        aria-label="Diagram: a storage zone circle with its centre and six small drop zones inside it; water lies outside the circle."
      >
        <path d="M0 0 H70 C58 60 60 170 40 236 H0 Z" fill="#3a8ee6" fillOpacity="0.85" />
        <path d="M70 0 C58 60 60 170 40 236 H62 C80 170 78 60 92 0 Z" fill="#3a8ee6" fillOpacity="0.25" />
        <circle cx={CX} cy={CY} r={R} fill="#34d378" fillOpacity="0.14" stroke="#1faa5c" strokeWidth="2" />
        <line x1={CX} y1={CY} x2={CX - R} y2={CY} stroke={ink} strokeWidth="1" strokeDasharray="4 4" />
        <text x={CX - R + 14} y={CY - 6} fontSize="11" fill={ink} fontFamily="monospace">r</text>
        <circle cx="79" cy={CY} r="3" fill="#e15050" />
        {drops.map((d, i) => (
          <g key={i}>
            <circle cx={d.x} cy={d.y} r="9" fill="none" stroke={ink} strokeWidth="1.2" />
            <circle cx={d.x} cy={d.y} r="2" fill={ink} />
          </g>
        ))}
        <circle cx={CX} cy={CY} r="8" fill="#050607" />
        <circle cx={CX} cy={CY} r="6" fill="none" stroke="#f2f1ed" strokeWidth="1.8" />
        <circle cx={CX} cy={CY} r="3" fill="#34d378" />
      </svg>
      <figcaption className="mt-4 grid max-w-[420px] grid-cols-2 gap-x-6 gap-y-2 text-xs text-paper-muted">
        <span className="flex items-center gap-2">
          <span className="size-3 rounded-full border-2 border-[#1faa5c] bg-[#34d378]/20" /> Probable storage zone
        </span>
        <span className="flex items-center gap-2">
          <span className="grid size-3 place-items-center rounded-full bg-[#050607]">
            <span className="size-1.5 rounded-full bg-signal" />
          </span>
          Storage centre
        </span>
        <span className="flex items-center gap-2">
          <span className="grid size-3 place-items-center rounded-full border border-paper-ink">
            <span className="size-1 rounded-full bg-paper-ink" />
          </span>
          Probable drop zone · point
        </span>
        <span className="flex items-center gap-2">
          <span className="size-3 rounded-sm bg-water" /> Water · buffer
        </span>
      </figcaption>
    </figure>
  );
}

export function ImageryBand() {
  return (
    <section className="relative isolate overflow-hidden" aria-label="Scope of the analysis">
      <img
        src="/imagery/band-missouri-2008.jpg"
        alt="Oblique aerial photograph of a river in flood across farmland."
        className="absolute inset-0 -z-20 size-full object-cover"
        loading="lazy"
      />
      <div className="absolute inset-0 -z-10 bg-canvas/65" />
      <div className="mx-auto max-w-[1280px] px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
        <p className="display max-w-3xl text-[28px] sm:text-[40px]">
          AASRA measures geometry in image pixels. It does not see ground
          conditions, people or obstacles, and it does not replace field
          verification.
        </p>
      </div>
      <p className="absolute bottom-3 right-4 text-[10px] text-ink/45 sm:right-6 lg:right-8">
        Flooding in Missouri, 2008 · FEMA / Jocelyn Augustino · Public domain
      </p>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line bg-canvas">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-3 px-4 py-8 text-xs text-faint sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p>AASRA · Computer-vision decision-support prototype · Not an operational system</p>
        <p>Imagery: U.S. government photographs in the public domain (FEMA, U.S. Army).</p>
      </div>
    </footer>
  );
}
