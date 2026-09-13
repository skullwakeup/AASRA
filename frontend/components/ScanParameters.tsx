import { SlidersHorizontal } from "lucide-react";
import { Panel, PanelHeader } from "@/components/Panel";
import { formatInt } from "@/lib/format";
import type { AnalysisParameters, ImageInfo } from "@/types/api";

/**
 * The configuration the backend actually used for this run, straight from
 * `parameters` and `image_info`. Useful context and, more importantly,
 * evidence that the numbers on screen are the service's own.
 */
export function ScanParameters({
  parameters,
  imageInfo,
}: {
  parameters: AnalysisParameters;
  imageInfo: ImageInfo;
}) {
  const rows: { label: string; value: string }[] = [
    {
      label: "Source",
      value: `${imageInfo.original_width} × ${imageInfo.original_height} px`,
    },
    {
      label: "Processed",
      value: `${imageInfo.processed_width} × ${imageInfo.processed_height} px`,
    },
    { label: "Scale", value: `${imageInfo.scale}×` },
    { label: "Water Buffer", value: `${formatInt(parameters.water_buffer_px)} px` },
    {
      label: "Min Region Area",
      value: `${formatInt(parameters.min_region_area_px)} px`,
    },
    {
      label: "Min Isolated Area",
      value: `${formatInt(parameters.min_isolated_area_px)} px`,
    },
    {
      label: "Score Weights",
      value: `A ${parameters.score_weights.area} · W ${parameters.score_weights.water_clearance} · O ${parameters.score_weights.openness}`,
    },
  ];

  return (
    <Panel>
      <PanelHeader
        title="Analysis Parameters"
        icon={<SlidersHorizontal className="size-3.5" />}
      />
      <dl className="divide-y divide-line">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-4 px-4 py-2.5 sm:px-5"
          >
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              {row.label}
            </dt>
            <dd className="text-right font-mono text-[11px] text-muted tabular-nums">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-line px-4 py-3 text-[10px] leading-relaxed text-faint sm:px-5">
        All measurements are pixels of the processed image. Never metres.
      </p>
    </Panel>
  );
}
