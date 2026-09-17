/** Limitations chapter. Mirrors the backend's own `notice`. */
const LIMITS = [
  "Results are estimates from image colour and geometry. No ground truth is used.",
  "Distances are image pixels. Without a known ground scale they are not metres.",
  "Nothing here confirms safe landing, safe supply drops, access or structural safety.",
  "People, obstacles, power lines, slopes and surface firmness are not assessed.",
  "Water detection can confuse pale roofs, concrete or deep shadow with water.",
  "Every probable zone must be verified by trained personnel before any action.",
];

export function Disclaimer({ notice }: { notice?: string }) {
  return (
    <section aria-labelledby="limitations-title">
      <p className="eyebrow text-paper-faint">Limitations</p>
      <h2 id="limitations-title" className="display mt-3 text-[30px] text-paper-ink sm:text-[38px]">
        Computer-vision decision support, not a clearance
      </h2>
      <ul className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-paper-line bg-paper-line sm:grid-cols-2 lg:grid-cols-3">
        {LIMITS.map((item) => (
          <li key={item} className="bg-paper-card p-5 text-sm leading-relaxed text-paper-muted">
            {item}
          </li>
        ))}
      </ul>
      {notice ? (
        <p className="mt-5 max-w-3xl text-xs leading-relaxed text-paper-faint">{notice}</p>
      ) : null}
    </section>
  );
}
