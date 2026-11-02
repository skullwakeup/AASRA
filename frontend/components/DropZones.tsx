"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { ScoreBar } from "@/components/ScoreBreakdown";
import { titleCase, toneFor } from "@/lib/classification";
import { formatInt, formatPercent, formatPx, formatScore, rankLabel } from "@/lib/format";
import type {
  ScoreWeights,
  SensorAnalysis,
  SensorZone,
  SupplySegment,
  SupplyZone,
  Zone,
} from "@/types/api";

/**
 * The two drop-zone results, rendered on the light canvas. Every value is
 * read from the response.
 *
 *   Probable Smart Sensor Drop Zone — purple circle: the largest circle of
 *     candidate land around a ranked region's max-clearance point
 *   Probable Supply Drop Zone — green band of open land between the inner
 *     and outer margins around detected water
 */

const LIMIT_LABEL: Record<SensorZone["limiting_factor"], string> = {
  water_buffer: "Water buffer",
  candidate_boundary: "Region edge / canopy",
  image_boundary: "Image edge",
  max_radius: "Radius cap",
};

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-paper-muted">{label}</dt>
      <dd className="mt-1 whitespace-nowrap text-xl font-light tabular-nums sm:text-2xl" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function Badge({ classification }: { classification: string }) {
  const tone = toneFor(classification);
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] ${tone.ink}`}>
      <span aria-hidden="true" className={`size-2 rounded-full ${tone.fill}`} />
      {classification}
    </span>
  );
}

export function SensorZoneCard({
  sensor,
  zone,
  weights,
  onHover,
}: {
  sensor: SensorZone;
  zone?: Zone;
  weights: ScoreWeights;
  onHover: (active: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const tone = toneFor(sensor.classification);

  return (
    <article
      data-testid={`sensor-card-${sensor.id}`}
      tabIndex={0}
      className="flex flex-col rounded-lg border border-l-4 border-paper-line border-l-sensor bg-paper-card transition-colors duration-150 hover:border-paper-ink/40 hover:border-l-sensor"
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
    >
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow text-sensor-ink">Sensor drop zone {rankLabel(sensor.id - 1)}</p>
          <Badge classification={sensor.classification} />
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5">
          <Stat label="Centre" value={`${sensor.center.x}, ${sensor.center.y}`} testId={`sensor-center-${sensor.id}`} />
          <Stat label="Radius" value={formatPx(sensor.radius_px)} testId={`sensor-radius-${sensor.id}`} />
        </dl>
        <p className="mt-5 text-sm text-paper-muted">
          {formatPx(sensor.water_clearance_px, 1)} from water · limited by{" "}
          <span className="text-paper-ink">{LIMIT_LABEL[sensor.limiting_factor]}</span>
          {sensor.limiting_factor === "max_radius"
            ? ""
            : ` at ${formatPx(sensor.limiting_distance_px, 1)}`}
        </p>
      </div>

      <div className="mt-auto border-t border-paper-line">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between gap-3 px-5 py-3 text-sm text-paper-muted transition-colors hover:text-paper-ink sm:px-6"
        >
          <span>
            Region score{" "}
            <span className={`font-semibold tabular-nums ${tone.ink}`}>{formatScore(sensor.score)}</span>
            <span className="text-paper-faint"> / 100</span>
          </span>
          <ChevronDown
            className={`size-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            strokeWidth={1.75}
          />
        </button>
        {expanded ? (
          <div className="border-t border-paper-line px-5 py-4 sm:px-6">
            <ul className="space-y-3">
              <ScoreBar label="Area" value={sensor.score_breakdown.area_score} weight={weights.area} fill={tone.fill} />
              <ScoreBar label="Water clearance" value={sensor.score_breakdown.water_clearance_score} weight={weights.water_clearance} fill={tone.fill} />
              <ScoreBar label="Openness" value={sensor.score_breakdown.openness_score} weight={weights.openness} fill={tone.fill} />
            </ul>
            {zone ? (
              <p className="mt-4 text-xs leading-relaxed text-paper-faint">
                Score of the candidate region this zone sits in ({formatInt(zone.pixel_area)} px).
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function NotViableCard({
  zone,
  item,
  minRadius,
}: {
  zone?: Zone;
  item: SensorAnalysis["not_viable"][number];
  minRadius: number;
}) {
  const reason =
    item.reason === "radius_below_minimum"
      ? `Largest valid radius is ${formatPx(item.radius_px)}, below the ${formatPx(minRadius)} minimum.`
      : item.reason === "duplicate_center"
        ? "Same centre as a zone already shown."
        : "Its centre falls inside an excluded area.";
  return (
    <article className="flex flex-col rounded-lg border border-dashed border-paper-ink/20 p-5 sm:p-6" data-testid={`not-viable-${item.zone_id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow text-paper-faint">Candidate region {rankLabel(item.zone_id - 1)}</p>
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-paper-faint">
          No sensor zone
        </span>
      </div>
      <p className="mt-5 text-sm leading-relaxed text-paper-muted">{reason}</p>
      {zone ? (
        <p className="mt-auto pt-5 text-sm text-paper-muted">
          Region score <span className="tabular-nums text-paper-ink">{formatScore(zone.score)}</span> ·{" "}
          {titleCase(zone.classification)} · {formatInt(zone.pixel_area)} px
        </p>
      ) : null}
    </article>
  );
}

/** Whole-band summary: margins, area, what canopy removed. */
export function SupplySummary({ supply }: { supply: SupplyZone }) {
  const canopyShare =
    supply.shoreline_land_px > 0
      ? (100 * supply.canopy_excluded_px) / supply.shoreline_land_px
      : 0;
  return (
    <div
      className="rounded-lg border border-l-4 border-paper-line border-l-supply bg-paper-card p-5 sm:p-6"
      data-testid="supply-summary"
    >
      <p className="eyebrow text-supply-ink">Probable supply drop zone</p>
      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Stat label="Inner margin" value={formatPx(supply.inner_margin_px)} />
        <Stat label="Outer margin" value={formatPx(supply.outer_margin_px)} />
        <Stat label="Band area" value={formatPercent(supply.area_percentage, 1)} testId="supply-area" />
        <Stat label="Segments" value={formatInt(supply.segment_count)} testId="supply-segments" />
      </dl>
      <p className="mt-5 text-sm leading-relaxed text-paper-muted">
        Open land from {formatPx(supply.inner_margin_px)} to {formatPx(supply.outer_margin_px)} back
        from the detected water&apos;s edge ({formatInt(supply.pixel_area)} px).
        {supply.canopy_excluded_px > 0
          ? ` ${formatPercent(canopyShare, 0)} of the land between the margins is tree canopy and was left out.`
          : ""}
      </p>
    </div>
  );
}

export function SupplySegmentCard({
  segment,
  onHover,
}: {
  segment: SupplySegment;
  onHover: (active: boolean) => void;
}) {
  return (
    <li
      data-testid={`supply-card-${segment.id}`}
      tabIndex={0}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      className="rounded-lg border border-paper-line bg-paper-card p-4 transition-colors duration-150 hover:border-paper-ink/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow text-supply-ink">Segment S{segment.id}</p>
          <p className="mt-1 text-sm text-paper-muted">
            Around{" "}
            <span className="tabular-nums text-paper-ink">
              {segment.anchor.x}, {segment.anchor.y}
            </span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-[28px] font-light leading-none tabular-nums text-supply-ink">
            {formatPercent(segment.share_of_band, 0)}
          </p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-paper-faint">of band</p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-[13px]">
        <div>
          <dt className="text-paper-faint">Area</dt>
          <dd className="tabular-nums">{formatInt(segment.pixel_area)} px</dd>
        </div>
        <div>
          <dt className="text-paper-faint">Extent</dt>
          <dd className="tabular-nums">
            {segment.bounding_box.width} × {segment.bounding_box.height} px
          </dd>
        </div>
      </dl>
    </li>
  );
}
