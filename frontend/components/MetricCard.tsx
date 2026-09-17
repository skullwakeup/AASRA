/**
 * A single headline metric. `value` is always rendered from the backend
 * response by the caller — this component computes nothing.
 */
export function MetricCard({
  label,
  value,
  caption,
  accent,
  bar,
  testId,
  className = "",
}: {
  label: string;
  value: string;
  caption: string;
  accent?: "water" | "signal";
  /** 0-100. Only pass when the metric genuinely is a proportion. */
  bar?: number;
  testId?: string;
  className?: string;
}) {
  const valueColor =
    accent === "signal" ? "text-signal" : accent === "water" ? "text-water" : "text-ink";
  return (
    <div className={`bg-surface p-4 sm:p-5 ${className}`}>
      <p className="text-sm text-muted">{label}</p>
      <p
        className={`display mt-3 text-[40px] tabular-nums ${valueColor}`}
        data-testid={testId}
      >
        {value}
      </p>
      {typeof bar === "number" ? (
        <div className="mt-3 h-[2px] w-full overflow-hidden rounded-full bg-line">
          <div
            className={`h-full rounded-full ${accent === "water" ? "bg-water" : "bg-ink/50"}`}
            style={{ width: `${Math.max(0, Math.min(100, bar))}%` }}
          />
        </div>
      ) : null}
      <p className="mt-3 text-xs leading-relaxed text-faint">{caption}</p>
    </div>
  );
}
