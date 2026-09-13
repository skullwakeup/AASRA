"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { ScoreBar } from "@/components/ScoreBreakdown";
import { toneFor } from "@/lib/classification";
import { formatInt, formatPx, formatScore } from "@/lib/format";
import type { ScoreWeights, Zone } from "@/types/api";

/**
 * One ranked potential zone.
 *
 * `#{zone.id}` matches the "Zone N" label drawn in the Final Result image —
 * the backend renumbers zones 1..N in ranked order (scoring.rank_zones).
 *
 * Wording rule: the backend's own classification string is shown verbatim
 * ("HIGH POTENTIAL" etc.). Nothing here is described as safe, and no aircraft
 * or landing claim is made.
 */
export function ZoneCard({
  zone,
  weights,
}: {
  zone: Zone;
  weights: ScoreWeights;
}) {
  const [expanded, setExpanded] = useState(false);
  const tone = toneFor(zone.classification);
  const breakdown = zone.score_breakdown;

  return (
    <article className="flex flex-col rounded-lg border border-line bg-surface">
      <div className="px-5 pb-4 pt-5">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-sm text-muted tabular-nums">
            #{zone.id}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.06em] ${tone.text}`}
          >
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${tone.fill}`}
            />
            {zone.classification}
          </span>
        </div>

        <p className="mt-4 flex items-baseline gap-1.5">
          <span className="font-mono text-4xl font-medium leading-none tracking-tight text-ink tabular-nums">
            {formatScore(zone.score)}
          </span>
          <span className="text-sm text-faint">/ 100</span>
        </p>
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-line">
          <div
            className={`h-full rounded-full ${tone.fill}`}
            style={{ width: `${Math.max(0, Math.min(100, zone.score))}%` }}
          />
        </div>
      </div>

      {/* Real measurements — all in processed-image pixels. */}
      <dl className="space-y-2.5 border-t border-line px-5 py-4 text-sm">
        <Row label="Area" value={`${formatInt(zone.pixel_area)} px`} />
        <Row label="Water clearance" value={formatPx(zone.water_clearance, 1)} />
        <Row label="Region clearance" value={formatPx(zone.region_clearance, 1)} />
        <Row
          label="Drop point"
          value={`${zone.drop_point.x}, ${zone.drop_point.y}`}
          title="Processed-image pixel coordinates (x, y)"
        />
      </dl>

      {/* Expandable, honest score breakdown */}
      <div className="mt-auto border-t border-line">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between gap-2 px-5 py-3 text-sm text-muted transition-colors duration-150 hover:text-ink"
        >
          Score breakdown
          <ChevronDown
            className={`size-4 transition-transform duration-200 ${
              expanded ? "rotate-180" : ""
            }`}
            strokeWidth={1.75}
          />
        </button>

        {expanded ? (
          <div className="border-t border-line px-5 py-4">
            <ul className="space-y-3">
              <ScoreBar
                label="Area"
                value={breakdown.area_score}
                weight={weights.area}
                fill={tone.fill}
              />
              <ScoreBar
                label="Water clearance"
                value={breakdown.water_clearance_score}
                weight={weights.water_clearance}
                fill={tone.fill}
              />
              <ScoreBar
                label="Openness"
                value={breakdown.openness_score}
                weight={weights.openness}
                fill={tone.fill}
              />
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-faint">
              The score is the weighted sum of these components, as returned by
              the analysis service. Distances are processed-image pixels, not
              metres.
            </p>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function Row({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="font-mono text-ink tabular-nums" title={title}>
        {value}
      </dd>
    </div>
  );
}
