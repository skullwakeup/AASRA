"use client";

export type HealthState = "checking" | "online" | "offline";

const STATUS: Record<HealthState, { label: string; dot: string }> = {
  checking: { label: "Connecting", dot: "bg-faint" },
  online: { label: "Service online", dot: "bg-signal" },
  offline: { label: "Service offline", dot: "bg-warning" },
};

/** Flat black bar: wordmark left, live service status right. */
export function Header({
  health,
  onHome,
}: {
  health: HealthState;
  onHome?: () => void;
}) {
  const status = STATUS[health];
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onHome}
          className="flex min-w-0 items-center gap-3 text-left"
          aria-label="AASRA home"
        >
          {/* Emblem cropped from the official logo (square, transparent). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/aasra-mark.png" alt="" width={36} height={36} className="size-9 shrink-0" />

          <span className="text-[15px] font-semibold tracking-[0.18em] text-ink">AASRA</span>
          <span className="hidden truncate text-sm text-faint md:inline">
            AI-Assisted Relief Area Identification
          </span>
        </button>

        <span
          className="flex shrink-0 items-center gap-2 text-xs text-muted"
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true" className={`size-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </span>
      </div>
    </header>
  );
}
