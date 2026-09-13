"use client";

export type HealthState = "checking" | "online" | "offline";

/** Compact header: wordmark only. */
export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ground">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="text-[15px] font-semibold tracking-[0.12em] text-ink">
            AASRA
          </span>
          <span className="hidden truncate text-sm text-faint sm:inline">
            AI-Assisted Relief Area Identification
          </span>
        </div>
      </div>
    </header>
  );
}
