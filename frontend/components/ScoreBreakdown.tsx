"use client";

/** A labelled 0-100 bar. Values come straight from the backend response. */
export function ScoreBar({
  label,
  value,
  weight,
  fill,
}: {
  label: string;
  /** 0-100 backend sub-score. */
  value: number;
  /** Backend weight (0-1) from `parameters.score_weights`, when applicable. */
  weight?: number;
  fill: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          {label}
          {typeof weight === "number" ? (
            <span className="ml-1.5 text-[9px] text-faint/70">
              &times;{weight}
            </span>
          ) : null}
        </span>
        <span className="font-mono text-[11px] text-muted tabular-nums">
          {value.toFixed(1)}
        </span>
      </div>
      <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-line">
        <div
          className={`h-full rounded-full ${fill} transition-[width] duration-700 ease-out`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </li>
  );
}

/** A labelled row for a raw (non 0-100) sub-feature. */
export function FactorRow({
  label,
  value,
  ratio,
  fill,
}: {
  label: string;
  value: string;
  /** 0-1 fraction used only for the bar width, when meaningful. */
  ratio?: number;
  fill: string;
}) {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          {label}
        </span>
        <span className="font-mono text-[11px] text-muted tabular-nums">
          {value}
        </span>
      </div>
      {typeof ratio === "number" ? (
        <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-line">
          <div
            className={`h-full rounded-full ${fill} transition-[width] duration-700 ease-out`}
            style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}
          />
        </div>
      ) : null}
    </li>
  );
}
