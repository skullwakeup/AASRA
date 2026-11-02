import type { HTMLAttributes, ReactNode } from "react";

/** Flat, hairline-bordered 8px card. No shadows, no blur. */
export function Panel({
  children,
  className = "",
  tone = "dark",
  ...rest
}: HTMLAttributes<HTMLElement> & { tone?: "dark" | "light" }) {
  const surface =
    tone === "light"
      ? "border-paper-line bg-paper-card text-paper-ink"
      : "border-line bg-surface";
  return (
    <section className={`rounded-lg border ${surface} ${className}`} {...rest}>
      {children}
    </section>
  );
}

/** Heading that opens each chapter of the results page. */
export function SectionHeading({
  eyebrow,
  title,
  description,
  aside,
  tone = "dark",
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  tone?: "dark" | "light";
}) {
  const light = tone === "light";
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? (
          <p className={`eyebrow ${light ? "text-paper-faint" : "text-faint"}`}>{eyebrow}</p>
        ) : null}
        <h2 className={`display mt-3 text-[30px] sm:text-[38px] ${light ? "text-paper-ink" : "text-ink"}`}>
          {title}
        </h2>
        {description ? (
          <p
            className={`mt-3 text-base leading-relaxed ${
              light ? "text-paper-muted" : "text-muted"
            }`}
          >
            {description}
          </p>
        ) : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}
