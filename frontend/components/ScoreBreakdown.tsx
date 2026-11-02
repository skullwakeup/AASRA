/**
 * A labelled 0-100 bar for the light canvas. Values come straight from the
 * backend response.
 */
export function ScoreBar({
  label,
  value,
  weight,
  fill,
}: {
  label: string;
  /** 0-100 backend sub-score. */
  value: number;
  /** Backend weight (0-1), when applicable. */
  weight?: number;
  fill: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-paper-muted">
          {label}
          {typeof weight === "number" ? (
            <span className="ml-1.5 text-paper-faint">× {weight}</span>
          ) : null}
        </span>
        <span className="tabular-nums text-paper-ink">{value.toFixed(1)}</span>
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-paper-line">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${clamped}%` }} />
      </div>
    </li>
  );
}
