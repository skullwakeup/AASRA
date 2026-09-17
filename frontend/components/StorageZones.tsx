"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { ScoreBar } from "@/components/ScoreBreakdown";
import { titleCase, toneFor } from "@/lib/classification";
import { formatInt, formatPx, formatScore, rankLabel } from "@/lib/format";
import type {
  DropScoreWeights,
  DropZone,
  ScoreWeights,
  StorageAnalysis,
  StorageZone,
  Zone,
} from "@/types/api";

/**
 * Probable storage zones (primary) and their probable drop zones (secondary),
 * rendered on the light canvas. Every value is read from the response.
 *
 *   storage zone — circular candidate area around the storage centre
 *   drop zone    — small circle inside it; its drop point is the exact pixel
 *
 * Two different scores appear here and are labelled so they are never
 * confused: the storage zone carries its candidate region's zone score; each
 * drop zone carries its own spatial drop-point score.
 */

const LIMIT_LABEL: Record<StorageZone["limiting_factor"], string> = {
  water_buffer: "Water buffer",
  candidate_boundary: "Region edge",
  image_boundary: "Image edge",
  max_radius: "Radius cap",
};

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div>
      <dt className="text-xs text-paper-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-light tabular-nums sm:text-[28px]" data-testid={testId}>
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

export function StorageZoneCard({
  storage,
  zone,
  weights,
  selected,
  onSelect,
  onHover,
}: {
  storage: StorageZone;
  zone?: Zone;
  weights: ScoreWeights;
  selected: boolean;
  onSelect: () => void;
  onHover: (active: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const tone = toneFor(storage.classification);

  return (
    <article
      data-testid={`storage-card-${storage.id}`}
      className={`flex flex-col rounded-lg border bg-paper-card transition-colors duration-150 ${
        selected ? "border-paper-ink" : "border-paper-line hover:border-paper-ink/40"
      }`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <button
        type="button"
        onClick={onSelect}
        onFocus={() => onHover(true)}
        onBlur={() => onHover(false)}
        aria-pressed={selected}
        className="p-5 text-left sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow text-paper-faint">Probable storage zone {rankLabel(storage.id - 1)}</p>
          <Badge classification={storage.classification} />
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5">
          <Stat label="Centre" value={`${storage.center.x}, ${storage.center.y}`} testId={`storage-center-${storage.id}`} />
          <Stat label="Valid radius" value={formatPx(storage.radius_px)} testId={`storage-radius-${storage.id}`} />
          <Stat label="Probable drop zones" value={formatInt(storage.candidate_drop_zones.length)} />
          <Stat label="Water clearance" value={formatPx(storage.water_clearance_px, 1)} />
        </dl>

        <p className="mt-5 text-sm text-paper-muted">
          Limited by: <span className="text-paper-ink">{LIMIT_LABEL[storage.limiting_factor]}</span>
          {storage.limiting_factor === "max_radius"
            ? ""
            : ` at ${formatPx(storage.limiting_distance_px, 1)}`}
        </p>
      </button>

      <div className="mt-auto border-t border-paper-line">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between gap-3 px-5 py-3 text-sm text-paper-muted transition-colors hover:text-paper-ink sm:px-6"
        >
          <span>
            Region score{" "}
            <span className={`font-semibold tabular-nums ${tone.ink}`}>
              {formatScore(storage.score)}
            </span>
            <span className="text-paper-faint"> / 100</span>
          </span>
          <ChevronDown
            className={`size-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            strokeWidth={1.75}
          />
        </button>
        {expanded && zone ? (
          <div className="border-t border-paper-line px-5 py-4 sm:px-6">
            <ul className="space-y-3">
              <ScoreBar label="Area" value={zone.score_breakdown.area_score} weight={weights.area} fill={tone.fill} />
              <ScoreBar label="Water clearance" value={zone.score_breakdown.water_clearance_score} weight={weights.water_clearance} fill={tone.fill} />
              <ScoreBar label="Openness" value={zone.score_breakdown.openness_score} weight={weights.openness} fill={tone.fill} />
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-paper-faint">
              Score of the candidate region this storage zone sits in ({formatInt(zone.pixel_area)} px).
            </p>
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
  item: StorageAnalysis["not_viable"][number];
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
          No storage zone
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

export function DropZoneCard({
  drop,
  weights,
  onHover,
}: {
  drop: DropZone;
  weights: DropScoreWeights;
  onHover: (active: boolean) => void;
}) {
  const tone = toneFor(drop.classification);
  const b = drop.score_breakdown;
  return (
    <li
      data-testid={`drop-card-${drop.id}`}
      tabIndex={0}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      className="rounded-lg border border-paper-line bg-paper-card p-4 transition-colors duration-150 hover:border-paper-ink/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow text-paper-faint">Drop zone {rankLabel(drop.id - 1)}</p>
          <p className="mt-1 text-sm text-paper-muted">
            Candidate drop point{" "}
            <span className="tabular-nums text-paper-ink">
              {drop.point.x}, {drop.point.y}
            </span>
          </p>
        </div>
        <div className="text-right">
          <p className={`text-[28px] font-light leading-none tabular-nums ${tone.ink}`}>{formatScore(drop.score)}</p>
          <p className={`mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${tone.ink}`}>
            {drop.classification.replace(" POTENTIAL", "")}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-[13px]">
        <div>
          <dt className="text-paper-faint">Clearance</dt>
          <dd className="tabular-nums">{formatPx(drop.clearance_px, 1)}</dd>
        </div>
        <div>
          <dt className="text-paper-faint">From centre</dt>
          <dd className="tabular-nums">{formatPx(drop.distance_from_storage_center_px, 1)}</dd>
        </div>
        <div>
          <dt className="text-paper-faint">To water</dt>
          <dd className="tabular-nums">{formatPx(drop.water_clearance_px, 1)}</dd>
        </div>
      </dl>

      <ul className="mt-4 space-y-2">
        <ScoreBar label="Clearance" value={b.clearance_score} weight={weights.clearance} fill={tone.fill} />
        <ScoreBar label="Water clearance" value={b.water_clearance_score} weight={weights.water_clearance} fill={tone.fill} />
        <ScoreBar label="Proximity" value={b.proximity_score} weight={weights.proximity} fill={tone.fill} />
      </ul>
    </li>
  );
}
