"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import { Panel } from "@/components/Panel";
import { toDataUrl } from "@/lib/format";
import type { AnalysisImageKey, AnalysisImages, ImageInfo } from "@/types/api";

/**
 * Tabbed viewer over the backend visualisations (services/visualization.py
 * and services/ai_detection.py). Tabs are built only from keys that are
 * present and non-empty in the response — nothing is invented, nothing
 * renders broken.
 *
 * `images.isolated_regions` is still returned by the backend but deliberately
 * has no tab: isolated regions are not part of this dashboard's conclusions.
 *
 * Legend colours mirror the exact BGR constants the backend draws with,
 * converted to RGB. Each legend lists only what that image actually shows.
 */
interface LegendEntry {
  label: string;
  color: string;
  /** Render as the drop-point target marker instead of a flat swatch. */
  marker?: boolean;
}

interface TabDefinition {
  key: AnalysisImageKey;
  label: string;
  caption: string;
  legend: LegendEntry[];
}

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
      "Water detected by the OpenCV water stage, drawn over a dimmed copy of the image so it can be checked against the scene.",
    legend: [
      { color: "#145ac8", label: "Detected water" },
      { color: "#ffffff", label: "Water boundary" },
    ],
  },
  {
    key: "candidate_mask",
    label: "Candidate Areas",
    caption:
      "Non-water land outside the water buffer. This is the area searched for potential zones.",
    legend: [
      { color: "#ffffff", label: "Candidate area" },
      { color: "#000000", label: "Water, buffer or excluded" },
    ],
  },
  {
    key: "final_analysis",
    label: "Final Result",
    caption:
      "Detected water, the ranked potential zones, and the drop point in each zone — the point farthest from the zone's edge. Zone numbers match the cards below.",
    legend: [
      { color: "#145ac8", label: "Water" },
      { color: "#3cdc3c", label: "Potential zone" },
      { color: "#ffd700", label: "Drop point", marker: true },
    ],
  },
  {
    key: "ai_context",
    label: "AI Context",
    caption:
      "Supplementary object detection (person, car, truck, bus, boat, motorcycle, bicycle). Visible-object context only — not used in water analysis or zone ranking.",
    legend: [],
  },
];

export function ImageWorkspace({
  images,
  imageInfo,
}: {
  images: AnalysisImages;
  imageInfo: ImageInfo;
}) {
  // Keep only tabs whose base64 payload actually arrived.
  const available = useMemo(
    () =>
      TABS.map((tab) => ({ ...tab, src: toDataUrl(images?.[tab.key]) })).filter(
        (tab): tab is TabDefinition & { src: string } => tab.src !== null,
      ),
    [images],
  );

  // Open on the composite result — it is the headline output.
  const defaultKey =
    available.find((tab) => tab.key === "final_analysis")?.key ??
    available[0]?.key;

  const [activeKey, setActiveKey] = useState<AnalysisImageKey | undefined>(
    defaultKey,
  );

  const active =
    available.find((tab) => tab.key === activeKey) ?? available[0] ?? null;
  const activeTabKey = active?.key;

  // Keep the selected tab visible when the tab row overflows (e.g. phones).
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
      list.scrollLeft = offsetLeft - 8;
    }
  }, [activeTabKey]);

  if (active === null) {
    return (
      <Panel className="flex flex-col items-center px-6 py-16 text-center">
        <ImageOff className="size-5 text-faint" strokeWidth={1.5} />
        <p className="mt-3 text-sm font-medium text-ink">
          No visualizations returned
        </p>
        <p className="mt-1 max-w-sm text-sm text-muted">
          The analysis completed, but no visualization images were returned for
          this run.
        </p>
      </Panel>
    );
  }

  return (
    <Panel className="overflow-hidden">
      {/* Tabs — horizontally scrollable on narrow screens. */}
      <div
        ref={tablistRef}
        className="thin-scroll relative flex overflow-x-auto border-b border-line px-2"
        role="tablist"
        aria-label="Analysis visualizations"
      >
        {available.map((tab) => {
          const isActive = tab.key === active.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveKey(tab.key)}
              className={`relative shrink-0 whitespace-nowrap px-3 py-3 text-sm transition-colors duration-150 ${
                isActive ? "text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {tab.label}
              <span
                aria-hidden="true"
                className={`absolute inset-x-3 bottom-0 h-0.5 rounded-full ${
                  isActive ? "bg-water" : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>

      {/* Viewer — object-contain preserves the source aspect ratio. */}
      <div className="viewer-canvas">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={active.key}
          src={active.src}
          alt={`${active.label} visualization`}
          className="anim-fade mx-auto block max-h-[68vh] w-full object-contain"
        />
      </div>

      <div className="space-y-3 border-t border-line px-4 py-4 sm:px-5">
        <p className="text-sm leading-relaxed text-muted">{active.caption}</p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {active.legend.map((entry) => (
            <span
              key={entry.label}
              className="flex items-center gap-2 text-xs text-muted"
            >
              {entry.marker ? (
                <span
                  aria-hidden="true"
                  className="grid size-3.5 place-items-center rounded-full border-2 border-white/90"
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  />
                </span>
              ) : (
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-[2px] ring-1 ring-inset ring-white/20"
                  style={{ backgroundColor: entry.color }}
                />
              )}
              {entry.label}
            </span>
          ))}
          <span className="ml-auto text-xs text-faint tabular-nums">
            {imageInfo.processed_width} &times; {imageInfo.processed_height} px
          </span>
        </div>
      </div>
    </Panel>
  );
}
