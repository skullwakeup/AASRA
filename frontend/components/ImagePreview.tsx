"use client";

import { Panel } from "@/components/Panel";
import { formatBytes } from "@/lib/format";
import { pillPrimary, pillSecondary } from "@/lib/ui";

/**
 * The staged-but-not-yet-analysed state. It must be unmistakable that
 * nothing has been computed yet.
 */
export function ImagePreview({
  file,
  previewUrl,
  dimensions,
  onAnalyze,
  onReset,
  disabled = false,
}: {
  file: File;
  previewUrl: string;
  dimensions: { width: number; height: number } | null;
  onAnalyze: () => void;
  onReset: () => void;
  disabled?: boolean;
}) {
  return (
    <Panel className="anim-fade-up overflow-hidden">
      <div className="viewer-canvas">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewUrl}
          alt="Selected aerial image"
          className="mx-auto block max-h-[52vh] w-full object-contain"
        />
      </div>

      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <p className="eyebrow text-faint">Ready · not analysed yet</p>
          <p className="mt-2 truncate text-lg text-ink" title={file.name}>
            {file.name}
          </p>
          <p className="mt-1 text-sm text-muted tabular-nums">
            {formatBytes(file.size)}
            {dimensions ? ` · ${dimensions.width} × ${dimensions.height} px` : ""}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-3">
          <button type="button" onClick={onReset} className={pillSecondary}>
            Remove
          </button>
          <button
            type="button"
            onClick={onAnalyze}
            disabled={disabled}
            className={pillPrimary}
          >
            Run analysis
          </button>
        </div>
      </div>
    </Panel>
  );
}
