/**
 * Maps the backend's classification strings onto UI colour tokens.
 *
 * Zone bands come from services/scoring.py::classify_score
 *   HIGH POTENTIAL / MODERATE POTENTIAL / LOW POTENTIAL / NOT RECOMMENDED
 *
 * Isolation bands come from services/isolated_regions.py::classify_isolation
 *   HIGH ISOLATION / MODERATE ISOLATION / LOW ISOLATION
 *
 * Wording rule: never "safe", never "landing zone", never any claim about
 * people. The label shown is the backend's own string.
 */

export interface Tone {
  /** Text colour class. */
  text: string;
  /** Badge background + border. */
  badge: string;
  /** Solid fill for bars and dots. */
  fill: string;
  /** Faint surface wash for emphasised cards. */
  wash: string;
}

const HIGH: Tone = {
  text: "text-emerald-300",
  badge: "bg-emerald-400/10 border-emerald-400/25 text-emerald-300",
  fill: "bg-emerald-400",
  wash: "bg-emerald-400/[0.04]",
};

const MODERATE: Tone = {
  text: "text-amber-300",
  badge: "bg-amber-400/10 border-amber-400/25 text-amber-300",
  fill: "bg-amber-400",
  wash: "bg-amber-400/[0.04]",
};

const LOW: Tone = {
  text: "text-orange-300",
  badge: "bg-orange-400/10 border-orange-400/25 text-orange-300",
  fill: "bg-orange-400",
  wash: "bg-orange-400/[0.04]",
};

const NEUTRAL: Tone = {
  text: "text-slate-300",
  badge: "bg-slate-400/10 border-slate-400/25 text-slate-300",
  fill: "bg-slate-400",
  wash: "bg-slate-400/[0.04]",
};

/** Works for both "… POTENTIAL" and "… ISOLATION" strings. */
export function toneFor(classification: string): Tone {
  const value = classification.toUpperCase();
  if (value.startsWith("HIGH")) return HIGH;
  if (value.startsWith("MODERATE")) return MODERATE;
  if (value.startsWith("LOW")) return LOW;
  return NEUTRAL; // NOT RECOMMENDED, or any future band.
}
