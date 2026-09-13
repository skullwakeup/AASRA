"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnalysisProgress } from "@/components/AnalysisProgress";
import { Header, type HealthState } from "@/components/Header";
import { ImagePreview } from "@/components/ImagePreview";
import { PipelineStrip } from "@/components/PipelineStrip";
import { ResultsDashboard } from "@/components/ResultsDashboard";
import { ErrorState } from "@/components/States";
import { UploadZone } from "@/components/UploadZone";
import { AasraApiError, analyzeImage, fetchHealth } from "@/lib/api";
import type { AnalysisResponse, HealthResponse } from "@/types/api";

/** Fallback used only until GET /health reports the service's real limit. */
const DEFAULT_MAX_FILE_SIZE_MB = 15;

type Stage = "idle" | "ready" | "analyzing" | "results" | "error";

export default function Home() {
  const [stage, setStage] = useState<Stage>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [failure, setFailure] = useState<{
    message: string;
    code?: string;
  } | null>(null);

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthState, setHealthState] = useState<HealthState>("checking");

  // Track the object URL so it can be revoked exactly once.
  const previewUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* ------------------------------------------------------------- health */
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const probe = async () => {
      const response = await fetchHealth(controller.signal);
      if (cancelled) return;
      setHealth(response);
      setHealthState(response ? "online" : "offline");
    };

    probe();
    // Re-probe periodically so the indicator never goes stale.
    const timer = window.setInterval(probe, 20000);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  /* ------------------------------------------------------------ cleanup */
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const releasePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  /* ----------------------------------------------------------- handlers */
  const handleSelect = useCallback(
    (selected: File) => {
      releasePreview();

      const url = URL.createObjectURL(selected);
      previewUrlRef.current = url;

      setFile(selected);
      setPreviewUrl(url);
      setDimensions(null);
      setResult(null);
      setFailure(null);
      setStage("ready");

      // Read the true pixel dimensions for the preview card.
      const probe = new window.Image();
      probe.onload = () => {
        setDimensions({
          width: probe.naturalWidth,
          height: probe.naturalHeight,
        });
      };
      probe.src = url;
    },
    [releasePreview],
  );

  const handleReset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    releasePreview();
    setFile(null);
    setPreviewUrl(null);
    setDimensions(null);
    setResult(null);
    setFailure(null);
    setStage("idle");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [releasePreview]);

  const handleAnalyze = useCallback(async () => {
    if (!file) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setStage("analyzing");
    setFailure(null);

    try {
      const response = await analyzeImage(file, controller.signal);
      if (controller.signal.aborted) return;
      setResult(response);
      setStage("results");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      if (controller.signal.aborted) return;

      if (error instanceof AasraApiError) {
        setFailure({ message: error.message, code: error.code });
      } else {
        // Nothing internal is surfaced — only a clean, generic message.
        setFailure({
          message:
            "An unexpected problem stopped the analysis before it completed.",
          code: "UNEXPECTED_ERROR",
        });
      }
      setStage("error");
    } finally {
      abortRef.current = null;
    }
  }, [file]);

  const maxFileSizeMb =
    health?.limits?.max_file_size_mb ?? DEFAULT_MAX_FILE_SIZE_MB;

  return (
    <>
      <Header healthState={healthState} health={health} />

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {stage === "results" && result ? (
          <ResultsDashboard
            result={result}
            fileName={file?.name ?? ""}
            onReset={handleReset}
          />
        ) : (
          <div className="mx-auto w-full max-w-3xl">
            <Intro />

            {healthState === "offline" ? <OfflineNotice /> : null}

            <div className="mt-8">
              {stage === "idle" ? (
                <UploadZone
                  onSelect={handleSelect}
                  maxSizeMb={maxFileSizeMb}
                  disabled={healthState === "offline"}
                />
              ) : null}

              {stage === "ready" && file && previewUrl ? (
                <ImagePreview
                  file={file}
                  previewUrl={previewUrl}
                  dimensions={dimensions}
                  onAnalyze={handleAnalyze}
                  onReset={handleReset}
                  disabled={healthState === "offline"}
                />
              ) : null}

              {stage === "analyzing" && previewUrl ? (
                <AnalysisProgress previewUrl={previewUrl} />
              ) : null}

              {stage === "error" && failure ? (
                <ErrorState
                  message={failure.message}
                  code={failure.code}
                  onRetry={handleReset}
                />
              ) : null}
            </div>

            {stage === "idle" ? (
              <div className="mt-5">
                <PipelineStrip />
              </div>
            ) : null}

            <p className="mt-8 text-center text-[11px] leading-relaxed text-faint">
              AASRA is an image-based decision-support prototype. Outputs are
              candidate regions only and must be verified by trained personnel.
            </p>
          </div>
        )}
      </main>
    </>
  );
}

function Intro() {
  return (
    <div className="anim-fade-up text-center">
      <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5">
        <span className="size-1 rounded-full bg-water" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
          Computer-vision decision support
        </span>
      </div>

      <h1 className="mt-6 font-mono text-2xl uppercase leading-tight tracking-[0.12em] text-ink sm:text-[32px] sm:tracking-[0.16em]">
        Flood Imagery Analysis
      </h1>

      <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted">
        Upload an aerial flood image to analyze flood coverage, identify
        potentially isolated land regions, and rank potential supply-drop zones.
      </p>
    </div>
  );
}

function OfflineNotice() {
  return (
    <div className="anim-fade mt-8 rounded-lg border border-red-400/20 bg-red-400/[0.04] px-4 py-3.5 sm:px-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-red-300">
        Analysis service unreachable
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        The AASRA backend is not responding. Start it and this panel will clear
        on its own — uploads stay disabled until it does.
      </p>
    </div>
  );
}
