import type { ReactNode } from "react";

/** Flat, hairline-bordered surface. No heavy shadows, minimal rounding. */
export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-line bg-surface/80 backdrop-blur-[2px] ${className}`}
    >
      {children}
    </section>
  );
}

/** Small uppercase technical label used throughout the interface. */
export function Eyebrow({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`font-mono text-[10px] uppercase tracking-[0.18em] text-faint ${className}`}
    >
      {children}
    </span>
  );
}

/** Panel header bar: a title on the left, optional meta on the right. */
export function PanelHeader({
  title,
  meta,
  icon,
}: {
  title: string;
  meta?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon ? <span className="text-faint">{icon}</span> : null}
        <h2 className="truncate font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
          {title}
        </h2>
      </div>
      {meta ? <div className="shrink-0">{meta}</div> : null}
    </div>
  );
}

/** Full-width section heading used between dashboard blocks. */
export function SectionHeading({
  title,
  count,
  description,
  icon,
}: {
  title: string;
  count?: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="flex items-center gap-3">
        {icon ? <span className="text-water/70">{icon}</span> : null}
        <h2 className="font-mono text-[13px] uppercase tracking-[0.2em] text-ink">
          {title}
        </h2>
        {count ? (
          <span className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[10px] text-muted">
            {count}
          </span>
        ) : null}
      </div>
      {description ? (
        <p className="max-w-xl text-xs text-faint">{description}</p>
      ) : null}
    </div>
  );
}
