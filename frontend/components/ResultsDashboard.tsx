"use client";

import { RotateCcw } from "lucide-react";
import { AIStatus } from "@/components/AIStatus";
import { Disclaimer } from "@/components/Disclaimer";
import { EmptyState } from "@/components/States";
import { ImageWorkspace } from "@/components/ImageWorkspace";
import { MetricCard } from "@/components/MetricCard";
import { ScanParameters } from "@/components/ScanParameters";
import { SectionHeading } from "@/components/Panel";
import { ZoneCard } from "@/components/ZoneCard";
import { formatInt, formatPercent } from "@/lib/format";
import type { AnalysisResponse } from "@/types/api";

/**
 * The results view. Every value rendered below is read from `result` — the
 * unmodified response of POST /api/analyze. No metric is derived, defaulted
 * or hardcoded here.
 *
 * Potentially isolated land regions (`result.isolated_regions`) are presented
 * inside the visualization block, as the Land Isolation tab — between the
 * candidate mask and the final result, which is where they sit in the
 * pipeline. They are reported, never concluded from: the dashboard's
 * conclusion is still the ranked potential zones, and nothing about isolation
 * feeds zone scoring.
 */
export function ResultsDashboard({
  result,
  fileName,
  onReset,
}: {
  result: AnalysisResponse;
  fileName: string;
  onReset: () => void;
}) {
  const {
    metrics,
    zones,
    isolated_regions: isolatedRegions,
    image_info: imageInfo,
  } = result;

  // Every backend warning is shown now that each one refers to a view the
  // dashboard actually presents.
  const notes = result.warnings;

  const zoneCount =
    zones.length === 0
      ? undefined
      : zones.length < metrics.candidate_regions
        ? `Top ${zones.length} of ${formatInt(metrics.candidate_regions)}`
        : `${zones.length} ranked`;

  return (
    <div className="anim-fade space-y-10">
      {/* ---------------------------------------------------------- header */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line pb-6">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            AASRA Analysis Results
          </h1>
          <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-muted">
            {fileName ? (
              <>
                <span className="max-w-full truncate" title={fileName}>
                  {fileName}
                </span>
                <span aria-hidden="true" className="text-faint">
                  ·
                </span>
              </>
            ) : null}
            <span className="tabular-nums">
              {imageInfo.original_width} &times; {imageInfo.original_height} px
            </span>
          </p>
        </div>

        <button
          type="button"
          onClick={onReset}
          className="inline-flex shrink-0 items-center gap-2 rounded-md border border-line-strong bg-raised px-3.5 py-2 text-sm font-medium text-ink transition-colors duration-150 hover:border-faint hover:bg-line"
        >
          <RotateCcw className="size-3.5" strokeWidth={2} />
          Analyze new image
        </button>
      </header>

      {/* ---------------------------------------------------------- notes */}
      {notes.length > 0 ? (
        <div className="rounded-lg border border-line bg-surface px-4 py-3.5 sm:px-5">
          <p className="text-sm font-medium text-ink">Analysis notes</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm leading-relaxed text-muted">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* -------------------------------------------------------- summary */}
      <section>
        <SectionHeading title="Summary" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Water coverage"
            value={formatPercent(metrics.water_percentage)}
            caption="Share of the processed image classified as water."
            accent="water"
            bar={metrics.water_percentage}
          />
          <MetricCard
            label="Non-water area"
            value={formatPercent(metrics.non_water_percentage)}
            caption="Land and other non-water surfaces."
            bar={metrics.non_water_percentage}
          />
          <MetricCard
            label="Candidate regions"
            value={formatInt(metrics.candidate_regions)}
            caption={`Regions that passed the size and clearance filters, covering ${formatPercent(
              metrics.candidate_area_percentage,
            )} of the image.`}
          />
          <MetricCard
            label="Isolated land regions"
            value={formatInt(metrics.isolated_regions)}
            caption="Land patches disconnected from the largest landmass by detected water. Geometry only — see the Land Isolation tab."
          />
        </div>
      </section>

      {/* -------------------------------------------------- visualization */}
      <section>
        <SectionHeading
          title="Analysis visualization"
          description="Each tab shows one stage of the analysis. Final Result is the summary view."
        />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <ImageWorkspace
            images={result.images}
            imageInfo={imageInfo}
            isolatedRegions={isolatedRegions}
          />
          <div className="lg:self-start">
            <ScanParameters parameters={result.parameters} imageInfo={imageInfo} />
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- relief zones */}
      <section>
        <SectionHeading
          title="Potential relief zones"
          count={zoneCount}
          description="Candidate regions ranked by size, distance from detected water and openness. For verification only — not an operational clearance."
        />

        {zones.length > 0 ? (
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {zones.map((zone) => (
              <ZoneCard
                key={zone.id}
                zone={zone}
                weights={result.parameters.score_weights}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No potential zones identified"
            description="No region in this image passed the minimum area and clearance filters. Regions may have been too small, too narrow, or entirely inside the water buffer."
          />
        )}
      </section>

      {/* ---------------------------------------------- AI (supplementary) */}
      <section>
        <SectionHeading
          title="AI object detection"
          description="Supplementary context from a general-purpose object detector. It does not affect water detection or zone ranking."
        />
        <AIStatus mode={result.analysis_mode} ai={result.ai} />
      </section>

      <Disclaimer notice={result.notice} />
    </div>
  );
}
