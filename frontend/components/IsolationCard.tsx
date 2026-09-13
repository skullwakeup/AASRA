"use client";

import { useState } from "react";
import { ChevronDown, LandPlot } from "lucide-react";
import { FactorRow } from "@/components/ScoreBreakdown";
import { toneFor } from "@/lib/classification";
import { formatInt, formatPx, formatScore, rankLabel } from "@/lib/format";
import type { IsolatedRegion } from "@/types/api";

/**
 * One potentially isolated land region.
 *
 * The backend detects land geometry only. Nothing here infers or implies human
 * presence — no "people", no "trapped", no rescue claim.
 */
export function IsolationCard({
  region,
  index,
}: {
  region: IsolatedRegion;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const tone = toneFor(region.classification);
  const factors = region.score_breakdown;

  return (
    <article
      className="anim-fade-up overflow-hidden rounded-lg border border-line bg-surface/80 transition-colors duration-200 hover:border-line-strong"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2.5">
          <LandPlot className="size-3.5 text-faint" strokeWidth={1.75} />
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
            Region {rankLabel(index)}
          </span>
          <span className="font-mono text-[10px] tracking-[0.12em] text-faint/80">
            ID {region.id}
          </span>
        </div>
        <span
          className={`rounded border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] ${tone.badge}`}
        >
          {region.classification}
        </span>
      </header>

      <div className="px-4 py-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-faint">
              Isolation Score
            </div>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span
                className={`font-mono text-[26px] font-medium leading-none tabular-nums ${tone.text}`}
              >
                {formatScore(region.isolation_score)}
              </span>
              <span className="font-mono text-xs text-faint">/ 100</span>
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-faint">
              Pixel Area
            </div>
            <div className="mt-1.5 font-mono text-[13px] text-ink tabular-nums">
              {formatInt(region.pixel_area)} px
            </div>
          </div>
        </div>

        <div className="mt-3.5 h-[3px] w-full overflow-hidden rounded-full bg-line">
          <div
            className={`h-full rounded-full ${tone.fill} transition-[width] duration-700 ease-out`}
            style={{
              width: `${Math.max(0, Math.min(100, region.isolation_score))}%`,
            }}
          />
        </div>
      </div>

      <div className="border-t border-line">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-faint transition-colors duration-150 hover:bg-raised/60 hover:text-muted"
        >
          Why this score?
          <ChevronDown
            className={`size-3.5 transition-transform duration-200 ${
              expanded ? "rotate-180" : ""
            }`}
            strokeWidth={2}
          />
        </button>

        {expanded ? (
          <div className="anim-fade border-t border-line bg-raised/40 px-4 py-4">
            <ul className="space-y-3.5">
              <FactorRow
                label="Water Contact Ratio"
                value={factors.water_contact_ratio.toFixed(2)}
                ratio={factors.water_contact_ratio}
                fill={tone.fill}
              />
              <FactorRow
                label="Separation"
                value={formatPx(factors.separation_px, 1)}
                fill={tone.fill}
              />
              <FactorRow
                label="Relative Size"
                value={factors.relative_size.toFixed(2)}
                ratio={factors.relative_size}
                fill={tone.fill}
              />
            </ul>
            <p className="mt-4 text-[10px] leading-relaxed text-faint">
              Land-geometry measurements only: how much of the region border
              touches detected water, its pixel distance from the largest land
              component, and its size relative to that component.
            </p>
          </div>
        ) : null}
      </div>
    </article>
  );
}
