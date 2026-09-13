"use client";

import { useState } from "react";
import { ChevronDown, Crosshair, Ruler, Waves } from "lucide-react";
import { ScoreBar } from "@/components/ScoreBreakdown";
import { toneFor } from "@/lib/classification";
import { formatInt, formatPx, formatScore, rankLabel } from "@/lib/format";
import type { ScoreWeights, Zone } from "@/types/api";

/**
 * One ranked candidate zone.
 *
 * Wording rule: the backend's own classification string is shown verbatim
 * ("HIGH POTENTIAL" etc.). Nothing here is described as safe, and no aircraft
 * or landing claim is made — the backend calls these candidate supply-drop
 * zones and so does this card.
 */
export function ZoneCard({
  zone,
  index,
  weights,
}: {
  zone: Zone;
  index: number;
  weights: ScoreWeights;
}) {
  const [expanded, setExpanded] = useState(false);
  const tone = toneFor(zone.classification);
  const isTop = index === 0;
  const breakdown = zone.score_breakdown;

  return (
    <article
      className={`anim-fade-up flex flex-col overflow-hidden rounded-lg border bg-surface/80 transition-colors duration-200 ${
        isTop ? "border-emerald-400/30" : "border-line hover:border-line-strong"
      }`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* Rank + classification */}
      <header
        className={`flex items-center justify-between gap-3 border-b border-line px-4 py-3 ${
          isTop ? tone.wash : ""
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`font-mono text-[22px] font-medium leading-none tabular-nums ${
              isTop ? tone.text : "text-faint"
            }`}
          >
            {rankLabel(index)}
          </span>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
              Potential Zone
            </div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-faint/80">
              ID {zone.id}
            </div>
          </div>
        </div>

        <span
          className={`rounded border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] ${tone.badge}`}
        >
          {zone.classification}
        </span>
      </header>

      <div className="flex-1 px-4 py-4">
        {/* Score */}
        <div className="flex items-baseline gap-1.5">
          <span
            className={`font-mono text-[32px] font-medium leading-none tabular-nums ${tone.text}`}
          >
            {formatScore(zone.score)}
          </span>
          <span className="font-mono text-sm text-faint">/ 100</span>
        </div>
        <div className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-line">
          <div
            className={`h-full rounded-full ${tone.fill} transition-[width] duration-700 ease-out`}
            style={{ width: `${Math.max(0, Math.min(100, zone.score))}%` }}
          />
        </div>

        {/* Real measurements — all in processed-image pixels. */}
        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
          <Measure
            icon={<Ruler className="size-3" strokeWidth={1.75} />}
            label="Pixel Area"
            value={`${formatInt(zone.pixel_area)} px`}
          />
          <Measure
            icon={<Waves className="size-3" strokeWidth={1.75} />}
            label="Water Clearance"
            value={formatPx(zone.water_clearance, 1)}
          />
          <Measure
            icon={<Ruler className="size-3" strokeWidth={1.75} />}
            label="Region Clearance"
            value={formatPx(zone.region_clearance, 1)}
          />
          <Measure
            icon={<Crosshair className="size-3" strokeWidth={1.75} />}
            label="Drop Point"
            value={`${zone.drop_point.x}, ${zone.drop_point.y}`}
          />
        </dl>
      </div>

      {/* Expandable, honest score breakdown */}
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
              <ScoreBar
                label="Area Score"
                value={breakdown.area_score}
                weight={weights.area}
                fill={tone.fill}
              />
              <ScoreBar
                label="Water Clearance Score"
                value={breakdown.water_clearance_score}
                weight={weights.water_clearance}
                fill={tone.fill}
              />
              <ScoreBar
                label="Openness Score"
                value={breakdown.openness_score}
                weight={weights.openness}
                fill={tone.fill}
              />
            </ul>
            <p className="mt-4 text-[10px] leading-relaxed text-faint">
              Weighted sum of the three components above, as returned by the
              analysis service. All distances are pixels of the processed image,
              not metres.
            </p>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function Measure({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
        <span className="text-faint/70">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1.5 font-mono text-[13px] text-ink tabular-nums">
        {value}
      </dd>
    </div>
  );
}
