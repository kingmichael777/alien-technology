import { AlertCircle, CloudOff, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type { RecordingRow } from "@/lib/db";
import { useConnected, useOnline } from "@/lib/hooks";
import { retryRecording } from "@/lib/library";
import { phaseOf, type Phase } from "@/lib/notes";
import { useSync } from "@/lib/sync";
import { cn } from "@/lib/utils";
import { Spinner, SW } from "./ui";

export function usePhase(row: RecordingRow): Phase {
  const connected = useConnected();
  const online = useOnline();
  const progress = useSync((s) => s.progress[row.id]);
  return phaseOf(row, { connected, online, progress });
}

/** One line saying where a recording is, with Try again when it failed. */
export function StatusLine({ row, className, retry = true }: { row: RecordingRow; className?: string; retry?: boolean }) {
  const phase = usePhase(row);
  if (phase.kind === "ready") return null;
  if (phase.kind === "failed") {
    return (
      <div className={cn("flex items-start gap-2 text-[13.5px] text-pin", className)}>
        <AlertCircle size={16} strokeWidth={SW} className="mt-[2px] shrink-0" />
        <span className="min-w-0 flex-1 leading-snug">{phase.text}</span>
        {retry && (
          <button
            type="button"
            className="-my-1 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-line px-3 py-1 text-[13px] text-amber active:bg-amber-fill"
            onClick={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              try {
                await retryRecording(row);
              } catch (err) {
                toast(err instanceof Error ? err.message : "That didn't work. Try again.");
              }
            }}
          >
            <RotateCcw size={14} strokeWidth={SW} />
            Try again
          </button>
        )}
      </div>
    );
  }
  const busy = phase.kind === "working" || (phase.kind === "local" && phase.busy);
  return (
    <div className={cn("flex items-center gap-2 text-[13.5px] text-ink-muted", className)}>
      {busy ? <Spinner /> : <CloudOff size={15} strokeWidth={SW} className="shrink-0 text-ink-muted" />}
      <span className="min-w-0 leading-snug">{phase.text}</span>
      {phase.kind === "local" && phase.progress !== undefined && (
        <span className="ml-auto h-1 w-16 shrink-0 overflow-hidden rounded-full bg-line-strong">
          <span className="block h-full bg-amber" style={{ width: `${Math.round(phase.progress * 100)}%` }} />
        </span>
      )}
    </div>
  );
}
