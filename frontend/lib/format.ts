/** Small presentation helpers. No analysis logic and no fabricated values. */

const numberFormatter = new Intl.NumberFormat("en-US");

export function formatInt(value: number): string {
  return numberFormatter.format(Math.round(value));
}

/** Pixel counts / distances. The backend never reports metres. */
export function formatPx(value: number, decimals = 0): string {
  const rounded =
    decimals > 0
      ? Number(value.toFixed(decimals)).toLocaleString("en-US", {
          maximumFractionDigits: decimals,
        })
      : numberFormatter.format(Math.round(value));
  return `${rounded} px`;
}

export function formatPercent(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

export function formatScore(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Zero-padded rank label: 1 -> "01". */
export function rankLabel(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/**
 * The backend returns RAW base64 PNG strings (verified: they begin with the
 * PNG signature `iVBORw0KGgo`, not `data:`). Build the data URL here, and
 * pass through anything that already is one so the UI never breaks if the
 * backend format changes later.
 */
export function toDataUrl(base64: string | undefined | null): string | null {
  if (!base64) return null;
  const value = base64.trim();
  if (!value) return null;
  if (value.startsWith("data:")) return value;
  return `data:image/png;base64,${value}`;
}
