"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Panel } from "@/components/Panel";

/**
 * Loading experience for the single POST /api/analyze request.
 *
 * HONESTY NOTE: the backend performs one synchronous analysis and returns one
 * response — it does not stream progress. These captions describe what the
 * pipeline does; they are NOT live stage telemetry, and the caption below the
 * bar says so.
 */
const CAPTIONS = [
  "Analyzing water distribution",
  "Processing spatial regions",
  "Calculating water clearance",
  "Ranking candidate zones",
];

export function AnalysisProgress({ previewUrl }: { previewUrl: string }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % CAPTIONS.length);
    }, 1900);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <Panel className="anim-fade-up overflow-hidden">
      <div className="flex flex-col items-center px-5 py-10 sm:py-14">
        {/* Preview with a single slow scan sweep. */}
        <div className="viewer-canvas relative h-48 w-full max-w-md overflow-hidden rounded border border-line sm:h-56">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt=""
            aria-hidden="true"
            className="size-full object-contain opacity-45"
          />
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="anim-sweep h-[2px] w-full bg-gradient-to-r from-transparent via-water to-transparent opacity-70" />
          </div>
          <div className="pointer-events-none absolute inset-0 bg-ground/35" />
        </div>

        <div className="mt-8 flex items-center gap-2.5">
          <Loader2 className="size-4 animate-spin text-water" strokeWidth={2} />
          <h3 className="font-mono text-[13px] uppercase tracking-[0.2em] text-ink">
            Analysis in progress
          </h3>
        </div>

        {/* Rotating caption. Fixed height so nothing shifts between swaps. */}
        <div className="mt-4 flex h-5 items-center" aria-live="polite">
          <span
            key={index}
            className="anim-fade font-mono text-[11px] uppercase tracking-[0.18em] text-muted"
          >
            {CAPTIONS[index]}
          </span>
        </div>

        <div className="relative mt-6 h-[3px] w-full max-w-md overflow-hidden rounded-full bg-line">
          <div className="anim-indeterminate absolute inset-y-0 left-0 w-1/3 rounded-full bg-water/80" />
        </div>

        <p className="mt-5 max-w-sm text-center text-[11px] leading-relaxed text-faint">
          Indicative activity display. The analysis service returns a single
          completed result rather than live stage updates.
        </p>
      </div>
    </Panel>
  );
}
