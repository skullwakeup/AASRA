import type { ReactNode } from "react";

/**
 * A single headline metric. `value` is always rendered from the backend
 * response by the caller — this component computes nothing.
 */
export function MetricCard({
  label,
  value,
  unit,
  caption,
  icon,
  accent = "neutral",
  bar,
}: {
  label: string;
  value: string;
  unit?: string;
  caption: string;
  icon: ReactNode;
  accent?: "water" | "land" | "zone" | "isolation" | "neutral";
  /** 0-100. Only pass when the metric genuinely is a proportion. */
  bar?: number;
}) {
  const accents = {
    water: { text: "text-water", fill: "bg-water" },
    land: { text: "text-emerald-300", fill: "bg-emerald-400" },
    zone: { text: "text-sky-200", fill: "bg-sky-300" },
    isolation: { text: "text-orange-300", fill: "bg-orange-400" },
    neutral: { text: "text-ink", fill: "bg-slate-400" },
  }[accent];

  return (
    <div className="group relative overflow-hidden rounded-lg border border-line bg-surface/80 p-4 transition-colors duration-200 hover:border-line-strong sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-[10px] uppercase leading-relaxed tracking-[0.16em] text-faint">
          {label}
        </span>
        <span className={`shrink-0 opacity-60 ${accents.text}`}>{icon}</span>
      </div>

      <div className="mt-4 flex items-baseline gap-1">
        <span className="font-mono text-[30px] font-medium leading-none tracking-tight text-ink tabular-nums sm:text-[34px]">
          {value}
        </span>
        {unit ? (
          <span className={`font-mono text-base leading-none ${accents.text}`}>
            {unit}
          </span>
        ) : null}
      </div>

      {typeof bar === "number" ? (
        <div className="mt-4 h-[3px] w-full overflow-hidden rounded-full bg-line">
          <div
            className={`h-full rounded-full ${accents.fill} transition-[width] duration-700 ease-out`}
            style={{ width: `${Math.max(0, Math.min(100, bar))}%` }}
          />
        </div>
      ) : null}

      <p
        className={`text-[11px] leading-relaxed text-faint ${
          typeof bar === "number" ? "mt-3" : "mt-4"
        }`}
      >
        {caption}
      </p>
    </div>
  );
}
