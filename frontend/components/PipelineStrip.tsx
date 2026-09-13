"use client";

import { Droplets, Grid2x2, Ruler, ListOrdered } from "lucide-react";

/**
 * A compact description of what the analysis produces. Static explanatory
 * copy only — it describes the backend pipeline (see docs/pipeline.md) and
 * displays no measurements.
 */
const STEPS = [
  {
    icon: Droplets,
    label: "Water Detection",
    detail: "Multi-stage floodwater heuristic",
  },
  {
    icon: Grid2x2,
    label: "Region Analysis",
    detail: "Connected components outside the water buffer",
  },
  {
    icon: Ruler,
    label: "Clearance",
    detail: "Distance transform in image pixels",
  },
  {
    icon: ListOrdered,
    label: "Zone Ranking",
    detail: "Transparent 0-100 scoring",
  },
];

export function PipelineStrip() {
  return (
    <div className="anim-fade-up grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4">
      {STEPS.map((step, index) => {
        const Icon = step.icon;
        return (
          <div key={step.label} className="bg-surface/80 px-4 py-4">
            <div className="flex items-center gap-2">
              <Icon className="size-3.5 text-water/70" strokeWidth={1.75} />
              <span className="font-mono text-[9px] tracking-[0.14em] text-faint/70">
                {String(index + 1).padStart(2, "0")}
              </span>
            </div>
            <div className="mt-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink">
              {step.label}
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
              {step.detail}
            </p>
          </div>
        );
      })}
    </div>
  );
}
