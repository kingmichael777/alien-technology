import { create } from "zustand";
import type { GeoPoint } from "@/data/db";
import { startFix } from "@/lib/location";

export type RecStatus = "idle" | "starting" | "recording" | "paused" | "denied" | "unsupported" | "error";

interface CaptureState {
  status: RecStatus;
  stream: MediaStream | null;
  ctx: AudioContext | null;
  analyser: AnalyserNode | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  mimeType: string;
  accumMs: number;
  segStart: number;
  fix: Promise<GeoPoint | null> | null;
  /** Must be called directly from a tap handler (iOS audio rules). */
  start: () => void;
  pause: () => void;
  resume: () => void;
  elapsed: () => number;
  stop: () => Promise<{ blob: Blob; durationMs: number; mimeType: string; fix: Promise<GeoPoint | null> | null }>;
  discard: () => void;
}

export function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return "";
}

const blank = { status: "idle" as RecStatus, stream: null, ctx: null, analyser: null, recorder: null, chunks: [] as Blob[], mimeType: "", accumMs: 0, segStart: 0, fix: null };

export const useCapture = create<CaptureState>((set, get) => {
  const teardown = () => {
    const { stream, ctx } = get();
    stream?.getTracks().forEach((t) => t.stop());
    void ctx?.close().catch(() => {});
    set({ ...blank });
  };

  return {
    ...blank,
    start: () => {
      const s = get().status;
      if (s === "recording" || s === "paused" || s === "starting") return;
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        set({ status: "unsupported" });
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctx: typeof AudioContext = window.AudioContext ?? (window as any).webkitAudioContext;
      const ctx = new Ctx();
      void ctx.resume();
      const chunks: Blob[] = [];
      set({ ...blank, status: "starting", ctx, chunks, fix: startFix() });
      navigator.mediaDevices
        .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        .then((stream) => {
          if (get().status !== "starting") {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          src.connect(analyser);
          const mime = pickMime();
          const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
          recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
          recorder.start(250);
          set({ stream, analyser, recorder, mimeType: recorder.mimeType || mime || "audio/webm", segStart: performance.now(), status: "recording" });
        })
        .catch((e: DOMException) => {
          void ctx.close().catch(() => {});
          set({ ...blank, status: e?.name === "NotAllowedError" || e?.name === "SecurityError" ? "denied" : "error" });
        });
    },
    pause: () => {
      const { recorder, status, accumMs, segStart } = get();
      if (status !== "recording" || !recorder) return;
      recorder.pause();
      set({ status: "paused", accumMs: accumMs + performance.now() - segStart });
    },
    resume: () => {
      const { recorder, status } = get();
      if (status !== "paused" || !recorder) return;
      recorder.resume();
      set({ status: "recording", segStart: performance.now() });
    },
    elapsed: () => {
      const { status, accumMs, segStart } = get();
      return status === "recording" ? accumMs + performance.now() - segStart : accumMs;
    },
    stop: () =>
      new Promise((resolve, reject) => {
        const { recorder, chunks, mimeType, fix } = get();
        if (!recorder) return reject(new Error("Nothing is recording."));
        const durationMs = Math.round(get().elapsed());
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType.split(";")[0] ?? "" });
          teardown();
          resolve({ blob, durationMs, mimeType, fix });
        };
        recorder.stop();
      }),
    discard: () => {
      const { recorder } = get();
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      teardown();
    },
  };
});
