"use client";

import { ScanLine, X, CheckCircle2 } from "lucide-react";
import { Panel } from "@/components/Panel";
import { formatBytes } from "@/lib/format";

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
      <div className="flex flex-col gap-5 p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-5">
        <div className="viewer-canvas relative h-40 w-full shrink-0 overflow-hidden rounded border border-line sm:h-28 sm:w-44">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Selected aerial imagery"
            className="size-full object-contain"
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="inline-flex items-center gap-2 rounded border border-amber-400/25 bg-amber-400/10 px-2 py-1">
            <CheckCircle2 className="size-3 text-amber-300" strokeWidth={2.25} />
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-amber-300">
              Ready for analysis
            </span>
          </div>

          <p
            className="mt-3 truncate text-sm font-medium text-ink"
            title={file.name}
          >
            {file.name}
          </p>

          <dl className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px] text-faint">
            <div className="flex items-center gap-1.5">
              <dt className="uppercase tracking-[0.12em]">Size</dt>
              <dd className="text-muted">{formatBytes(file.size)}</dd>
            </div>
            {dimensions ? (
              <div className="flex items-center gap-1.5">
                <dt className="uppercase tracking-[0.12em]">Dimensions</dt>
                <dd className="text-muted">
                  {dimensions.width} &times; {dimensions.height}
                </dd>
              </div>
            ) : null}
          </dl>

          <p className="mt-3 text-xs text-faint">
            No analysis has run yet. Nothing is sent to the analysis service
            until you start it.
          </p>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:w-48">
          <button
            type="button"
            onClick={onAnalyze}
            disabled={disabled}
            className="inline-flex w-full items-center justify-center gap-2 rounded border border-water/40 bg-water/15 px-5 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-water transition-colors duration-150 hover:border-water/70 hover:bg-water/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ScanLine className="size-4" strokeWidth={1.75} />
            Analyze imagery
          </button>
          <button
            type="button"
            onClick={onReset}
            disabled={disabled}
            className="inline-flex w-full items-center justify-center gap-2 rounded border border-line px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-faint transition-colors duration-150 hover:border-line-strong hover:text-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="size-3.5" strokeWidth={2} />
            Remove
          </button>
        </div>
      </div>
    </Panel>
  );
}
