"use client";

import { Radar } from "lucide-react";
import type { HealthResponse } from "@/types/api";

export type HealthState = "checking" | "online" | "offline";

/**
 * Compact command-bar header. The status pill reflects the REAL result of
 * GET /health — it never claims the service is online when it is not.
 */
export function Header({
  healthState,
  health,
}: {
  healthState: HealthState;
  health: HealthResponse | null;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ground/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded border border-water/25 bg-water/10">
            <Radar className="size-[18px] text-water" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <div className="font-mono text-[15px] font-semibold leading-none tracking-[0.22em] text-ink">
              AASRA
            </div>
            <div className="mt-1.5 hidden truncate text-[11px] leading-none text-faint sm:block">
              AI-Assisted Relief Area Identification
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {health?.version ? (
            <span className="hidden font-mono text-[10px] tracking-[0.14em] text-faint md:inline">
              v{health.version}
            </span>
          ) : null}
          <StatusPill state={healthState} />
        </div>
      </div>
    </header>
  );
}

function StatusPill({ state }: { state: HealthState }) {
  const config = {
    checking: {
      label: "CONNECTING",
      dot: "bg-slate-400",
      text: "text-muted",
      border: "border-line-strong",
      pulse: true,
    },
    online: {
      label: "SYSTEM READY",
      dot: "bg-emerald-400",
      text: "text-emerald-300",
      border: "border-emerald-400/25",
      pulse: true,
    },
    offline: {
      label: "SYSTEM OFFLINE",
      dot: "bg-red-400",
      text: "text-red-300",
      border: "border-red-400/25",
      pulse: false,
    },
  }[state];

  return (
    <div
      className={`flex items-center gap-2 rounded-full border ${config.border} bg-surface px-3 py-1.5`}
      role="status"
      aria-live="polite"
    >
      <span className="relative flex size-1.5">
        {config.pulse ? (
          <span
            className={`anim-pulse-slow absolute inline-flex size-full rounded-full ${config.dot} opacity-60`}
          />
        ) : null}
        <span
          className={`relative inline-flex size-1.5 rounded-full ${config.dot}`}
        />
      </span>
      <span
        className={`font-mono text-[10px] font-medium tracking-[0.16em] ${config.text}`}
      >
        {config.label}
      </span>
    </div>
  );
}
