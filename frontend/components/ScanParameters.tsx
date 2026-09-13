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
  const weights = parameters.score_weights;
  const rows: { label: string; value: string }[] = [
    {
      label: "Source image",
      value: `${imageInfo.original_width} × ${imageInfo.original_height} px`,
    },
    {
      label: "Processed image",
      value: `${imageInfo.processed_width} × ${imageInfo.processed_height} px`,
    },
    { label: "Scale", value: `${imageInfo.scale}×` },
    { label: "Water buffer", value: `${formatInt(parameters.water_buffer_px)} px` },
    {
      label: "Minimum region area",
      value: `${formatInt(parameters.min_region_area_px)} px`,
    },
  ];

  return (
    <Panel>
      <PanelHeader title="Analysis details" />
      <dl className="divide-y divide-line text-sm">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-4 px-4 py-2.5 sm:px-5"
          >
            <dt className="text-muted">{row.label}</dt>
            <dd className="text-right font-mono text-[13px] text-ink tabular-nums">
              {row.value}
            </dd>
          </div>
        ))}
        <div className="px-4 py-2.5 sm:px-5">
          <dt className="text-muted">Score weights</dt>
          <dd className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
            <span>
              Area{" "}
              <span className="font-mono text-ink tabular-nums">{weights.area}</span>
            </span>
            <span>
              Water clearance{" "}
              <span className="font-mono text-ink tabular-nums">
                {weights.water_clearance}
              </span>
            </span>
            <span>
              Openness{" "}
              <span className="font-mono text-ink tabular-nums">
                {weights.openness}
              </span>
            </span>
          </dd>
        </div>
      </dl>
      <p className="border-t border-line px-4 py-3 text-xs leading-relaxed text-faint sm:px-5">
        Distances and areas are in processed-image pixels, not metres.
      </p>
    </Panel>
  );
}
