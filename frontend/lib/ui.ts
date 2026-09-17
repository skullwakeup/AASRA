/**
 * Shared class strings for actions. Every action is a pill; there are no
 * medium-radius buttons. One primary action per view.
 */

const pillBase =
  "inline-flex items-center justify-center gap-2 rounded-full px-6 h-11 text-sm font-semibold tracking-[0.01em] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap";

/** Primary action on either canvas. */
export const pillPrimary = `${pillBase} bg-water text-white hover:bg-[#2f7bd0] active:bg-[#2468b3]`;

/** Outline action on the dark canvas. */
export const pillSecondary = `${pillBase} border border-line-strong text-ink hover:border-ink/60 hover:bg-white/[0.04]`;

/** Compact chip (filters, samples). */
export const chip =
  "inline-flex items-center gap-2 rounded-full border border-line-strong px-4 h-9 text-[13px] text-ink transition-colors duration-150 hover:border-ink/60 hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-45";
