"use client";

import type { ReactNode } from "react";
import { AlertTriangle, RotateCcw, Inbox } from "lucide-react";
import { Panel } from "@/components/Panel";

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
    <Panel className="anim-fade-up overflow-hidden border-red-400/20">
      <div className="flex flex-col items-center px-6 py-12 text-center sm:py-16">
        <div className="grid size-12 place-items-center rounded-md border border-red-400/25 bg-red-400/10">
          <AlertTriangle className="size-5 text-red-300" strokeWidth={1.75} />
        </div>

        <h3 className="mt-6 font-mono text-[13px] uppercase tracking-[0.2em] text-ink">
          Analysis could not be completed
        </h3>

        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
          {message}
        </p>

        {code ? (
          <span className="mt-4 rounded border border-line bg-raised px-2 py-1 font-mono text-[10px] tracking-[0.14em] text-faint">
            {code}
          </span>
        ) : null}

        <button
          type="button"
          onClick={onRetry}
          className="mt-8 inline-flex items-center gap-2 rounded border border-line-strong bg-raised px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink transition-colors duration-150 hover:border-water/50 hover:bg-water/10 hover:text-water"
        >
          <RotateCcw className="size-3.5" strokeWidth={2} />
          Try another image
        </button>
      </div>
    </Panel>
  );
}

/** Polished placeholder for a section the backend returned nothing for. */
export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line bg-surface/40 px-6 py-12 text-center">
      <span className="text-faint">
        {icon ?? <Inbox className="size-6" strokeWidth={1.5} />}
      </span>
      <h3 className="mt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
        {title}
      </h3>
      <p className="mt-2 max-w-md text-xs leading-relaxed text-faint">
        {description}
      </p>
    </div>
  );
}
