import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Mic } from "lucide-react";
import { useRecorder } from "@/lib/recorder";
import { timer } from "@/lib/format";
import { useEffect, useState } from "react";

/** The big button on the home screen. The microphone starts inside the tap. */
export function RecordButton() {
  const navigate = useNavigate();
  const start = useRecorder((s) => s.start);
  return (
    <button
      type="button"
      aria-label="Start recording"
      onClick={() => {
        start();
        void navigate({ to: "/record" });
      }}
      className="group relative grid size-[152px] place-items-center rounded-full border border-amber-line bg-amber-fill transition-transform active:scale-[0.97]"
    >
      <span className="absolute inset-[11px] rounded-full border border-amber/25" aria-hidden />
      <span className="grid size-[96px] place-items-center rounded-full bg-amber text-[var(--on-amber)] shadow-[0_0_48px_var(--amber-line)]">
        <Mic size={40} strokeWidth={1.75} />
      </span>
    </button>
  );
}

/** Shown on other screens while a recording is still running. */
export function RecordingBanner() {
  const state = useRecorder((s) => s.state);
  const elapsed = useRecorder((s) => s.elapsed);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [ms, setMs] = useState(0);
  const live = state === "recording" || state === "paused" || state === "starting";
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setMs(elapsed()), 500);
    return () => clearInterval(t);
  }, [live, elapsed]);
  if (!live || pathname === "/record") return null;
  return (
    <Link
      to="/record"
      className="pt-safe fixed inset-x-0 top-0 z-40 mx-auto flex max-w-[480px] items-center justify-center gap-2 bg-amber px-4 pb-2 text-[14px] font-medium text-[var(--on-amber)]"
    >
      <span className="size-2 animate-pulse rounded-full bg-[var(--on-amber)]" />
      {state === "paused" ? "Recording paused" : "Recording"} {timer(ms)}. Tap to return.
    </Link>
  );
}
