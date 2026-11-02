"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import { Panel } from "@/components/Panel";
import { toneFor } from "@/lib/classification";
import { formatInt, formatPx, formatScore, toDataUrl } from "@/lib/format";
import type {
  AnalysisImageKey,
  AnalysisImages,
  ImageInfo,
  IsolatedRegion,
  SensorAnalysis,
  SensorParameters,
  SensorZone,
  SupplySegment,
  SupplyZone,
} from "@/types/api";

/**
 * Tabbed viewer over the backend visualisations (services/visualization.py
 * and services/ai_detection.py). Tabs are built only from keys that are
 * present and non-empty in the response — nothing is invented.
 *
 * Every image shares the processed image's pixel grid. The optional SVG
 * highlight layer uses that same grid (viewBox = processed size, letterboxed
 * exactly like the image's object-contain), so a highlighted ring sits on
 * the pixel the backend reported.
 *
 * Legend colours are the exact BGR constants the backend draws with,
 * converted to RGB. Each legend lists only what that image shows.
 */
interface LegendEntry {
  label: string;
  color: string;
  shape?: "swatch" | "disc" | "line" | "dashed" | "outline";
}

interface TabDefinition {
  key: AnalysisImageKey;
  label: string;
  caption: string;
  legend: LegendEntry[];
}

const WATER = "#145ac8";
const SENSOR = "#a855f7";
const SUPPLY = "#22c55e";
const MARGIN = "#aaff96";
const CANOPY = "#3c3c3c";

const SENSOR_LEGEND: LegendEntry = { color: SENSOR, label: "Probable Smart Sensor Drop Zone", shape: "disc" };
const SUPPLY_LEGEND: LegendEntry[] = [
  { color: SUPPLY, label: "Probable Supply Drop Zone" },
  { color: MARGIN, label: "Inner margin", shape: "line" },
  { color: MARGIN, label: "Outer margin", shape: "dashed" },
];

const TABS: TabDefinition[] = [
  {
    key: "final_analysis",
    label: "Combined",
    caption:
      "Both results together: the green Probable Supply Drop Zone along the shoreline, between the inner margin (solid) and outer margin (dashed), and the purple Probable Smart Sensor Drop Zones. Numbers match the cards below.",
    legend: [{ color: WATER, label: "Water" }, ...SUPPLY_LEGEND, SENSOR_LEGEND],
  },
  {
    key: "sensor_zones",
    label: "Sensor Drop Zones",
    caption:
      "Probable Smart Sensor Drop Zones only. Each purple circle is the largest circle of candidate land around a ranked region's highest-clearance point; grey outlines are the candidate regions.",
    legend: [
      { color: WATER, label: "Water" },
      { color: "#aaaaaa", label: "Candidate region", shape: "outline" },
      SENSOR_LEGEND,
    ],
  },
  {
    key: "supply_zones",
    label: "Supply Drop Zones",
    caption:
      "Probable Supply Drop Zone only: open land between an inner margin and an outer margin drawn around the detected water, so supplies land near the water's edge. Tree canopy between the margins is greyed and left out.",
    legend: [
      { color: WATER, label: "Water" },
      ...SUPPLY_LEGEND,
      { color: CANOPY, label: "Tree canopy (excluded)" },
    ],
  },
  {
    key: "original",
    label: "Original",
    caption: "The uploaded image, resized for analysis. No overlays.",
    legend: [],
  },
  {
    key: "water_mask",
    label: "Water Analysis",
    caption:
      "Detected water over a dimmed copy of the image, so the mask can be checked against the scene.",
    legend: [
      { color: WATER, label: "Detected water" },
      { color: "#ffffff", label: "Water boundary", shape: "outline" },
    ],
  },
  {
    key: "candidate_mask",
    label: "Candidate Areas",
    caption:
      "Open land (not water, not tree canopy) outside the water buffer. Only white pixels can hold a sensor drop zone.",
    legend: [
      { color: "#ffffff", label: "Candidate land" },
      { color: "#000000", label: "Water, buffer or canopy" },
    ],
  },
  {
    key: "isolated_regions",
    label: "Land Isolation",
    caption:
      "Land cut off from the largest landmass by detected water, scored 0–100 on how cut off its geometry is. Geometry only: no people are detected. Does not affect zone ranking.",
    legend: [
      { color: WATER, label: "Detected water" },
      { color: "#ff8c00", label: "Potentially isolated land", shape: "outline" },
    ],
  },
  {
    key: "ai_context",
    label: "AI Context",
    caption:
      "Supplementary object detection (person, car, truck, bus, boat, motorcycle, bicycle). Visible-object context only — not used for water, zones or scores.",
    legend: [],
  },
];

const OVERLAY_TABS: AnalysisImageKey[] = ["final_analysis", "sensor_zones", "supply_zones"];

const LIMIT_TEXT: Record<SensorZone["limiting_factor"], string> = {
  water_buffer: "the water buffer",
  candidate_boundary: "the edge of its candidate region (or tree canopy)",
  image_boundary: "the image edge",
  max_radius: "the maximum radius",
};

const NOT_VIABLE_TEXT: Record<SensorAnalysis["not_viable"][number]["reason"], string> = {
  radius_below_minimum: "radius below the minimum",
  center_in_excluded_area: "centre inside an excluded area",
  duplicate_center: "duplicate centre",
};

/** Which card is hovered: a sensor zone (by id) or a supply segment (by id). */
export type Highlight =
  | { kind: "sensor"; id: number }
  | { kind: "supply"; id: number }
  | null;

function LegendMark({ entry }: { entry: LegendEntry }) {
  switch (entry.shape) {
    case "disc":
      return (
        <span
          className="size-3 rounded-full border-2"
          style={{ borderColor: entry.color, backgroundColor: `${entry.color}55` }}
        />
      );
    case "line":
      return <span className="h-0.5 w-4" style={{ backgroundColor: entry.color }} />;
    case "dashed":
      return (
        <span
          className="h-0.5 w-4"
          style={{
            backgroundImage: `repeating-linear-gradient(90deg, ${entry.color} 0 3px, transparent 3px 6px)`,
          }}
        />
      );
    case "outline":
      return (
        <span className="size-3 rounded-[2px] border-2" style={{ borderColor: entry.color }} />
      );
    default:
      return (
        <span
          className="size-3 rounded-[2px] ring-1 ring-inset ring-white/25"
          style={{ backgroundColor: entry.color }}
        />
      );
  }
}

/** Plain-language account of one sensor zone, from its own numbers. */
function SensorExplanation({
  zone,
  parameters,
}: {
  zone: SensorZone;
  parameters: SensorParameters;
}) {
  return (
    <li className="rounded-lg border border-line bg-raised p-4" data-testid={`explain-sensor-${zone.id}`}>
      <p className="text-sm font-medium text-ink">Sensor Drop Zone {zone.id}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        Centre ({zone.center.x}, {zone.center.y}), {formatPx(zone.water_clearance_px, 1)} from
        water. The circle is limited by {LIMIT_TEXT[zone.limiting_factor]}
        {zone.limiting_factor === "max_radius"
          ? ` (${formatPx(parameters.max_radius_px)}).`
          : `, ${formatPx(zone.limiting_distance_px, 1)} from the centre; after a ${formatPx(
              parameters.radius_margin_px,
            )} margin the radius is ${formatPx(zone.radius_px)}.`}
      </p>
    </li>
  );
}

function IsolationSummary({ regions }: { regions: IsolatedRegion[] }) {
  const preview = regions.slice(0, 3);
  return (
    <div className="border-t border-line px-4 py-4 sm:px-5">
      <p className="text-sm text-ink">
        {formatInt(regions.length)} {regions.length === 1 ? "region" : "regions"} detected
      </p>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {preview.map((region) => {
          const tone = toneFor(region.classification);
          return (
            <li key={region.id} className="rounded-lg border border-line bg-raised px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-xs text-faint tabular-nums">#{region.id}</span>
                <span className={`font-mono text-lg leading-none tabular-nums ${tone.text}`}>
                  {formatScore(region.isolation_score)}
                </span>
              </div>
              <p className={`mt-1.5 text-[11px] font-medium uppercase tracking-[0.06em] ${tone.text}`}>
                {region.classification}
              </p>
              <p className="mt-1 text-[11px] text-muted tabular-nums">
                {formatInt(region.pixel_area)} px ·{" "}
                {Math.round(region.score_breakdown.water_contact_ratio * 100)}% water edge
              </p>
            </li>
          );
        })}
      </ul>
      {regions.length > preview.length ? (
        <p className="mt-2 text-xs text-faint">
          Showing the {preview.length} most isolated of {formatInt(regions.length)}. Every
          region is labelled in the image.
        </p>
      ) : null}
    </div>
  );
}

/** Highlight ring / box drawn in processed-image pixel space. */
export function HighlightLayer({
  imageInfo,
  sensorZones,
  supplySegments,
  highlight,
}: {
  imageInfo: ImageInfo;
  sensorZones: SensorZone[];
  supplySegments: SupplySegment[];
  highlight: Highlight;
}) {
  if (!highlight) return null;
  const sensor = highlight.kind === "sensor" ? sensorZones.find((z) => z.id === highlight.id) : undefined;
  const segment =
    highlight.kind === "supply" ? supplySegments.find((s) => s.id === highlight.id) : undefined;
  if (!sensor && !segment) return null;
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      viewBox={`0 0 ${imageInfo.processed_width} ${imageInfo.processed_height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      data-testid="highlight-layer"
    >
      {sensor ? (
        // A pixel (x, y) covers [x, x+1); its centre is at x + 0.5.
        <circle
          data-testid="highlight-sensor"
          cx={sensor.center.x + 0.5}
          cy={sensor.center.y + 0.5}
          r={sensor.radius_px + 5}
          fill="none"
          stroke="#ffffff"
          strokeWidth={3}
          strokeDasharray="10 8"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {segment ? (
        <rect
          data-testid="highlight-supply"
          x={segment.bounding_box.x - 3}
          y={segment.bounding_box.y - 3}
          width={segment.bounding_box.width + 6}
          height={segment.bounding_box.height + 6}
          rx={4}
          fill="none"
          stroke="#ffffff"
          strokeWidth={3}
          strokeDasharray="10 8"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}

export function ImageWorkspace({
  images,
  imageInfo,
  isolatedRegions = [],
  sensorZones = [],
  sensorAnalysis,
  sensorParameters,
  supplyZone,
  highlight,
}: {
  images: AnalysisImages;
  imageInfo: ImageInfo;
  isolatedRegions?: IsolatedRegion[];
  sensorZones?: SensorZone[];
  sensorAnalysis?: SensorAnalysis;
  sensorParameters?: SensorParameters;
  supplyZone?: SupplyZone;
  highlight: Highlight;
}) {
  const available = useMemo(
    () =>
      TABS.map((tab) => ({ ...tab, src: toDataUrl(images?.[tab.key]) })).filter(
        (tab): tab is TabDefinition & { src: string } => tab.src !== null,
      ),
    [images],
  );

  const defaultKey =
    available.find((tab) => tab.key === "final_analysis")?.key ?? available[0]?.key;
  const [activeKey, setActiveKey] = useState<AnalysisImageKey | undefined>(defaultKey);

  const active = available.find((tab) => tab.key === activeKey) ?? available[0] ?? null;
  const activeTabKey = active?.key;

  // Keep the selected tab visible when the tab row overflows (phones).
  const tablistRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = tablistRef.current;
    const selected = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !selected) return;
    const { offsetLeft, offsetWidth } = selected;
    if (
      offsetLeft < list.scrollLeft ||
      offsetLeft + offsetWidth > list.scrollLeft + list.clientWidth
    ) {
      list.scrollLeft = offsetLeft - 16;
    }
  }, [activeTabKey]);

  if (active === null) {
    return (
      <Panel className="flex flex-col items-center px-6 py-16 text-center">
        <ImageOff className="size-5 text-faint" strokeWidth={1.5} />
        <p className="mt-3 text-sm text-ink">No visualizations returned</p>
        <p className="mt-1 max-w-sm text-sm text-muted">
          The analysis completed, but no visualization images were returned for this run.
        </p>
      </Panel>
    );
  }

  const showOverlay = OVERLAY_TABS.includes(active.key);
  const notViable = sensorAnalysis?.not_viable ?? [];

  return (
    <div>
      <div
        ref={tablistRef}
        className="thin-scroll -mx-4 flex gap-2 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0"
        role="tablist"
        aria-label="Analysis stages"
      >
        {available.map((tab) => {
          const isActive = tab.key === active.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`tab-${tab.key}`}
              aria-selected={isActive}
              aria-controls="stage-panel"
              onClick={() => setActiveKey(tab.key)}
              className={`h-9 shrink-0 whitespace-nowrap rounded-full px-4 text-[13px] font-semibold transition-colors duration-150 ${
                isActive
                  ? "bg-ink text-canvas"
                  : "border border-line-strong text-muted hover:border-ink/50 hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <Panel className="overflow-hidden" id="stage-panel" role="tabpanel" aria-labelledby={`tab-${active.key}`}>
        <div className="viewer-canvas">
          <div className="relative mx-auto w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={active.key}
              src={active.src}
              alt={`${active.label} visualization`}
              className="anim-fade mx-auto block max-h-[72vh] w-full object-contain"
              data-testid="stage-image"
            />
            {showOverlay ? (
              <HighlightLayer
                imageInfo={imageInfo}
                sensorZones={sensorZones}
                supplySegments={supplyZone?.segments ?? []}
                highlight={highlight}
              />
            ) : null}
          </div>
        </div>

        <div className="space-y-3 border-t border-line px-4 py-4 sm:px-5">
          <p className="max-w-4xl text-sm leading-relaxed text-muted">{active.caption}</p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {active.legend.map((entry) => (
              <span key={entry.label} className="flex items-center gap-2 text-xs text-muted">
                <LegendMark entry={entry} />
                {entry.label}
              </span>
            ))}
            <span className="ml-auto text-xs text-faint tabular-nums">
              {imageInfo.processed_width} × {imageInfo.processed_height} px · distances in image pixels
            </span>
          </div>
        </div>

        {active.key === "sensor_zones" && sensorParameters ? (
          <div className="border-t border-line px-4 py-4 sm:px-5">
            <p className="eyebrow text-faint">Why these circles</p>
            {sensorZones.length > 0 ? (
              <ul className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {sensorZones.map((zone) => (
                  <SensorExplanation key={zone.id} zone={zone} parameters={sensorParameters} />
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">
                No ranked region had room for a circle of at least{" "}
                {formatPx(sensorParameters.min_radius_px)}.
              </p>
            )}
            {notViable.length > 0 ? (
              <p className="mt-3 text-sm text-muted">
                Not viable:{" "}
                {notViable
                  .map(
                    (item) =>
                      `Zone ${item.zone_id} (${NOT_VIABLE_TEXT[item.reason]}${
                        item.reason === "radius_below_minimum" ? `, ${formatPx(item.radius_px)}` : ""
                      })`,
                  )
                  .join(" · ")}
              </p>
            ) : null}
          </div>
        ) : null}

        {active.key === "supply_zones" && supplyZone ? (
          <div className="border-t border-line px-4 py-4 sm:px-5">
            <p className="eyebrow text-faint">How the band is drawn</p>
            <p className="mt-2 max-w-4xl text-sm leading-relaxed text-muted">
              Every land pixel is measured to the nearest detected water. The inner margin sits{" "}
              {formatPx(supplyZone.inner_margin_px)} from the water&apos;s edge and the outer margin{" "}
              {formatPx(supplyZone.outer_margin_px)}; open land between them is the band (
              {formatInt(supplyZone.pixel_area)} px in {formatInt(supplyZone.segment_count)}{" "}
              {supplyZone.segment_count === 1 ? "segment" : "segments"}).{" "}
              {supplyZone.canopy_excluded_px > 0
                ? `${formatInt(supplyZone.canopy_excluded_px)} px of tree canopy between the margins was left out.`
                : ""}
            </p>
          </div>
        ) : null}

        {active.key === "isolated_regions" && isolatedRegions.length > 0 ? (
          <IsolationSummary regions={isolatedRegions} />
        ) : null}
      </Panel>
    </div>
  );
}
