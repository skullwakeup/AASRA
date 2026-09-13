import { Panel } from "@/components/Panel";
import type { AIContext, AnalysisMode } from "@/types/api";

/** Report order matches the backend's `counts` object (ai_detection.py). */
const COUNT_LABELS: {
  key: keyof NonNullable<AIContext["counts"]>;
  singular: string;
  plural: string;
}[] = [
  { key: "person", singular: "Person", plural: "Persons" },
  { key: "car", singular: "Car", plural: "Cars" },
  { key: "truck", singular: "Truck", plural: "Trucks" },
  { key: "bus", singular: "Bus", plural: "Buses" },
  { key: "boat", singular: "Boat", plural: "Boats" },
  { key: "motorcycle", singular: "Motorcycle", plural: "Motorcycles" },
  { key: "bicycle", singular: "Bicycle", plural: "Bicycles" },
];

/**
 * Supplementary YOLO object-detection summary, read from `analysis_mode.ai`
 * and the `ai` section of the backend response.
 *
 * `mode.ai` is true only when the model actually loaded AND inference
 * actually succeeded for this request — never a hardcoded value. AI success
 * and "found something" are different things: `detections` can be empty
 * while the status is still active, and this panel never conflates them.
 *
 * Styled deliberately quieter than the OpenCV results above it.
 */
export function AIStatus({ mode, ai }: { mode: AnalysisMode; ai?: AIContext }) {
  const active = mode.ai;
  const detected = active
    ? COUNT_LABELS.filter(({ key }) => (ai?.counts?.[key] ?? 0) > 0)
    : [];

  return (
    <Panel className="p-4 sm:p-5">
      <div className="grid gap-5 md:grid-cols-[180px_minmax(0,1fr)] md:gap-8">
        <dl className="flex gap-8 text-sm md:flex-col md:gap-3">
          <div>
            <dt className="text-xs text-faint">Status</dt>
            <dd className="mt-1 flex items-center gap-2 text-ink">
              <span
                aria-hidden="true"
                className={`size-1.5 rounded-full ${
                  active ? "bg-ink" : "border border-faint"
                }`}
              />
              {active ? "Active" : "Unavailable"}
            </dd>
          </div>
          {active && ai?.model ? (
            <div>
              <dt className="text-xs text-faint">Model</dt>
              <dd className="mt-1 font-mono text-ink">{ai.model}</dd>
            </div>
          ) : null}
        </dl>

        <div className="min-w-0">
          {active ? (
            <>
              <p className="text-xs text-faint">Detected in this image</p>
              {detected.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-x-8 gap-y-3">
                  {detected.map(({ key, singular, plural }) => {
                    const count = ai?.counts?.[key] ?? 0;
                    return (
                      <li key={key}>
                        <span className="block font-mono text-xl leading-none text-ink tabular-nums">
                          {count}
                        </span>
                        <span className="mt-1 block text-xs text-muted">
                          {count === 1 ? singular : plural}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted">
                  No relevant objects detected.
                </p>
              )}
              <p className="mt-4 max-w-2xl text-xs leading-relaxed text-faint">
                Visible-object context only. A detected person or vehicle is not
                evidence of a flood victim, a stranded person or a rescue asset,
                and detections are never used in water analysis or zone ranking.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                {ai?.message ?? "AI object detection is unavailable."}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-faint">
                The OpenCV analysis completed normally. Every result above comes
                from it.
              </p>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}
