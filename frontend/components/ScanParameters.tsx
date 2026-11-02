import { formatInt, formatPx } from "@/lib/format";
import type { AnalysisParameters, ImageInfo } from "@/types/api";

/**
 * The configuration the backend actually used for this run, straight from
 * `parameters` and `image_info` — evidence that the numbers on screen are
 * the service's own.
 */
export function ScanParameters({
  parameters,
  imageInfo,
}: {
  parameters: AnalysisParameters;
  imageInfo: ImageInfo;
}) {
  const s = parameters.sensor;
  const sup = parameters.supply;
  const rows: [string, string][] = [
    ["Source image", `${imageInfo.original_width} × ${imageInfo.original_height} px`],
    ["Processed image", `${imageInfo.processed_width} × ${imageInfo.processed_height} px`],
    ["Scale", `${imageInfo.scale}×`],
    ["Water buffer", formatPx(parameters.water_buffer_px)],
    ["Minimum region area", `${formatInt(parameters.min_region_area_px)} px`],
    ["Sensor zone radius", `${formatPx(s.min_radius_px)} – ${formatPx(s.max_radius_px)}`],
    ["Sensor radius margin", formatPx(s.radius_margin_px)],
    ["Supply inner margin", formatPx(sup.inner_margin_px)],
    ["Supply outer margin", formatPx(sup.outer_margin_px)],
    ["Minimum supply segment", `${formatInt(sup.min_segment_area_px)} px`],
    ["Tree canopy excluded", parameters.canopy_excluded ? "Yes" : "No"],
    ["Scene water colour model", parameters.scene_colour_model ? "Applied" : "Not applied"],
  ];

  return (
    <details className="group rounded-lg border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm text-ink">
        Analysis parameters
        <span className="text-xs text-faint group-open:hidden">Show</span>
        <span className="hidden text-xs text-faint group-open:inline">Hide</span>
      </summary>
      <dl className="grid grid-cols-1 border-t border-line sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-4 border-b border-line px-5 py-2.5 text-sm"
          >
            <dt className="text-muted">{label}</dt>
            <dd className="text-right font-mono text-[13px] tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="px-5 py-3 text-xs leading-relaxed text-faint">
        Distances and areas are pixels of the processed image, not metres.
      </p>
    </details>
  );
}
