"use client";

import { useMemo, useState } from "react";
import { AIStatus } from "@/components/AIStatus";
import { Disclaimer } from "@/components/Disclaimer";
import { EmptyState } from "@/components/States";
import { HighlightLayer, ImageWorkspace, type Highlight } from "@/components/ImageWorkspace";
import { MetricCard } from "@/components/MetricCard";
import { ScanParameters } from "@/components/ScanParameters";
import { SectionHeading } from "@/components/Panel";
import {
  NotViableCard,
  SensorZoneCard,
  SupplySegmentCard,
  SupplySummary,
} from "@/components/DropZones";
import { formatInt, formatPercent, toDataUrl } from "@/lib/format";
import { pillSecondary } from "@/lib/ui";
import type { AnalysisResponse } from "@/types/api";

type MapView = "final_analysis" | "sensor_zones" | "supply_zones";

const SUPPLY_CARDS = 4;

const MAP_VIEWS: { key: MapView; label: string }[] = [
  { key: "final_analysis", label: "Combined" },
  { key: "sensor_zones", label: "Sensor" },
  { key: "supply_zones", label: "Supply" },
];

/**
 * The results view. Every value rendered below is read from `result` — the
 * unmodified response of POST /api/analyze. No metric is derived, defaulted
 * or hardcoded here.
 *
 * Chapters alternate canvases: summary + stage viewer (dark), drop zones
 * (light: combined map, then sensor and supply results separately), object
 * context (dark), limitations (light).
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
    sensor_zones: sensorZones = [],
    sensor_analysis: sensorAnalysis,
    supply_zone: supplyZone,
    isolated_regions: isolatedRegions,
    image_info: imageInfo,
    parameters,
  } = result;

  const [highlight, setHighlight] = useState<Highlight>(null);
  const [mapView, setMapView] = useState<MapView>("final_analysis");
  const zonesById = useMemo(() => new Map(zones.map((zone) => [zone.id, zone])), [zones]);

  const notViable = sensorAnalysis?.not_viable ?? [];
  const segments = supplyZone?.segments ?? [];
  // The four largest pieces carry almost all of the band; the rest are slivers.
  const listedSegments = segments.slice(0, SUPPLY_CARDS);
  const mapImage = toDataUrl(result.images[mapView]) ?? toDataUrl(result.images.final_analysis);
  const hasAnyZone = sensorZones.length > 0 || notViable.length > 0 || segments.length > 0;

  const hoverSensor = (id: number) => (active: boolean) =>
    setHighlight(active ? { kind: "sensor", id } : null);
  const hoverSupply = (id: number) => (active: boolean) =>
    setHighlight(active ? { kind: "supply", id } : null);

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
              label="Smart sensor drop zones"
              value={formatInt(metrics.sensor_zones)}
              caption={`Purple circles. Of the ${formatInt(zones.length)} top-ranked ${
                zones.length === 1 ? "region" : "regions"
              }, those with room for one.`}
              accent={metrics.sensor_zones > 0 ? "sensor" : undefined}
              testId="metric-sensor"
            />
            <MetricCard
              label="Supply drop zone"
              value={formatPercent(metrics.supply_area_percentage, 1)}
              caption={`Green band between the ${formatInt(
                parameters.supply.inner_margin_px,
              )} px and ${formatInt(parameters.supply.outer_margin_px)} px margins around water, in ${formatInt(
                metrics.supply_zone_segments,
              )} ${metrics.supply_zone_segments === 1 ? "segment" : "segments"}.`}
              accent={metrics.supply_zone_segments > 0 ? "supply" : undefined}
              bar={metrics.supply_area_percentage}
              testId="metric-supply"
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
            description="Each view shows one stage on the same pixel grid. Combined shows both drop zones together; Sensor Drop Zones and Supply Drop Zones show each on its own."
          />
          <ImageWorkspace
            images={result.images}
            imageInfo={imageInfo}
            isolatedRegions={isolatedRegions}
            sensorZones={sensorZones}
            sensorAnalysis={sensorAnalysis}
            sensorParameters={parameters.sensor}
            supplyZone={supplyZone}
            highlight={highlight}
          />
          <div className="mt-4">
            <ScanParameters parameters={parameters} imageInfo={imageInfo} />
          </div>
        </div>
      </section>

      {/* ----------------------------- sensor + supply drop zones (light) */}
      <section className="chapter bg-paper text-paper-ink" aria-label="Probable drop zones">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
          <SectionHeading
            tone="light"
            eyebrow="Primary result"
            title="Probable drop zones"
            description="Two separate results, shown together on the map and listed separately beside it. Distances are image pixels."
          />

          {!hasAnyZone ? (
            <EmptyState
              tone="light"
              title="No probable drop zone identified"
              description="No open land passed the filters: no region was large enough for a sensor drop zone, and no open land lies between the margins around the detected water."
            />
          ) : (
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] lg:gap-10">
              {/* Sticky map: combined, sensor-only or supply-only. */}
              {mapImage ? (
                <div className="lg:sticky lg:top-20 lg:self-start">
                  <div className="mb-3 flex gap-2" role="tablist" aria-label="Map view">
                    {MAP_VIEWS.map((view) => (
                      <button
                        key={view.key}
                        type="button"
                        role="tab"
                        aria-selected={mapView === view.key}
                        onClick={() => setMapView(view.key)}
                        data-testid={`map-view-${view.key}`}
                        className={`h-8 rounded-full px-4 text-[13px] font-semibold transition-colors duration-150 ${
                          mapView === view.key
                            ? "bg-paper-ink text-paper"
                            : "border border-paper-line text-paper-muted hover:border-paper-ink/40 hover:text-paper-ink"
                        }`}
                      >
                        {view.label}
                      </button>
                    ))}
                  </div>
                  <div className="viewer-canvas overflow-hidden rounded-lg">
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={mapImage}
                        alt="Probable drop zones on the analysed image"
                        className="block max-h-[70vh] w-full object-contain"
                        data-testid="zone-map"
                      />
                      <HighlightLayer
                        imageInfo={imageInfo}
                        sensorZones={sensorZones}
                        supplySegments={segments}
                        highlight={highlight}
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-paper-muted">
                    <span className="flex items-center gap-2">
                      <span className="size-3 rounded-full border-2 border-sensor bg-sensor/30" />
                      Smart sensor drop zone
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="size-3 rounded-[2px] bg-supply/70" />
                      Supply drop zone
                    </span>
                    <span className="text-paper-faint">Hover a card to outline it on the image.</span>
                  </div>
                </div>
              ) : null}

              <div className="min-w-0 space-y-12">
                {/* ------------------------------- sensor drop zones */}
                <div data-testid="sensor-section">
                  <h3 className="display flex items-center gap-3 text-[26px] sm:text-[30px]">
                    <span aria-hidden="true" className="size-4 rounded-full border-2 border-sensor bg-sensor/30" />
                    Probable Smart Sensor Drop Zones
                  </h3>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-paper-muted">
                    Places to drop flood sensors or cameras. Each is the largest circle around a
                    ranked region&apos;s highest-clearance point that stays on open land, clear of
                    the water buffer and tree canopy.
                  </p>
                  {sensorZones.length === 0 && notViable.length === 0 ? (
                    <div className="mt-6">
                      <EmptyState
                        tone="light"
                        title="No Probable Smart Sensor Drop Zone identified"
                        description="No open land region passed the minimum area and clearance filters."
                      />
                    </div>
                  ) : (
                    <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
                      {sensorZones.map((sensor) => (
                        <SensorZoneCard
                          key={sensor.id}
                          sensor={sensor}
                          zone={zonesById.get(sensor.zone_id)}
                          weights={parameters.score_weights}
                          onHover={hoverSensor(sensor.id)}
                        />
                      ))}
                      {notViable.map((item) => (
                        <NotViableCard
                          key={item.zone_id}
                          item={item}
                          zone={zonesById.get(item.zone_id)}
                          minRadius={parameters.sensor.min_radius_px}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* ------------------------------- supply drop zone */}
                <div data-testid="supply-section">
                  <h3 className="display flex items-center gap-3 text-[26px] sm:text-[30px]">
                    <span aria-hidden="true" className="size-4 rounded-[3px] bg-supply/70" />
                    Probable Supply Drop Zone
                  </h3>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-paper-muted">
                    A band of open land near the water&apos;s edge, so people reaching the shore can
                    collect supplies. It starts at the inner margin and ends at the outer margin.
                  </p>
                  {supplyZone ? (
                    <div className="mt-6 space-y-4">
                      <SupplySummary supply={supplyZone} />
                      {segments.length > 0 ? (
                        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="supply-list">
                          {listedSegments.map((segment) => (
                            <SupplySegmentCard
                              key={segment.id}
                              segment={segment}
                              onHover={hoverSupply(segment.id)}
                            />
                          ))}
                        </ul>
                      ) : (
                        <EmptyState
                          tone="light"
                          title="No Probable Supply Drop Zone identified"
                          description="No open land lies between the inner and outer margins around the detected water (it may all be water, tree canopy, or too fragmented)."
                        />
                      )}
                      {supplyZone.segment_count > listedSegments.length ? (
                        <p className="text-xs text-paper-faint">
                          Showing the {listedSegments.length} largest of{" "}
                          {formatInt(supplyZone.segment_count)} segments. All are shaded on the image.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
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
            description="A general-purpose object detector (YOLO11n, ONNX Runtime) runs separately from the analysis. It never changes water or either drop zone."
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
