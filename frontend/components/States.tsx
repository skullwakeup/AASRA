"use client";

import { Panel } from "@/components/Panel";
import { pillPrimary } from "@/lib/ui";

/**
 * Failure surface. The message shown is either the backend's own clean
 * `error.message` (main.py never returns tracebacks) or a network message
 * produced by lib/api.ts. Raw exceptions are never rendered.
 */
export function ErrorState({
  message,
  code,
  onRetry,
}: {
  message: string;
  code?: string;
  onRetry: () => void;
}) {
  return (
    <Panel className="anim-fade-up border-warning/30 p-6 sm:p-8" role="alert">
      <p className="eyebrow text-warning">Analysis could not be completed</p>
      <p className="mt-3 max-w-xl text-lg font-light leading-relaxed text-ink">
        {message}
      </p>
      {code ? (
        <p className="mt-3 font-mono text-xs text-faint">Code: {code}</p>
      ) : null}
      <button type="button" onClick={onRetry} className={`${pillPrimary} mt-7`}>
        Try another image
      </button>
    </Panel>
  );
}

/** Placeholder for a section the backend returned nothing for. */
export function EmptyState({
  title,
  description,
  tone = "dark",
}: {
  title: string;
  description: string;
  tone?: "dark" | "light";
}) {
  const light = tone === "light";
  return (
    <div
      className={`rounded-lg border border-dashed px-6 py-10 text-center ${
        light ? "border-paper-ink/20" : "border-line-strong"
      }`}
    >
      <p className={`text-lg ${light ? "text-paper-ink" : "text-ink"}`}>{title}</p>
      <p
        className={`mx-auto mt-2 max-w-lg text-sm leading-relaxed ${
          light ? "text-paper-muted" : "text-muted"
        }`}
      >
        {description}
      </p>
    </div>
  );
}
