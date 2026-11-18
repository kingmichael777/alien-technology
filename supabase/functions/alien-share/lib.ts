// Pure helpers for alien-share: the link key and the page a link returns.
// No network here, so these can be tested on their own (lib_test.ts).

export type Segment = { speaker: string; start: number; end: number; text: string };
export type Transcript = { version: 1; segments: Segment[]; speakers: string[]; duration: number | null };
export type Notes = {
  version: 1;
  title: string;
  summary: string;
  key_points: string[];
  follow_ups: { task: string; who: string; when: string }[];
  details: { label: string; value: string }[];
  open_questions: string[];
};

export function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Compares two secrets without stopping at the first difference.
export function same(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return h ? `${h}:${mm}:${String(sec).padStart(2, "0")}` : `${mm}:${String(sec).padStart(2, "0")}`;
}

// The key at the end of a recording's link: its id without dashes, then the
// 40-character proof that the owner turned the link on.
export function shareKey(id: string, proof: string): string {
  return `${id.replace(/-/g, "")}${proof}`;
}

export function parseShareKey(key: string): { id: string; proof: string } | null {
  const m = key.toLowerCase().match(/^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})([0-9a-f]{40})$/);
  return m ? { id: `${m[1]}-${m[2]}-${m[3]}-${m[4]}-${m[5]}`, proof: m[6] } : null;
}

export function speakerLabel(id: string, names: Record<string, string> | null | undefined): string {
  const named = names?.[id]?.trim();
  if (named) return named;
  const n = Number(id.match(/(\d+)$/)?.[1] ?? NaN);
  return Number.isFinite(n) ? `Speaker ${n + 1}` : "Speaker";
}

function megabytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// A file name that is safe to type into a terminal.
export function audioFileName(title: string, recordedAt: string, ext: string): string {
  const day = Number.isFinite(Date.parse(recordedAt)) ? new Date(recordedAt).toISOString().slice(0, 10) : "recording";
  const words = title.replace(/[^\p{L}\p{N} ]+/gu, "").trim().replace(/\s+/g, "-").slice(0, 60);
  return `${day}-${words || "Recording"}.${ext}`;
}

// Everything about one recording as plain text: what a link for Claude returns.
export function shareDocument(r: {
  title: string;
  recorded: string;
  seconds: number;
  status: string;
  transcript: Transcript | null;
  notes: Notes | null;
  names: Record<string, string>;
  audio: { url: string; name: string; mime: string; bytes: number | null };
  expires: string;
}): string {
  const fill = (t: string) => t.replace(/\{\s*(speaker_\d+)\s*\}/g, (_, id: string) => speakerLabel(id, r.names));
  const speakers = (r.transcript?.speakers ?? []).map((s) => speakerLabel(s, r.names));
  const out: string[] = [
    "ALIEN TECHNOLOGY RECORDING",
    `Title: ${r.title}`,
    `Recorded: ${r.recorded}`,
    `Length: ${clock(r.seconds)}`,
  ];
  if (speakers.length) out.push(`Speakers: ${speakers.join(", ")}`);
  out.push(
    "",
    "AUDIO",
    `File: ${r.audio.name} (${r.audio.mime}${r.audio.bytes ? `, ${megabytes(r.audio.bytes)}` : ""})`,
    `Link: ${r.audio.url}`,
    `Download: curl -L -o "${r.audio.name}" "${r.audio.url}"`,
    `This page and the audio link work until ${r.expires}.`,
  );

  const n = r.notes;
  if (n) {
    out.push("", "NOTES");
    if (n.summary) out.push("Summary", fill(n.summary));
    if (n.key_points.length) out.push("", "Key points", ...n.key_points.map((p) => `- ${fill(p)}`));
    if (n.follow_ups.length) {
      out.push(
        "",
        "Follow-ups",
        ...n.follow_ups.map((x) => {
          const extra = [x.who && fill(x.who), x.when].filter(Boolean).join(", ");
          return `- ${fill(x.task)}${extra ? ` (${extra})` : ""}`;
        }),
      );
    }
    if (n.details.length) out.push("", "Details", ...n.details.map((d) => `- ${fill(d.label)}: ${fill(d.value)}`));
    if (n.open_questions.length) out.push("", "Open questions", ...n.open_questions.map((q) => `- ${fill(q)}`));
  }

  out.push("", "TRANSCRIPT");
  const segments = r.transcript?.segments ?? [];
  if (segments.length) {
    out.push(...segments.map((s) => `[${clock(s.start)}] ${speakerLabel(s.speaker, r.names)}: ${s.text}`));
  } else if (r.status === "ready") {
    out.push("No speech was heard in this recording.");
  } else if (r.status === "failed") {
    out.push("The transcript could not be written. Open the recording in the app and tap Try again.");
  } else {
    out.push("The transcript is still being written. Open this link again in a minute.");
  }
  return out.join("\n") + "\n";
}
