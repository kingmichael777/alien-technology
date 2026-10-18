// The microphone and the recording itself.
//
// start() must run inside the tap that asked for it: iPhones only allow the
// microphone and audio that way. While recording, every second of audio is
// also written to this phone's storage, so if the app is closed or crashes,
// the recording is put back together the next time it opens.

import { create } from "zustand";
import { db } from "./db";
import { saveRecording } from "./library";

export type RecState = "idle" | "starting" | "recording" | "paused" | "saving" | "denied" | "unsupported" | "error";

const TIMESLICE_MS = 1000;
const BEAT_MS = 4000;
const MAX_MS = 4 * 3600 * 1000;
const SESSION_KEY = "activeSession";

interface Session {
  id: string;
  startedAt: number;
  mimeType: string;
  elapsedMs: number;
  beat: number;
}

export function baseType(mime: string): string {
  return (mime.split(";")[0] || "audio/webm").trim().toLowerCase();
}

/** AAC in MP4 where it exists (every iPhone), otherwise Opus. */
export function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const options = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  for (const m of options) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return "";
}

interface RecorderStore {
  state: RecState;
  id: string | null;
  analyser: AnalyserNode | null;
  /** The phone took the microphone away for a moment (a call, Siri). */
  interrupted: boolean;
  /** Set when the recording stopped on its own; the screen explains it. */
  notice: string | null;
  savedId: string | null;
  start: () => void;
  pause: () => void;
  resume: () => void;
  elapsed: () => number;
  stop: () => Promise<string | null>;
  discard: () => Promise<void>;
  clearNotice: () => void;
}

// Live objects stay outside the store; the store holds what screens draw.
let stream: MediaStream | null = null;
let ctx: AudioContext | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let seq = 0;
let accumMs = 0;
let segStart = 0;
let startedAt = 0;
let mimeType = "";
let writes: Promise<unknown> = Promise.resolve();
let beatTimer: ReturnType<typeof setInterval> | null = null;
let wake: { release: () => Promise<void> } | null = null;

function elapsedNow(state: RecState): number {
  return state === "recording" ? accumMs + performance.now() - segStart : accumMs;
}

async function keepAwake() {
  try {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    };
    if (nav.wakeLock?.request && document.visibilityState === "visible") wake = await nav.wakeLock.request("screen");
  } catch {
    wake = null;
  }
}

function releaseWake() {
  void wake?.release().catch(() => undefined);
  wake = null;
}

function teardown() {
  if (beatTimer) clearInterval(beatTimer);
  beatTimer = null;
  stream?.getTracks().forEach((t) => {
    t.onended = null;
    t.onmute = null;
    t.onunmute = null;
    t.stop();
  });
  void ctx?.close().catch(() => undefined);
  releaseWake();
  stream = null;
  ctx = null;
  recorder = null;
  chunks = [];
  seq = 0;
  accumMs = 0;
}

function persistChunk(id: string, n: number, data: Blob) {
  writes = writes
    .then(() => db.chunks.put({ id: `${id}:${String(n).padStart(7, "0")}`, recId: id, seq: n, data }))
    .catch(() => undefined);
}

async function clearSession(id: string) {
  await writes;
  await db.chunks.where("recId").equals(id).delete();
  await db.settings.delete(SESSION_KEY);
}

export const useRecorder = create<RecorderStore>((set, get) => {
  const beat = () => {
    const { state, id } = get();
    if (!id || (state !== "recording" && state !== "paused")) return;
    const ms = elapsedNow(state);
    void db.settings.put({ key: SESSION_KEY, value: { id, startedAt, mimeType, elapsedMs: ms, beat: Date.now() } satisfies Session });
    if (ms >= MAX_MS) void autoStop("Recordings stop at 4 hours. This one is saved.");
  };

  const autoStop = async (notice: string) => {
    const id = await get().stop();
    set({ notice, savedId: id });
  };

  const onVisible = () => {
    const { state } = get();
    if (document.visibilityState !== "visible" || (state !== "recording" && state !== "paused")) return;
    void keepAwake();
    const track = stream?.getAudioTracks()[0];
    if (track && track.readyState === "ended") void autoStop("The phone stopped the microphone, so the recording ended. What was recorded is saved.");
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);

  return {
    state: "idle",
    id: null,
    analyser: null,
    interrupted: false,
    notice: null,
    savedId: null,

    start: () => {
      const s = get().state;
      if (s === "starting" || s === "recording" || s === "paused" || s === "saving") return;
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        set({ state: "unsupported" });
        return;
      }
      // Created inside the tap so iPhones let it run.
      try {
        const Ctx: typeof AudioContext =
          window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new Ctx();
        void ctx.resume();
      } catch {
        ctx = null;
      }
      const id = crypto.randomUUID();
      set({ state: "starting", id, analyser: null, interrupted: false, notice: null, savedId: null });

      navigator.mediaDevices
        .getUserMedia({
          // Call-style processing is tuned for one voice close to the phone; a
          // conversation across a table comes through better without it.
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 },
        })
        .then((media) => {
          if (get().state !== "starting" || get().id !== id) {
            media.getTracks().forEach((t) => t.stop());
            return;
          }
          stream = media;
          let analyser: AnalyserNode | null = null;
          if (ctx) {
            try {
              const src = ctx.createMediaStreamSource(media);
              analyser = ctx.createAnalyser();
              analyser.fftSize = 1024;
              src.connect(analyser);
            } catch {
              analyser = null;
            }
          }
          const mime = pickMime();
          let rec: MediaRecorder;
          try {
            rec = new MediaRecorder(media, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 48_000 });
          } catch {
            rec = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
          }
          recorder = rec;
          mimeType = rec.mimeType || mime || "audio/webm";
          chunks = [];
          seq = 0;
          accumMs = 0;
          rec.ondataavailable = (e) => {
            if (!e.data || e.data.size === 0) return;
            chunks.push(e.data);
            persistChunk(id, seq++, e.data);
          };
          rec.onerror = () => void autoStop("The microphone had a problem, so the recording ended. What was recorded is saved.");
          const track = media.getAudioTracks()[0];
          if (track) {
            track.onended = () => void autoStop("The phone stopped the microphone, so the recording ended. What was recorded is saved.");
            track.onmute = () => set({ interrupted: true });
            track.onunmute = () => set({ interrupted: false });
          }
          rec.start(TIMESLICE_MS);
          startedAt = Date.now();
          segStart = performance.now();
          set({ state: "recording", analyser });
          beat();
          beatTimer = setInterval(beat, BEAT_MS);
          void keepAwake();
        })
        .catch((e: DOMException) => {
          void ctx?.close().catch(() => undefined);
          ctx = null;
          set({ state: e?.name === "NotAllowedError" || e?.name === "SecurityError" ? "denied" : "error", id: null });
        });
    },

    pause: () => {
      const { state } = get();
      if (state !== "recording" || !recorder) return;
      try {
        recorder.pause();
      } catch {
        return;
      }
      accumMs += performance.now() - segStart;
      set({ state: "paused" });
      beat();
    },

    resume: () => {
      const { state } = get();
      if (state !== "paused" || !recorder) return;
      try {
        recorder.resume();
      } catch {
        return;
      }
      segStart = performance.now();
      set({ state: "recording" });
    },

    elapsed: () => elapsedNow(get().state),

    stop: async () => {
      const { state, id } = get();
      if (!recorder || !id || (state !== "recording" && state !== "paused")) return null;
      const durationMs = Math.round(elapsedNow(state));
      set({ state: "saving" });
      const rec = recorder;
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        try {
          rec.stop();
        } catch {
          resolve();
        }
        // Some phones never fire onstop if the microphone was already gone.
        setTimeout(resolve, 4000);
      });
      await writes;
      const type = baseType(mimeType);
      const blob = new Blob(chunks, { type });
      const recordedAt = startedAt;
      teardown();
      if (blob.size > 0) {
        await saveRecording({ id, recordedAt, durationMs, mimeType: type, blob, source: "app" });
      }
      await clearSession(id);
      set({ state: "idle", id: null, analyser: null, interrupted: false });
      return blob.size > 0 ? id : null;
    },

    discard: async () => {
      const { id } = get();
      if (recorder && recorder.state !== "inactive") {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        try {
          recorder.stop();
        } catch {
          // already stopped
        }
      }
      teardown();
      if (id) await clearSession(id);
      set({ state: "idle", id: null, analyser: null, interrupted: false });
    },

    clearNotice: () => set({ notice: null, savedId: null }),
  };
});

/**
 * Puts back together a recording that was cut off (the app closed or the
 * phone restarted mid-recording). Returns its id when one was saved.
 */
export async function recoverInterrupted(): Promise<string | null> {
  const row = await db.settings.get(SESSION_KEY);
  const s = row?.value as Session | undefined;
  if (!s) return null;
  const live = useRecorder.getState();
  if (live.id === s.id && live.state !== "idle") return null; // still recording here
  if (Date.now() - s.beat < BEAT_MS * 3) {
    // Another tab may still be recording. Look again once its heartbeat would have gone quiet.
    setTimeout(() => void recoverInterrupted(), BEAT_MS * 3);
    return null;
  }
  const pieces = await db.chunks.where("recId").equals(s.id).sortBy("seq");
  if (pieces.length > 0) {
    const type = baseType(s.mimeType);
    const blob = new Blob(
      pieces.map((p) => p.data),
      { type },
    );
    await saveRecording({
      id: s.id,
      recordedAt: s.startedAt,
      durationMs: Math.max(s.elapsedMs || 0, (pieces.length - 1) * TIMESLICE_MS),
      mimeType: type,
      blob,
      source: "recovered",
    });
  }
  await db.chunks.where("recId").equals(s.id).delete();
  await db.settings.delete(SESSION_KEY);
  return pieces.length > 0 ? s.id : null;
}
