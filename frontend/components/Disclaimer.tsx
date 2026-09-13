/** Present but not dominant. Mirrors the backend's own `notice`. */
export function Disclaimer({ notice }: { notice?: string }) {
  return (
    <aside className="border-t border-line pt-6">
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-faint">
        Important
      </p>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
        AASRA is an image-based decision-support prototype. Results should not
        be used as the sole basis for real-world emergency, aviation or rescue
        decisions.
      </p>
      {notice ? (
        <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-faint">
          {notice}
        </p>
      ) : null}
    </aside>
  );
}
