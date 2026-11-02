"use client";

import { useCallback, useRef, useState } from "react";
import { AlertTriangle, ImageUp } from "lucide-react";
import { chip, pillPrimary } from "@/lib/ui";

const ACCEPTED_EXTENSIONS = [".png", ".jpg", ".jpeg"];
const ACCEPT_ATTRIBUTE = "image/png,image/jpeg,.png,.jpg,.jpeg";

/** Public-domain samples shipped in public/imagery (see CREDITS.md). */
const SAMPLES = [
  { file: "sample-pakistan-2010.jpg", label: "Flooded settlement · Pakistan 2010" },
  { file: "sample-missouri-levee-2008.jpg", label: "Levee breach · Missouri 2008" },
];

/**
 * Client-side guard only — the backend re-validates every upload
 * (extension, content type, size, decodability).
 */
function validate(file: File, maxSizeMb: number): string | null {
  const name = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return "Unsupported file type. Upload a PNG, JPG or JPEG image.";
  }
  if (file.size === 0) return "That file is empty.";
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
  const [loadingSample, setLoadingSample] = useState<string | null>(null);

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

  const loadSample = useCallback(
    async (name: string) => {
      setLoadingSample(name);
      try {
        const response = await fetch(`/imagery/${name}`);
        if (!response.ok) throw new Error(String(response.status));
        const blob = await response.blob();
        accept(new File([blob], name, { type: "image/jpeg" }));
      } catch {
        setLocalError("The sample image could not be loaded.");
      } finally {
        setLoadingSample(null);
      }
    },
    [accept],
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
        className={`rounded-lg border border-dashed transition-colors duration-200 ${
          isDragging
            ? "border-water bg-water/[0.07]"
            : "border-line-strong bg-surface hover:border-ink/40"
        } ${disabled ? "pointer-events-none opacity-45" : ""}`}
        data-testid="upload-zone"
      >
        <div className="flex flex-col items-center px-6 py-14 text-center sm:py-20">
          <ImageUp
            className={`size-8 ${isDragging ? "text-water" : "text-faint"}`}
            strokeWidth={1.25}
          />
          <p className="mt-6 text-2xl font-light tracking-tight text-ink sm:text-[28px]">
            Drop an aerial flood image here
          </p>
          <p className="mt-2 text-sm text-faint">
            PNG, JPG or JPEG · up to {maxSizeMb} MB
          </p>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
            className={`${pillPrimary} mt-8`}
          >
            Choose image
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="hidden"
          data-testid="file-input"
          onChange={(event) => {
            accept(event.target.files?.[0]);
            // Allow re-selecting the same file after a reset.
            event.target.value = "";
          }}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <span className="mr-1 text-sm text-faint">Or try a sample:</span>
        {SAMPLES.map((sample) => (
          <button
            key={sample.file}
            type="button"
            className={chip}
            disabled={disabled || loadingSample !== null}
            onClick={() => loadSample(sample.file)}
          >
            {loadingSample === sample.file ? "Loading…" : sample.label}
          </button>
        ))}
      </div>

      {localError ? (
        <p className="anim-fade mt-4 flex items-start gap-2 text-sm text-warning" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
          {localError}
        </p>
      ) : null}
    </div>
  );
}
