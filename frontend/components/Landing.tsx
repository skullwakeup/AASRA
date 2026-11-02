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
          Image-derived spatial analysis finds open land around floodwater and
          marks probable smart sensor drop zones and a probable supply drop zone.
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
  { title: "Detect water", detail: "Colour, texture and edge cues, checked against this image's own water colour so concrete and roofs are not read as water." },
  { title: "Mask tree canopy", detail: "Textured vegetation is excluded: nothing dropped from the air reaches the ground through it." },
  { title: "Separate open land", detail: "Water is widened by a pixel buffer; open land outside it is candidate land." },
  { title: "Find high-clearance regions", detail: "Connected candidate regions are measured and ranked 0–100." },
  { title: "Size sensor drop zones", detail: "The largest circle of candidate land around each top region's highest-clearance point — purple." },
  { title: "Draw two margins round the water", detail: "An inner margin near the water's edge and an outer margin further back." },
  { title: "Mark the supply drop zone", detail: "Open land between the two margins, shaded green, so supplies land near the shore." },
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
            Every result is geometry measured on the image itself. Two separate
            results: smart sensor drop zones on open land, and a supply drop zone
            along the shoreline.
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

/** Schematic of the two results. Illustrative, not data. */
export function ConceptDiagram() {
  const water = "M0 0 H70 C58 60 60 170 40 236 H0 Z";
  // Iso-distance curves: the water edge shifted right by the two margins.
  const inner = "M86 0 C74 60 76 170 56 236";
  const outer = "M124 0 C112 60 114 170 94 236";
  return (
    <figure className="mt-10">
      <svg
        viewBox="0 0 300 236"
        className="w-full max-w-[420px]"
        role="img"
        aria-label="Diagram: water on the left; a green band of land between an inner and an outer margin along the shore; a purple circle on open land further from the water."
      >
        <path d={water} fill="#3a8ee6" fillOpacity="0.85" />
        <path d="M86 0 C74 60 76 170 56 236 H94 C114 170 112 60 124 0 Z" fill="#22c55e" fillOpacity="0.45" />
        <path d={inner} fill="none" stroke="#15803d" strokeWidth="2" />
        <path d={outer} fill="none" stroke="#15803d" strokeWidth="2" strokeDasharray="5 4" />
        <circle cx="212" cy="118" r="58" fill="#a855f7" fillOpacity="0.28" stroke="#7e22ce" strokeWidth="2.5" />
      </svg>
      <figcaption className="mt-4 grid max-w-[420px] grid-cols-2 gap-x-6 gap-y-2 text-xs text-paper-muted">
        <span className="flex items-center gap-2">
          <span className="size-3 rounded-full border-2 border-sensor-ink bg-sensor/30" /> Smart sensor drop zone
        </span>
        <span className="flex items-center gap-2">
          <span className="size-3 rounded-sm bg-supply/60" /> Supply drop zone
        </span>
        <span className="flex items-center gap-2">
          <span className="h-0.5 w-4 bg-supply-ink" /> Inner margin · <span className="h-0.5 w-4 border-t-2 border-dashed border-supply-ink" /> outer
        </span>
        <span className="flex items-center gap-2">
          <span className="size-3 rounded-sm bg-water" /> Water
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
