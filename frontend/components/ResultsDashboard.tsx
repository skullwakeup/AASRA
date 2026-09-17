"use client";

import { useMemo, useState } from "react";
import { AIStatus } from "@/components/AIStatus";
import { Disclaimer } from "@/components/Disclaimer";
import { EmptyState } from "@/components/States";
import { HighlightLayer, ImageWorkspace, type Highlight } from "@/components/ImageWorkspace";
import { MetricCard } from "@/components/MetricCard";
import { ScanParameters } from "@/components/ScanParameters";
import { SectionHeading } from "@/components/Panel";
import { DropZoneCard, NotViableCard, StorageZoneCard } from "@/components/StorageZones";
import { formatInt, formatPercent, rankLabel, toDataUrl } from "@/lib/format";
import { pillSecondary } from "@/lib/ui";
import type { AnalysisResponse } from "@/types/api";

/**
 * The results view. Every value rendered below is read from `result` — the
 * unmodified response of POST /api/analyze. No metric is derived, defaulted
 * or hardcoded here.
 *
 * Chapters alternate canvases: summary + stage viewer (dark), storage and
 * drop zones (light), object context (dark), limitations (light).
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
    storage_zones: storageZones = [],
    storage_analysis: storageAnalysis,
    isolated_regions: isolatedRegions,
    image_info: imageInfo,
    parameters,
  } = result;

  const [selectedId, setSelectedId] = useState<number | null>(storageZones[0]?.id ?? null);
  const [hoverStorage, setHoverStorage] = useState<number | null>(null);
  const [hoverDrop, setHoverDrop] = useState<number | null>(null);

  const selected = storageZones.find((zone) => zone.id === selectedId) ?? storageZones[0];
  const zonesById = useMemo(() => new Map(zones.map((zone) => [zone.id, zone])), [zones]);

  const highlight: Highlight =
    hoverDrop !== null && selected
      ? { storageId: selected.id, dropId: hoverDrop }
      : hoverStorage !== null
        ? { storageId: hoverStorage, dropId: null }
        : { storageId: null, dropId: null };

  const notViable = storageAnalysis?.not_viable ?? [];
  const finalImage = toDataUrl(result.images.final_analysis);

  return (
    <div className="anim-fade">
      {/* ----------------------------------------------- summary (dark) */}
      <section className="chapter">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
          <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
            <div className="min-w-0">
              <p className="eyebrow text-faint">Computer-vision estimate</p>
              <h1 className="display mt-3 text-[40px] sm:text-[54px]">AASRA Analysis Results</h1>
              <p className="mt-3 flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-muted">
                {fileName ? (
                  <>
                    <span className="max-w-full truncate" title={fileName}>
                      {fileName}
                    </span>
                    <span aria-hidden="true" className="text-faint">·</span>
                  </>
                ) : null}
                <span className="tabular-nums">
                  {imageInfo.original_width} × {imageInfo.original_height} px
                </span>
                <span aria-hidden="true" className="text-faint">·</span>
                <span className="tabular-nums">
                  analysed at {imageInfo.processed_width} × {imageInfo.processed_height} px
                </span>
              </p>
            </div>
            <button type="button" onClick={onReset} className={pillSecondary}>
              New analysis
            </button>
          </header>

          {result.warnings.length > 0 ? (
            <ul className="mt-8 space-y-1.5 border-l-2 border-caution pl-4 text-sm leading-relaxed text-muted">
              {result.warnings.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}

          <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-5">
            <MetricCard
              label="Water coverage"
              value={formatPercent(metrics.water_percentage, 1)}
              caption="Share of the image classified as water."
              accent="water"
              bar={metrics.water_percentage}
              testId="metric-water"
              className="col-span-2 lg:col-span-1"
            />
            <MetricCard
              label="Non-water area"
              value={formatPercent(metrics.non_water_percentage, 1)}
              caption="Land and other non-water surfaces."
              bar={metrics.non_water_percentage}
            />
            <MetricCard
              label="Candidate regions"
              value={formatInt(metrics.candidate_regions)}
              caption={`Regions outside the water buffer that pass size and clearance filters (${formatPercent(
                metrics.candidate_area_percentage,
                1,
              )} of the image).`}
            />
            <MetricCard
              label="Probable storage zones"
              value={formatInt(metrics.storage_zones)}
              caption={`Of the ${formatInt(zones.length)} top-ranked ${
                zones.length === 1 ? "region" : "regions"
              }, those with room for a storage circle.`}
              accent={metrics.storage_zones > 0 ? "signal" : undefined}
              testId="metric-storage"
            />
            <MetricCard
              label="Probable drop zones"
              value={formatInt(metrics.drop_zones)}
              caption="Spaced drop points inside the storage zones."
              testId="metric-drops"
            />
          </div>
        </div>
      </section>

      {/* ------------------------------------------ stage viewer (dark) */}
      <section className="pb-12 sm:pb-16 lg:pb-24" aria-label="Analysis stages">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
          <SectionHeading
            eyebrow="Analysis stages"
            title="From water to drop zones"
            description="Each view shows one stage on the same pixel grid. Drop Zones explains how each circle and point was chosen; Final Result is the summary."
          />
          <ImageWorkspace
            images={result.images}
            imageInfo={imageInfo}
            isolatedRegions={isolatedRegions}
            storageZones={storageZones}
            storageAnalysis={storageAnalysis}
            storageParameters={parameters.storage}
            highlight={highlight}
          />
          <div className="mt-4">
            <ScanParameters parameters={parameters} imageInfo={imageInfo} />
          </div>
        </div>
      </section>

      {/* ------------------------------- storage + drop zones (light) */}
      <section className="chapter bg-paper text-paper-ink" aria-label="Probable storage and drop zones">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
          <SectionHeading
            tone="light"
            eyebrow="Primary result"
            title="Probable storage zones"
            description="Each storage zone is the largest circle around a ranked region's highest-clearance point that stays on candidate land. Distances shown in image pixels."
          />

          {storageZones.length === 0 && notViable.length === 0 ? (
            <EmptyState
              tone="light"
              title="No probable storage zone identified"
              description="No region in this image passed the minimum area and clearance filters, so there is no centre to build a storage zone around."
            />
          ) : (
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
              {/* Sticky map: the Final Result with the hovered item ringed. */}
              {finalImage ? (
                <div className="lg:sticky lg:top-20 lg:self-start">
                  <div className="viewer-canvas overflow-hidden rounded-lg">
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={finalImage}
                        alt="Final result: probable storage and drop zones"
                        className="block max-h-[70vh] w-full object-contain"
                        data-testid="zone-map"
                      />
                      <HighlightLayer
                        imageInfo={imageInfo}
                        storageZones={storageZones}
                        highlight={highlight}
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-paper-faint">
                    Hover or focus a card to ring it on the image.
                  </p>
                </div>
              ) : null}

              <div className="min-w-0 space-y-10">
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {storageZones.map((storage) => (
                    <StorageZoneCard
                      key={storage.id}
                      storage={storage}
                      zone={zonesById.get(storage.zone_id)}
                      weights={parameters.score_weights}
                      selected={selected?.id === storage.id}
                      onSelect={() => setSelectedId(storage.id)}
                      onHover={(active) => setHoverStorage(active ? storage.id : null)}
                    />
                  ))}
                  {notViable.map((item) => (
                    <NotViableCard
                      key={item.zone_id}
                      item={item}
                      zone={zonesById.get(item.zone_id)}
                      minRadius={parameters.storage.min_radius_px}
                    />
                  ))}
                </div>

                {selected ? (
                  <div>
                    <p className="eyebrow text-paper-faint">Secondary result</p>
                    <h3 className="display mt-3 text-[26px] sm:text-[30px]">
                      Probable drop zones · Storage zone {rankLabel(selected.id - 1)}
                    </h3>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-paper-muted">
                      Each drop zone is a {parameters.storage.drop_zone_radius_px} px circle of
                      candidate land around a drop point. Its score (0–100) weighs clearance,
                      distance to water and closeness to the storage centre; it is separate from
                      the region score.
                    </p>
                    {selected.candidate_drop_zones.length > 0 ? (
                      <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="drop-list">
                        {selected.candidate_drop_zones.map((drop) => (
                          <DropZoneCard
                            key={drop.id}
                            drop={drop}
                            weights={parameters.storage.drop_score_weights}
                            onHover={(active) => setHoverDrop(active ? drop.id : null)}
                          />
                        ))}
                      </ul>
                    ) : (
                      <div className="mt-6">
                        <EmptyState
                          tone="light"
                          title="No probable drop zones"
                          description={
                            selected.sampled_points === 0
                              ? `This storage zone's radius (${selected.radius_px} px) leaves no room for a drop point at least ${parameters.storage.min_drop_point_distance_px} px from its centre.`
                              : `All ${selected.sampled_points} sampled points were rejected: none had ${parameters.storage.drop_zone_radius_px} px of candidate land around it, or they were too close to the centre or to each other.`
                          }
                        />
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------------ object context (dark) */}
      <section className="chapter" aria-label="Supplementary object context">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
          <SectionHeading
            eyebrow="Supplementary"
            title="AI object context"
            description="A general-purpose object detector (YOLO11n, ONNX Runtime) runs separately from the analysis. It never changes water, storage zones or drop zones."
          />
          <AIStatus mode={result.analysis_mode} ai={result.ai} />
        </div>
      </section>

      {/* ------------------------------------------ limitations (light) */}
      <section className="chapter bg-paper">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
          <Disclaimer notice={result.notice} />
        </div>
      </section>
    </div>
  );
}
