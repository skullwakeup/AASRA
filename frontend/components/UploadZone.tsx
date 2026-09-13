"use client";

import { useCallback, useRef, useState } from "react";
import { UploadCloud, ImageUp, AlertTriangle } from "lucide-react";

const ACCEPTED_EXTENSIONS = [".png", ".jpg", ".jpeg"];
const ACCEPT_ATTRIBUTE = "image/png,image/jpeg,.png,.jpg,.jpeg";

/**
 * Client-side guard only — the backend re-validates every upload
 * (extension, content type, size, decodability).
 */
function validate(file: File, maxSizeMb: number): string | null {
  const name = file.name.toLowerCase();
  const hasValidExtension = ACCEPTED_EXTENSIONS.some((ext) =>
    name.endsWith(ext),
  );
  if (!hasValidExtension) {
    return "Unsupported file type. Upload a PNG, JPG or JPEG image.";
  }
  if (file.size === 0) {
    return "That file is empty.";
  }
  if (file.size > maxSizeMb * 1024 * 1024) {
    return `That file is too large. The maximum accepted size is ${maxSizeMb} MB.`;
  }
  return null;
}

export function UploadZone({
  onSelect,
  maxSizeMb,
  disabled = false,
}: {
  onSelect: (file: File) => void;
  maxSizeMb: number;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const accept = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      const error = validate(file, maxSizeMb);
      if (error) {
        setLocalError(error);
        return;
      }
      setLocalError(null);
      onSelect(file);
    },
    [maxSizeMb, onSelect],
  );

  return (
    <div className="anim-fade-up">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (disabled) return;
          accept(event.dataTransfer.files?.[0]);
        }}
        className={`group relative overflow-hidden rounded-lg border border-dashed transition-colors duration-200 ${
          isDragging
            ? "border-water/70 bg-water/[0.06]"
            : "border-line-strong bg-surface/60 hover:border-water/40 hover:bg-surface"
        } ${disabled ? "pointer-events-none opacity-50" : ""}`}
      >
        {/* Corner ticks — a quiet targeting-reticle cue, pure CSS. */}
        <Ticks active={isDragging} />

        <div className="flex flex-col items-center px-6 py-12 text-center sm:px-10 sm:py-16">
          <div
            className={`grid size-14 place-items-center rounded-md border transition-colors duration-200 ${
              isDragging
                ? "border-water/50 bg-water/15 text-water"
                : "border-line-strong bg-raised text-muted group-hover:text-water"
            }`}
          >
            <UploadCloud className="size-6" strokeWidth={1.5} />
          </div>

          <h3 className="mt-6 font-mono text-[13px] font-medium uppercase tracking-[0.2em] text-ink sm:text-sm">
            Drop aerial imagery here
          </h3>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
            PNG, JPG or JPEG &middot; up to {maxSizeMb} MB
          </p>

          <div className="mt-7 flex items-center gap-4">
            <span className="h-px w-10 bg-line" />
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
              or
            </span>
            <span className="h-px w-10 bg-line" />
          </div>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-7 inline-flex items-center gap-2 rounded border border-line-strong bg-raised px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink transition-colors duration-150 hover:border-water/50 hover:bg-water/10 hover:text-water"
          >
            <ImageUp className="size-4" strokeWidth={1.75} />
            Browse files
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="hidden"
          onChange={(event) => {
            accept(event.target.files?.[0]);
            // Allow re-selecting the same file after a reset.
            event.target.value = "";
          }}
        />
      </div>

      {localError ? (
        <p className="anim-fade mt-3 flex items-start gap-2 text-xs text-amber-300">
          <AlertTriangle className="mt-px size-3.5 shrink-0" strokeWidth={2} />
          {localError}
        </p>
      ) : null}
    </div>
  );
}

function Ticks({ active }: { active: boolean }) {
  const color = active ? "border-water/60" : "border-line-strong";
  const base = "pointer-events-none absolute size-5 transition-colors duration-200";
  return (
    <>
      <span className={`${base} left-3 top-3 border-l border-t ${color}`} />
      <span className={`${base} right-3 top-3 border-r border-t ${color}`} />
      <span className={`${base} bottom-3 left-3 border-b border-l ${color}`} />
      <span className={`${base} bottom-3 right-3 border-b border-r ${color}`} />
    </>
  );
}
