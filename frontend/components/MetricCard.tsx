/**
 * A single headline metric. `value` is always rendered from the backend
 * response by the caller — this component computes nothing.
 */
export function MetricCard({
  label,
  value,
  caption,
  accent = "neutral",
  bar,
}: {
  label: string;
  value: string;
  caption: string;
  accent?: "water" | "neutral";
  /** 0-100. Only pass when the metric genuinely is a proportion. */
  bar?: number;
}) {
  const fill = accent === "water" ? "bg-water" : "bg-slate-500";

  return (
    <div className="rounded-lg border border-line bg-surface p-4 sm:p-5">
      <p className="text-sm text-muted">{label}</p>

      <p className="mt-2 font-mono text-[28px] font-medium leading-none tracking-tight text-ink tabular-nums">
        {value}
      </p>

      {typeof bar === "number" ? (
        <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-line">
          <div
            className={`h-full rounded-full ${fill}`}
            style={{ width: `${Math.max(0, Math.min(100, bar))}%` }}
          />
        </div>
      ) : null}

      <p
        className={`text-xs leading-relaxed text-faint ${
          typeof bar === "number" ? "mt-3" : "mt-4"
        }`}
      >
        {caption}
      </p>
    </div>
  );
}
