import { ShieldAlert } from "lucide-react";

/** Present but not dominant. Mirrors the backend's own `notice`. */
export function Disclaimer({ notice }: { notice?: string }) {
  return (
    <aside className="rounded-lg border border-amber-400/20 bg-amber-400/[0.035] px-4 py-4 sm:px-5">
      <div className="flex gap-3">
        <ShieldAlert
          className="mt-px size-4 shrink-0 text-amber-300/80"
          strokeWidth={1.75}
        />
        <div className="min-w-0">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300/90">
            Important
          </h3>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted">
            AASRA is an image-based decision-support prototype. Results should
            not be used as the sole basis for real-world emergency, aviation, or
            rescue decisions.
          </p>
          {notice ? (
            <p className="mt-2 max-w-3xl text-[11px] leading-relaxed text-faint">
              {notice}
            </p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
