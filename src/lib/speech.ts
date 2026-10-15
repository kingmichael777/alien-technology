/* Web Speech API wrapper. Off by default; may send audio to Apple or Google speech servers. */
/* eslint-disable @typescript-eslint/no-explicit-any */

function Ctor(): any {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = () => !!Ctor();

export interface Transcriber {
  start: () => void;
  stop: () => void;
}

export function createTranscriber(onUpdate: (finalText: string, interim: string) => void, onFail: () => void, initial = ""): Transcriber | null {
  const C = Ctor();
  if (!C) return null;
  const rec = new C();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = navigator.language || "en-US";
  let active = false;
  let failed = false;
  let finalText = initial;

  rec.onresult = (e: any) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText = `${finalText} ${r[0].transcript}`.trim();
      else interim += r[0].transcript;
    }
    onUpdate(finalText, interim.trim());
  };
  rec.onerror = (e: any) => {
    if (["not-allowed", "audio-capture", "service-not-allowed", "language-not-supported"].includes(e.error)) {
      failed = true;
      active = false;
      onFail();
    }
  };
  rec.onend = () => {
    if (active && !failed) {
      try {
        rec.start();
      } catch {
        failed = true;
        onFail();
      }
    }
  };
  return {
    start() {
      active = true;
      try {
        rec.start();
      } catch {
        failed = true;
        onFail();
      }
    },
    stop() {
      active = false;
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}
