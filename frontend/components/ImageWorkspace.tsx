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
  RejectionReason,
  StorageAnalysis,
  StorageParameters,
  StorageZone,
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
  shape?: "swatch" | "ring" | "centre" | "cross" | "outline";
}

interface TabDefinition {
  key: AnalysisImageKey;
  label: string;
  caption: string;
  legend: LegendEntry[];
}

const WATER = "#145ac8";
const STORAGE = "#34d378";
const DROP = "#f0f0f0";
const REJECTED = "#e15050";

const TABS: TabDefinition[] = [
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
      "Land outside the water buffer. Only white pixels can hold a storage zone or drop zone.",
    legend: [
      { color: "#ffffff", label: "Candidate land" },
      { color: "#000000", label: "Water, buffer or excluded" },
    ],
  },
  {
    key: "drop_zones",
    label: "Drop Zones",
    caption:
      "How each storage zone was derived. The dashed line is the radius, ending where the circle meets the nearest excluded pixel (red dot). Dotted rings are where drop points were sampled; red crosses are rejected samples.",
    legend: [
      { color: WATER, label: "Water" },
      { color: "#466e96", label: "Water buffer" },
      { color: STORAGE, label: "Probable storage zone", shape: "ring" },
      { color: STORAGE, label: "Storage centre", shape: "centre" },
      { color: DROP, label: "Probable drop zone", shape: "ring" },
      { color: REJECTED, label: "Rejected sample", shape: "cross" },
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
    key: "final_analysis",
    label: "Final Result",
    caption:
      "Detected water, each probable storage zone (green circle and centre) and its probable drop zones (small rings). Numbers match the cards below.",
    legend: [
      { color: WATER, label: "Water" },
      { color: "#aaaaaa", label: "Candidate region", shape: "outline" },
      { color: STORAGE, label: "Probable storage zone", shape: "ring" },
      { color: STORAGE, label: "Storage centre", shape: "centre" },
      { color: DROP, label: "Probable drop zone", shape: "ring" },
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

const OVERLAY_TABS: AnalysisImageKey[] = ["final_analysis", "drop_zones"];

const LIMIT_TEXT: Record<StorageZone["limiting_factor"], string> = {
  water_buffer: "the water buffer",
  candidate_boundary: "the edge of its candidate region",
  image_boundary: "the image edge",
  max_radius: "the maximum storage radius",
};

const REASON_TEXT: Record<RejectionReason, string> = {
  insufficient_clearance: "too close to an excluded pixel",
  water: "on water",
  water_buffer: "in the water buffer",
  outside_candidate_region: "outside the candidate region",
  outside_storage_zone: "outside the storage circle",
  outside_image: "outside the image",
};

const NOT_VIABLE_TEXT: Record<StorageAnalysis["not_viable"][number]["reason"], string> = {
  radius_below_minimum: "radius below the minimum",
  center_in_excluded_area: "centre inside an excluded area",
  duplicate_center: "duplicate centre",
};

export interface Highlight {
  storageId: number | null;
  dropId: number | null;
}

function LegendMark({ entry }: { entry: LegendEntry }) {
  switch (entry.shape) {
    case "ring":
      return (
        <span
          className="size-3 rounded-full border-2"
          style={{ borderColor: entry.color }}
        />
      );
    case "centre":
      return (
        <span className="grid size-3.5 place-items-center rounded-full border-2 border-white bg-black">
          <span className="size-1.5 rounded-full" style={{ backgroundColor: entry.color }} />
        </span>
      );
    case "cross":
      return (
        <span className="relative size-3" style={{ color: entry.color }}>
          <span className="absolute left-1/2 top-0 h-3 w-px -translate-x-1/2 rotate-45 bg-current" />
          <span className="absolute left-1/2 top-0 h-3 w-px -translate-x-1/2 -rotate-45 bg-current" />
        </span>
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

/** Plain-language account of one storage zone, from its own numbers. */
function StorageExplanation({
  zone,
  parameters,
}: {
  zone: StorageZone;
  parameters: StorageParameters;
}) {
  const rejected = new Map<RejectionReason, number>();
  for (const point of zone.rejected_points) {
    rejected.set(point.reason, (rejected.get(point.reason) ?? 0) + 1);
  }
  const rejectedText = [...rejected.entries()]
    .map(([reason, count]) => `${count} ${REASON_TEXT[reason]}`)
    .join(", ");
  const kept = zone.candidate_drop_zones.length;

  return (
    <li className="rounded-lg border border-line bg-raised p-4" data-testid={`explain-storage-${zone.id}`}>
      <p className="text-sm font-medium text-ink">Storage Zone {zone.id}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        Centre ({zone.center.x}, {zone.center.y}). The circle is limited by{" "}
        {LIMIT_TEXT[zone.limiting_factor]}
        {zone.limiting_factor === "max_radius"
          ? ""
          : `, ${formatPx(zone.limiting_distance_px, 1)} from the centre`}
        {zone.limiting_factor === "max_radius"
          ? ` (${formatPx(parameters.max_radius_px)}).`
          : `; after a ${formatPx(parameters.radius_margin_px)} margin the radius is ${formatPx(zone.radius_px)}.`}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        {zone.sampled_points > 0 ? (
          <>
            {formatInt(zone.sampled_points)} points sampled on{" "}
            {zone.sampling_ring_radii_px.length}{" "}
            {zone.sampling_ring_radii_px.length === 1 ? "ring" : "rings"}
            {rejectedText ? `; rejected: ${rejectedText}` : "; none rejected"}. {kept}{" "}
            kept, each at least {formatPx(parameters.min_drop_point_distance_px)} from the
            centre and from each other (maximum {parameters.max_drop_points_per_storage_zone}).
          </>
        ) : (
          <>
            The radius is too small for a sampling ring (rings are{" "}
            {formatPx(parameters.min_drop_point_distance_px)} apart), so no drop zones were
            generated.
          </>
        )}
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

/** Highlight ring(s) drawn in processed-image pixel space. */
export function HighlightLayer({
  imageInfo,
  storageZones,
  highlight,
}: {
  imageInfo: ImageInfo;
  storageZones: StorageZone[];
  highlight: Highlight;
}) {
  const zone = storageZones.find((z) => z.id === highlight.storageId);
  if (!zone) return null;
  const drop = zone.candidate_drop_zones.find((d) => d.id === highlight.dropId);
  // A pixel (x, y) covers [x, x+1); its centre is at x + 0.5.
  const cx = zone.center.x + 0.5;
  const cy = zone.center.y + 0.5;
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      viewBox={`0 0 ${imageInfo.processed_width} ${imageInfo.processed_height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      data-testid="highlight-layer"
    >
      {drop ? (
        <circle
          data-testid="highlight-drop"
          cx={drop.point.x + 0.5}
          cy={drop.point.y + 0.5}
          r={drop.radius_px + 6}
          fill="none"
          stroke="#3a8ee6"
          strokeWidth={4}
          vectorEffect="non-scaling-stroke"
        />
      ) : (
        <circle
          data-testid="highlight-storage"
          cx={cx}
          cy={cy}
          r={zone.radius_px + 5}
          fill="none"
          stroke="#3a8ee6"
          strokeWidth={3}
          strokeDasharray="10 8"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

export function ImageWorkspace({
  images,
  imageInfo,
  isolatedRegions = [],
  storageZones = [],
  storageAnalysis,
  storageParameters,
  highlight,
}: {
  images: AnalysisImages;
  imageInfo: ImageInfo;
  isolatedRegions?: IsolatedRegion[];
  storageZones?: StorageZone[];
  storageAnalysis?: StorageAnalysis;
  storageParameters?: StorageParameters;
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
  const notViable = storageAnalysis?.not_viable ?? [];

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
                storageZones={storageZones}
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

        {active.key === "drop_zones" && storageParameters ? (
          <div className="border-t border-line px-4 py-4 sm:px-5">
            <p className="eyebrow text-faint">Why these points</p>
            {storageZones.length > 0 ? (
              <ul className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {storageZones.map((zone) => (
                  <StorageExplanation key={zone.id} zone={zone} parameters={storageParameters} />
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">
                No ranked zone had room for a storage circle of at least{" "}
                {formatPx(storageParameters.min_radius_px)}.
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

        {active.key === "isolated_regions" && isolatedRegions.length > 0 ? (
          <IsolationSummary regions={isolatedRegions} />
        ) : null}
      </Panel>
    </div>
  );
}
