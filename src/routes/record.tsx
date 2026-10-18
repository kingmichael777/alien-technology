import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Mic, MicOff, Pause, Play, Square, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Waveform } from "@/components/Waveform";
import { IconButton, Sheet, Spinner, SW } from "@/components/ui";
import { timer } from "@/lib/format";
import { useRecorder } from "@/lib/recorder";

export const Route = createFileRoute("/record")({
  head: () => ({ meta: [{ title: "Recording · Alien Technology" }] }),
  component: RecordScreen,
});

function Clock() {
  const elapsed = useRecorder((s) => s.elapsed);
  const state = useRecorder((s) => s.state);
  const [ms, setMs] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setMs(elapsed());
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [elapsed, state]);
  return (
    <div className="font-mono text-[68px] leading-none font-medium tracking-tight text-amber tabular-nums" aria-live="off">
      {timer(ms)}
    </div>
  );
}

function RecordScreen() {
  const navigate = useNavigate();
  const state = useRecorder((s) => s.state);
  const interrupted = useRecorder((s) => s.interrupted);
  const notice = useRecorder((s) => s.notice);
  const savedId = useRecorder((s) => s.savedId);
  const { start, pause, resume, stop, discard, clearNotice } = useRecorder.getState();
  const [closing, setClosing] = useState(false);
  const live = state === "recording" || state === "paused";

  // The recording ended on its own (microphone taken, 4 hour limit): open what was saved.
  useEffect(() => {
    if (!notice) return;
    toast(notice);
    const id = savedId;
    clearNotice();
    if (id) void navigate({ to: "/r/$id", params: { id }, replace: true });
    else void navigate({ to: "/", replace: true });
  }, [notice, savedId, clearNotice, navigate]);

  // Closing the tab mid-recording asks first. (Even if it closes, the audio so far is kept.)
  useEffect(() => {
    if (!live) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [live]);

  const finish = async () => {
    setClosing(false);
    const id = await stop();
    if (id) void navigate({ to: "/r/$id", params: { id }, replace: true });
    else {
      toast("Nothing was recorded.");
      void navigate({ to: "/", replace: true });
    }
  };

  const throwAway = async () => {
    setClosing(false);
    await discard();
    void navigate({ to: "/", replace: true });
  };

  return (
    <div className="pt-safe pb-safe flex min-h-dvh flex-col">
      <div className="flex h-14 items-center px-2">
        <IconButton
          label={live ? "Stop or discard" : "Close"}
          onClick={() => (live ? setClosing(true) : void navigate({ to: "/" }))}
        >
          <X size={24} strokeWidth={SW} />
        </IconButton>
      </div>

      {state === "denied" || state === "unsupported" || state === "error" ? (
        <Problem state={state} onRetry={start} onBack={() => void navigate({ to: "/" })} />
      ) : state === "idle" ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-16 text-center">
          <button
            type="button"
            aria-label="Start recording"
            onClick={start}
            className="grid size-[120px] place-items-center rounded-full bg-amber text-[var(--on-amber)] shadow-[0_0_48px_var(--amber-line)] active:bg-amber-bright"
          >
            <Mic size={44} strokeWidth={1.75} />
          </button>
          <p className="mt-6 font-serif text-[24px] text-ink">Tap to start recording</p>
          <p className="mt-2 text-[13.5px] text-ink-muted">Let everyone know you're recording.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-1 flex-col items-center justify-center px-6">
            <div className="mb-7 flex items-center gap-2.5 font-mono text-[13px] tracking-[0.18em] text-ink-muted">
              {state === "recording" && <span className="size-2.5 animate-pulse rounded-full bg-pin" />}
              {state === "starting" ? "STARTING" : state === "saving" ? "SAVING" : state === "paused" ? "PAUSED" : "RECORDING"}
            </div>
            <Clock />
            <div className="mt-9 w-full">
              <Waveform />
            </div>
            {interrupted && live && (
              <div className="mt-6 flex items-start gap-2.5 rounded-[12px] border border-amber-line bg-amber-fill px-4 py-3 text-[14px] text-ink">
                <MicOff size={18} strokeWidth={SW} className="mt-0.5 shrink-0 text-amber" />
                <span>The phone paused the microphone. Recording picks up again when it comes back.</span>
              </div>
            )}
            <p className="mt-8 max-w-[30ch] text-center text-[13.5px] leading-relaxed text-ink-muted">
              Keep this screen open while you record. Everything is saved as you go.
            </p>
          </div>

          <div className="flex items-center justify-center gap-9 px-6 pt-4 pb-6">
            <button
              type="button"
              aria-label="Discard"
              disabled={!live}
              onClick={() => setClosing(true)}
              className="grid size-14 place-items-center rounded-full border border-line-strong text-ink-muted active:text-pin disabled:opacity-30"
            >
              <Trash2 size={22} strokeWidth={SW} />
            </button>
            <button
              type="button"
              aria-label="Stop and save"
              disabled={!live}
              onClick={() => void finish()}
              className="grid size-[88px] place-items-center rounded-full bg-amber text-[var(--on-amber)] shadow-[0_0_40px_var(--amber-line)] active:bg-amber-bright disabled:opacity-40"
            >
              {state === "saving" || state === "starting" ? (
                <Spinner className="size-7 border-black/20 border-t-black" />
              ) : (
                <Square size={30} strokeWidth={2} fill="currentColor" />
              )}
            </button>
            <button
              type="button"
              aria-label={state === "paused" ? "Resume" : "Pause"}
              disabled={!live}
              onClick={() => (state === "paused" ? resume() : pause())}
              className="grid size-14 place-items-center rounded-full border border-amber-line text-amber active:bg-amber-fill disabled:opacity-30"
            >
              {state === "paused" ? <Play size={22} strokeWidth={SW} /> : <Pause size={22} strokeWidth={SW} />}
            </button>
          </div>
        </>
      )}

      <Sheet open={closing} onClose={() => setClosing(false)} title="Stop recording?">
        <div className="space-y-3 px-5 pb-2">
          <button className="btn btn-primary w-full" onClick={() => void finish()}>
            Save it
          </button>
          <button className="btn btn-danger w-full" onClick={() => void throwAway()}>
            Discard it
          </button>
          <button className="btn btn-ghost w-full" onClick={() => setClosing(false)}>
            Keep recording
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function Problem({ state, onRetry, onBack }: { state: "denied" | "unsupported" | "error"; onRetry: () => void; onBack: () => void }) {
  const text =
    state === "denied"
      ? "The microphone is blocked for this app. Allow microphone access in your phone's settings for this browser or app, then try again."
      : state === "unsupported"
        ? "This browser can't record audio. On iPhone use Safari, on Android use Chrome."
        : "The microphone didn't start. Try again.";
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 pb-16 text-center">
      <AlertTriangle size={34} strokeWidth={SW} className="text-amber" />
      <p className="mt-5 max-w-[32ch] text-[15px] leading-relaxed text-ink">{text}</p>
      <div className="mt-7 flex gap-3">
        <button className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
        {state !== "unsupported" && (
          <button className="btn btn-primary" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
