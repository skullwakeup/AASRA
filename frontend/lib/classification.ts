/**
 * Maps the backend's classification strings onto colour tokens.
 *
 * Potential bands come from services/scoring.py::classify_score and are used
 * by zones, storage zones and drop zones alike:
 *   HIGH POTENTIAL / MODERATE POTENTIAL / LOW POTENTIAL / NOT RECOMMENDED
 *
 * Isolation bands come from services/isolated_regions.py::classify_isolation
 *   HIGH ISOLATION / MODERATE ISOLATION / LOW ISOLATION
 *
 * Wording rule: never "safe", never "landing zone", never any claim about
 * people. The label shown is the backend's own string.
 */

export interface Tone {
  /** Text colour on the dark canvas. */
  text: string;
  /** Text colour on the light canvas. */
  ink: string;
  /** Solid fill for bars and dots. */
  fill: string;
}

const HIGH: Tone = { text: "text-signal", ink: "text-signal-ink", fill: "bg-signal" };
const MODERATE: Tone = { text: "text-caution", ink: "text-caution-ink", fill: "bg-caution" };
const LOW: Tone = { text: "text-muted", ink: "text-paper-muted", fill: "bg-[#9a9a94]" };
const NOT_RECOMMENDED: Tone = { text: "text-warning", ink: "text-warning-ink", fill: "bg-warning" };

/** Works for both "… POTENTIAL" and "… ISOLATION" strings. */
export function toneFor(classification: string): Tone {
  const value = classification.toUpperCase();
  if (value.startsWith("HIGH")) return HIGH;
  if (value.startsWith("MODERATE")) return MODERATE;
  if (value.startsWith("LOW")) return LOW;
  return NOT_RECOMMENDED;
}

/** "HIGH POTENTIAL" -> "High Potential". */
export function titleCase(value: string): string {
  return value.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
