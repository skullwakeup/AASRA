import type { ReactNode } from "react";

/** Flat, hairline-bordered surface. No shadows, no blur, minimal rounding. */
export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-line bg-surface ${className}`}>
      {children}
    </section>
  );
}

/** Panel header bar: a title on the left, optional meta on the right. */
export function PanelHeader({
  title,
  meta,
}: {
  title: string;
  meta?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 sm:px-5">
      <h2 className="truncate text-sm font-medium text-ink">{title}</h2>
      {meta ? <div className="shrink-0">{meta}</div> : null}
    </div>
  );
}

/** Heading that opens each block of the results page. */
export function SectionHeading({
  title,
  count,
  description,
}: {
  title: string;
  count?: string;
  description?: string;
}) {
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {count ? (
          <span className="text-sm text-faint tabular-nums">{count}</span>
        ) : null}
      </div>
      {description ? (
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
          {description}
        </p>
      ) : null}
    </div>
  );
}
