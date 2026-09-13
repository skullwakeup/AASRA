"use client";

import { useMemo, useState } from "react";
import { Layers, Maximize2, ImageOff } from "lucide-react";
import { Panel } from "@/components/Panel";
import { toDataUrl } from "@/lib/format";
import type { AnalysisImageKey, AnalysisImages, ImageInfo } from "@/types/api";

/**
 * The five visualisation keys the backend emits (services/visualization.py).
 * Tabs are built only from keys that are actually present and non-empty in
 * the response — nothing is invented, nothing renders broken.
 *
 * Legend entries below mirror the exact BGR constants the backend draws with,
 * converted to RGB.
 */
interface TabDefinition {
  key: AnalysisImageKey;
  label: string;
  caption: string;
  legend: { color: string; label: string }[];
}

const TABS: TabDefinition[] = [
  {
    key: "original",
    label: "Original",
    caption: "The uploaded image after resizing. No overlays applied.",
    legend: [],
  },
  {
    key: "water_mask",
    label: "Water Analysis",
    caption:
      "Floodwater detected by the multi-cue water stage, filled over a dimmed copy of the scene so the mask can be checked against the imagery.",
    legend: [
      { color: "#145ac8", label: "Detected water" },
      { color: "#ffffff", label: "Mask boundary" },
    ],
  },
  {
    key: "candidate_mask",
    label: "Candidate Areas",
    caption:
      "Non-water land outside the water buffer — the search space for candidate zones.",
    legend: [
      { color: "#ffffff", label: "Candidate area" },
      { color: "#000000", label: "Water, buffer or excluded" },
    ],
  },
  {
    key: "isolated_regions",
    label: "Isolated Regions",
    caption:
      "Land components separated from the main landmass by detected water.",
    legend: [
      { color: "#145ac8", label: "Water tint" },
      { color: "#ff8c00", label: "Potentially isolated land region" },
    ],
  },
  {
    key: "final_analysis",
    label: "Final Result",
    caption:
      "Composite overlay: water, candidate boundaries, ranked zones, candidate drop points and isolated regions.",
    legend: [
      { color: "#145ac8", label: "Water tint" },
      { color: "#969696", label: "Candidate boundary" },
      { color: "#3cdc3c", label: "Ranked zone boundary" },
      { color: "#ffd700", label: "Candidate drop point" },
      { color: "#ff8c00", label: "Potentially isolated region" },
    ],
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

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <Layers className="size-3.5 text-faint" strokeWidth={1.75} />
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            Image Analysis
          </h2>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-faint sm:inline">
            / Analysis Output
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.12em] text-faint">
          <Maximize2 className="size-3" strokeWidth={1.75} />
          {imageInfo.processed_width} &times; {imageInfo.processed_height} px
        </div>
      </div>

      {active === null ? (
        <div className="flex flex-col items-center px-6 py-20 text-center">
          <ImageOff className="size-6 text-faint" strokeWidth={1.5} />
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            No visualisations returned
          </p>
          <p className="mt-2 max-w-sm text-xs text-faint">
            The analysis completed but the service returned no visualisation
            images for this run.
          </p>
        </div>
      ) : (
        <>
          {/* Tabs — horizontally scrollable on narrow screens. */}
          <div
            className="thin-scroll flex overflow-x-auto border-b border-line"
            role="tablist"
            aria-label="Analysis visualisations"
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
                  className={`relative shrink-0 whitespace-nowrap px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors duration-150 sm:px-5 ${
                    isActive
                      ? "text-water"
                      : "text-faint hover:bg-raised/60 hover:text-muted"
                  }`}
                >
                  {tab.label}
                  <span
                    className={`absolute inset-x-0 bottom-0 h-[2px] transition-opacity duration-200 ${
                      isActive ? "bg-water opacity-100" : "opacity-0"
                    }`}
                  />
                </button>
              );
            })}
          </div>

          {/* Viewer — object-contain preserves the source aspect ratio. */}
          <div className="viewer-canvas relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={active.key}
              src={active.src}
              alt={`${active.label} visualisation`}
              className="anim-fade mx-auto block max-h-[62vh] w-full object-contain"
            />
          </div>

          <div className="border-t border-line px-4 py-3.5 sm:px-5">
            <p className="text-xs leading-relaxed text-muted">
              {active.caption}
            </p>
            {active.legend.length > 0 ? (
              <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                {active.legend.map((entry) => (
                  <li
                    key={entry.label}
                    className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-faint"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-[2px] ring-1 ring-inset ring-white/15"
                      style={{ backgroundColor: entry.color }}
                    />
                    {entry.label}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </>
      )}
    </Panel>
  );
}
