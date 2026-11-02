"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnalysisProgress } from "@/components/AnalysisProgress";
import { Header, type HealthState } from "@/components/Header";
import { ImagePreview } from "@/components/ImagePreview";
import { Footer, Hero, ImageryBand, Method } from "@/components/Landing";
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

  const scrollToWorkspace = useCallback(() => {
    // After React commits the new stage.
    window.requestAnimationFrame(() =>
      document.getElementById("analyze")?.scrollIntoView({ block: "start" }),
    );
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
      scrollToWorkspace();

      // Read the true pixel dimensions for the preview.
      const probe = new window.Image();
      probe.onload = () => {
        setDimensions({ width: probe.naturalWidth, height: probe.naturalHeight });
      };
      probe.src = url;
    },
    [releasePreview, scrollToWorkspace],
  );

  const handleReset = useCallback(() => {
    const fromResults = stage === "results";
    abortRef.current?.abort();
    abortRef.current = null;
    releasePreview();
    setFile(null);
    setPreviewUrl(null);
    setDimensions(null);
    setResult(null);
    setFailure(null);
    setStage("idle");
    if (fromResults) scrollToWorkspace();
  }, [releasePreview, scrollToWorkspace, stage]);

  const handleHome = useCallback(() => {
    if (stage === "results") handleReset();
    window.scrollTo({ top: 0 });
  }, [handleReset, stage]);

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
      window.scrollTo({ top: 0 });
    } catch (error) {
      if (controller.signal.aborted) return;

      if (error instanceof AasraApiError) {
        setFailure({ message: error.message, code: error.code });
      } else {
        // Nothing internal is surfaced — only a clean, generic message.
        setFailure({
          message: "An unexpected problem stopped the analysis before it completed.",
          code: "UNEXPECTED_ERROR",
        });
      }
      setStage("error");
    } finally {
      abortRef.current = null;
    }
  }, [file]);

  const maxFileSizeMb = health?.limits?.max_file_size_mb ?? DEFAULT_MAX_FILE_SIZE_MB;
  const offline = healthState === "offline";

  return (
    <>
      <Header health={healthState} onHome={handleHome} />

      <main className="flex-1">
        {stage === "results" && result ? (
          <ResultsDashboard result={result} fileName={file?.name ?? ""} onReset={handleReset} />
        ) : (
          <>
            <Hero />
            <Method />

            <section id="analyze" className="chapter scroll-mt-14" aria-labelledby="analyze-title">
              <div className="mx-auto grid max-w-[1280px] gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16 lg:px-8">
                <div>
                  <p className="eyebrow text-faint">Workspace</p>
                  <h2 id="analyze-title" className="display mt-4 text-[36px] sm:text-[44px]">
                    Analyze imagery
                  </h2>
                  <p className="mt-5 max-w-sm text-base leading-relaxed text-muted">
                    Near-vertical aerial or drone photographs work best. Nothing is sent until
                    you run the analysis, and nothing is stored.
                  </p>
                </div>

                <div className="min-w-0">
                  {offline ? <OfflineNotice /> : null}

                  {stage === "idle" ? (
                    <UploadZone onSelect={handleSelect} maxSizeMb={maxFileSizeMb} disabled={offline} />
                  ) : null}

                  {stage === "ready" && file && previewUrl ? (
                    <ImagePreview
                      file={file}
                      previewUrl={previewUrl}
                      dimensions={dimensions}
                      onAnalyze={handleAnalyze}
                      onReset={handleReset}
                      disabled={offline}
                    />
                  ) : null}

                  {stage === "analyzing" && previewUrl ? (
                    <AnalysisProgress previewUrl={previewUrl} />
                  ) : null}

                  {stage === "error" && failure ? (
                    <ErrorState message={failure.message} code={failure.code} onRetry={handleReset} />
                  ) : null}
                </div>
              </div>
            </section>

            <ImageryBand />
          </>
        )}
      </main>

      <Footer />
    </>
  );
}

function OfflineNotice() {
  return (
    <div
      className="anim-fade mb-5 rounded-lg border border-warning/30 bg-warning/[0.06] px-5 py-4"
      role="alert"
      data-testid="offline-notice"
    >
      <p className="eyebrow text-warning">Analysis service unreachable</p>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        The AASRA backend is not responding. Uploads stay disabled until it is back; this
        notice clears on its own.
      </p>
    </div>
  );
}
