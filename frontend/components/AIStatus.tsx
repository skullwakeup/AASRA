import { Cpu, BrainCircuit } from "lucide-react";
import { Panel, PanelHeader } from "@/components/Panel";
import type { AnalysisMode } from "@/types/api";

/**
 * Honest reporting of `analysis_mode` from the backend response.
 *
 * The backend currently ships `{ opencv: true, ai: false }`. When `ai` is
 * false this panel says NOT ENABLED — it never implies a model is running.
 * If the backend later flips the flag, this panel reflects that with no
 * frontend change.
 */
export function AIStatus({ mode }: { mode: AnalysisMode }) {
  return (
    <Panel>
      <PanelHeader title="Analysis Mode" icon={<Cpu className="size-3.5" />} />
      <div className="divide-y divide-line">
        <ModeRow
          icon={<BrainCircuit className="size-4" strokeWidth={1.75} />}
          label="AI Context Analysis"
          active={mode.ai}
          activeText="Active"
          inactiveText="Not enabled"
          description={
            mode.ai
              ? "AI context analysis is reported active by the analysis service."
              : "No AI model is running. Every result below comes from the OpenCV pipeline. The interface is ready for AI output when the service enables it."
          }
        />
        <ModeRow
          icon={<Cpu className="size-4" strokeWidth={1.75} />}
          label="OpenCV Spatial Analysis"
          active={mode.opencv}
          activeText="Active"
          inactiveText="Inactive"
          description={
            mode.opencv
              ? "Water detection, connected-component regions, distance transform and zone scoring."
              : "The OpenCV pipeline is reported inactive by the analysis service."
          }
        />
      </div>
    </Panel>
  );
}

function ModeRow({
  icon,
  label,
  active,
  activeText,
  inactiveText,
  description,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  activeText: string;
  inactiveText: string;
  description: string;
}) {
  return (
    <div className="px-4 py-4 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={active ? "text-emerald-300" : "text-faint"}>
            {icon}
          </span>
          <span className="truncate text-[13px] font-medium text-ink">
            {label}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {active ? (
            <span className="size-1.5 rounded-full bg-emerald-400" />
          ) : (
            <span className="size-1.5 rounded-full border border-faint" />
          )}
          <span
            className={`font-mono text-[10px] uppercase tracking-[0.16em] ${
              active ? "text-emerald-300" : "text-faint"
            }`}
          >
            {active ? activeText : inactiveText}
          </span>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        {description}
      </p>
    </div>
  );
}
