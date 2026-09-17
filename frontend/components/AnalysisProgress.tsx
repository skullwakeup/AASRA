"use client";

import { useEffect, useState } from "react";
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
  "Detecting water",
  "Separating candidate land",
  "Measuring region clearance",
  "Computing storage radius",
  "Sampling probable drop zones",
  "Running object context",
];

export function AnalysisProgress({ previewUrl }: { previewUrl: string }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % CAPTIONS.length);
    }, 1600);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <Panel className="anim-fade-up overflow-hidden" aria-busy="true">
      <div className="viewer-canvas relative overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewUrl}
          alt=""
          aria-hidden="true"
          className="mx-auto block max-h-[52vh] w-full object-contain opacity-40"
        />
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="anim-sweep h-px w-full bg-water/80" />
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-lg text-ink">Analysis in progress</p>
          <span
            key={index}
            className="anim-fade eyebrow text-muted"
            aria-live="polite"
          >
            {CAPTIONS[index]}
          </span>
        </div>
        <div className="relative mt-4 h-[2px] w-full overflow-hidden rounded-full bg-line">
          <div className="anim-indeterminate absolute inset-y-0 left-0 w-1/3 rounded-full bg-water" />
        </div>
        <p className="mt-3 text-xs text-faint">
          Indicative activity only. The service returns one completed result,
          not live stage updates.
        </p>
      </div>
    </Panel>
  );
}
