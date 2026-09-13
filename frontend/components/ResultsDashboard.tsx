"use client";

import {
  Droplets,
  Info,
  LandPlot,
  Mountain,
  RotateCcw,
  Target,
  MapPinned,
} from "lucide-react";
import { AIStatus } from "@/components/AIStatus";
import { Disclaimer } from "@/components/Disclaimer";
import { EmptyState } from "@/components/States";
import { ImageWorkspace } from "@/components/ImageWorkspace";
import { IsolationCard } from "@/components/IsolationCard";
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
  const { metrics, zones, isolated_regions: isolatedRegions } = result;

  return (
    <div className="anim-fade space-y-8">
      {/* ---------------------------------------------------------- header */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line pb-5">
        <div className="min-w-0">
          <h1 className="font-mono text-lg uppercase tracking-[0.16em] text-ink sm:text-xl">
            AASRA Analysis Results
          </h1>
          <p
            className="mt-2 truncate font-mono text-[11px] tracking-[0.1em] text-faint"
            title={fileName}
          >
            {fileName}
          </p>
        </div>

        <button
          type="button"
          onClick={onReset}
          className="inline-flex shrink-0 items-center gap-2 rounded border border-line-strong bg-raised px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink transition-colors duration-150 hover:border-water/50 hover:bg-water/10 hover:text-water"
        >
          <RotateCcw className="size-3.5" strokeWidth={2} />
          Analyze new image
        </button>
      </div>

      {/* ------------------------------------------------------- warnings */}
      {result.warnings.length > 0 ? (
        <div className="rounded-lg border border-line bg-surface/60 px-4 py-3.5 sm:px-5">
          <div className="flex gap-3">
            <Info className="mt-px size-4 shrink-0 text-muted" strokeWidth={1.75} />
            <div>
              <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                Analysis notes
              </h2>
              <ul className="mt-2 space-y-1.5">
                {result.warnings.map((warning) => (
                  <li key={warning} className="text-xs leading-relaxed text-faint">
                    {warning}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {/* -------------------------------------------------------- metrics */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Water Coverage"
          value={formatPercent(metrics.water_percentage)}
          caption="Share of the processed image classified as floodwater."
          icon={<Droplets className="size-4" strokeWidth={1.75} />}
          accent="water"
          bar={metrics.water_percentage}
        />
        <MetricCard
          label="Non-Water Area"
          value={formatPercent(metrics.non_water_percentage)}
          caption="Remaining land and non-water surface in the frame."
          icon={<Mountain className="size-4" strokeWidth={1.75} />}
          accent="land"
          bar={metrics.non_water_percentage}
        />
        <MetricCard
          label="Candidate Regions"
          value={formatInt(metrics.candidate_regions)}
          caption={`Regions passing the size and clearance filters. ${formatPercent(
            metrics.candidate_area_percentage,
          )} of the frame is candidate area.`}
          icon={<Target className="size-4" strokeWidth={1.75} />}
          accent="zone"
        />
        <MetricCard
          label="Isolated Regions"
          value={formatInt(metrics.isolated_regions)}
          caption="Land components separated from the main landmass by water."
          icon={<LandPlot className="size-4" strokeWidth={1.75} />}
          accent="isolation"
        />
      </div>

      {/* ----------------------------------------- workspace + side panels */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <ImageWorkspace images={result.images} imageInfo={result.image_info} />
        <div className="space-y-5">
          <AIStatus mode={result.analysis_mode} />
          <ScanParameters
            parameters={result.parameters}
            imageInfo={result.image_info}
          />
        </div>
      </div>

      {/* ----------------------------------------------------- relief zones */}
      <section>
        <SectionHeading
          title="Potential Relief Zones"
          count={
            zones.length > 0
              ? `Top ${zones.length} of ${formatInt(metrics.candidate_regions)}`
              : undefined
          }
          description="Ranked candidate supply-drop regions. Candidates for verification only — not an operational clearance."
          icon={<MapPinned className="size-4" strokeWidth={1.75} />}
        />

        {zones.length > 0 ? (
          <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
            {zones.map((zone, index) => (
              <ZoneCard
                key={zone.id}
                zone={zone}
                index={index}
                weights={result.parameters.score_weights}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Target className="size-6" strokeWidth={1.5} />}
            title="No candidate zones identified"
            description="No region in this image passed the minimum area and clearance filters. Regions may have been too small, too narrow, or entirely inside the water buffer."
          />
        )}
      </section>

      {/* ------------------------------------------------ isolated regions */}
      <section>
        <SectionHeading
          title="Potentially Isolated Land Regions"
          count={
            isolatedRegions.length > 0
              ? `${formatInt(isolatedRegions.length)} detected`
              : undefined
          }
          description="Land geometry separated from the main landmass by detected water. No inference is made about people or occupancy."
          icon={<LandPlot className="size-4" strokeWidth={1.75} />}
        />

        {isolatedRegions.length > 0 ? (
          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {isolatedRegions.map((region, index) => (
              <IsolationCard key={region.id} region={region} index={index} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<LandPlot className="size-6" strokeWidth={1.5} />}
            title="No potentially isolated regions identified"
            description="Every detected land component in this image connects to the main landmass, or no component met the minimum area threshold."
          />
        )}
      </section>

      <Disclaimer notice={result.notice} />
    </div>
  );
}
