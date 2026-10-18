// Turning a recording into what the screens show: names, titles, status lines,
// search matches and the plain text used for sharing.

import type { Notes, Transcript } from "./api";
import type { RecordingRow } from "./db";
import { length, longWhen, stamp } from "./format";

export type Names = Record<string, string>;

/** speaker_0 becomes "Speaker 1" until someone gives it a name. */
export function speakerName(id: string, names: Names | null | undefined): string {
  const named = names?.[id]?.trim();
  if (named) return named;
  const n = Number(id.match(/(\d+)$/)?.[1] ?? NaN);
  return Number.isFinite(n) ? `Speaker ${n + 1}` : "Speaker";
}

/** Notes refer to speakers as {speaker_0}; show their names instead. */
export function fillSpeakers(text: string, names: Names | null | undefined): string {
  return text.replace(/\{\s*(speaker_\d+)\s*\}/g, (_, id: string) => speakerName(id, names));
}

export function displayTitle(row: RecordingRow): string {
  const s = row.server;
  return s?.title?.trim() || s?.ai_title?.trim() || s?.notes?.title?.trim() || "Recording";
}

export function hasRealTitle(row: RecordingRow): boolean {
  return displayTitle(row) !== "Recording";
}

export function speakerCount(row: RecordingRow): number {
  return row.server?.transcript?.speakers.length ?? 0;
}

// ---------------------------------------------------------------- status

export type Phase =
  | { kind: "ready" }
  | { kind: "local"; text: string; busy: boolean; progress?: number }
  | { kind: "working"; text: string }
  | { kind: "failed"; text: string; retry: "upload" | "server" };

export function phaseOf(
  row: RecordingRow,
  ctx: { connected: boolean; online: boolean; progress?: number },
): Phase {
  if (row.sync === "rejected") {
    return { kind: "failed", text: row.syncError || "This recording couldn't be uploaded.", retry: "upload" };
  }
  if (row.sync === "pending") {
    if (!ctx.connected) return { kind: "local", text: "Saved on this phone. Connect this phone to get notes.", busy: false };
    if (!ctx.online) return { kind: "local", text: "Saved on this phone. It uploads when you're online.", busy: false };
    if (ctx.progress !== undefined) {
      return { kind: "local", text: `Uploading ${Math.min(99, Math.floor(ctx.progress * 100))}%`, busy: true, progress: ctx.progress };
    }
    if (row.syncError) return { kind: "local", text: `Waiting to upload. ${row.syncError}`, busy: false };
    return { kind: "local", text: "Waiting to upload", busy: true };
  }
  const s = row.server;
  if (!s) return { kind: "working", text: "Checking your server" };
  switch (s.status) {
    case "uploading":
      return { kind: "working", text: row.hasAudio ? "Finishing the upload" : "Uploading from another device" };
    case "uploaded":
      return { kind: "working", text: "Starting" };
    case "processing":
      return { kind: "working", text: s.stage === "transcribing" ? "Writing the transcript" : "Writing the notes" };
    case "failed":
      return { kind: "failed", text: s.error || "Something went wrong on your server.", retry: "server" };
    default:
      return { kind: "ready" };
  }
}

// ---------------------------------------------------------------- search

/** Everything a search can match, in one lowercase string. */
export function searchText(row: RecordingRow): string {
  const s = row.server;
  const names = s?.speaker_names ?? {};
  const n = s?.notes;
  const parts = [displayTitle(row), s?.summary ?? "", Object.values(names).join(" ")];
  if (n) {
    parts.push(
      n.summary,
      ...n.key_points,
      ...n.follow_ups.map((f) => `${f.task} ${f.who} ${f.when}`),
      ...n.details.map((d) => `${d.label} ${d.value}`),
      ...n.open_questions,
    );
  }
  for (const seg of s?.transcript?.segments ?? []) parts.push(seg.text);
  return fillSpeakers(parts.join("\n"), names).toLowerCase();
}

export function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).map((t) => t.trim()).filter((t) => t.length > 0);
}

export function matches(row: RecordingRow, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const hay = searchText(row);
  return terms.every((t) => hay.includes(t));
}

/** A short piece of text around the first match, for the results list. */
export function snippet(row: RecordingRow, terms: string[], width = 120): string | null {
  if (terms.length === 0) return null;
  const s = row.server;
  const names = s?.speaker_names ?? {};
  const sources: { prefix: string; text: string }[] = [
    { prefix: "", text: s?.notes?.summary ?? s?.summary ?? "" },
    ...(s?.notes?.key_points ?? []).map((text) => ({ prefix: "", text })),
    ...(s?.notes?.details ?? []).map((d) => ({ prefix: `${d.label}: `, text: d.value })),
    ...(s?.notes?.follow_ups ?? []).map((f) => ({ prefix: "", text: f.task })),
    ...(s?.transcript?.segments ?? []).map((seg) => ({ prefix: `${speakerName(seg.speaker, names)}: `, text: seg.text })),
  ];
  for (const src of sources) {
    const text = fillSpeakers(src.text, names);
    const at = text.toLowerCase().indexOf(terms[0]);
    if (at < 0) continue;
    const start = at < width / 2 ? 0 : at - Math.floor(width / 3);
    const end = Math.min(text.length, start + width);
    return `${fillSpeakers(src.prefix, names)}${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
  }
  return null;
}

// ---------------------------------------------------------------- sharing

export function notesText(notes: Notes, names: Names): string {
  const f = (t: string) => fillSpeakers(t, names);
  const out: string[] = [];
  if (notes.summary) out.push("Summary", f(notes.summary), "");
  if (notes.key_points.length) out.push("Key points", ...notes.key_points.map((p) => `- ${f(p)}`), "");
  if (notes.follow_ups.length) {
    out.push(
      "Follow-ups",
      ...notes.follow_ups.map((x) => {
        const extra = [x.who && f(x.who), x.when].filter(Boolean).join(", ");
        return `- ${f(x.task)}${extra ? ` (${extra})` : ""}`;
      }),
      "",
    );
  }
  if (notes.details.length) out.push("Details", ...notes.details.map((d) => `- ${f(d.label)}: ${f(d.value)}`), "");
  if (notes.open_questions.length) out.push("Open questions", ...notes.open_questions.map((q) => `- ${f(q)}`), "");
  return out.join("\n").trim();
}

export function transcriptText(transcript: Transcript, names: Names): string {
  return transcript.segments.map((s) => `[${stamp(s.start)}] ${speakerName(s.speaker, names)}: ${s.text}`).join("\n");
}

export function shareText(row: RecordingRow, opts: { transcript: boolean }): string {
  const s = row.server;
  const names = s?.speaker_names ?? {};
  const head = [displayTitle(row), `${longWhen(row.recordedAt)} · ${length(row.durationMs)}`];
  const body: string[] = [];
  if (s?.notes) body.push(notesText(s.notes, names));
  if (opts.transcript && s?.transcript?.segments.length) body.push(`Transcript\n${transcriptText(s.transcript, names)}`);
  return [head.join("\n"), ...body].join("\n\n").trim() + "\n";
}

export function fileName(row: RecordingRow, ext: string): string {
  const d = new Date(row.recordedAt);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const title = displayTitle(row).replace(/[^\p{L}\p{N} ]+/gu, "").trim().replace(/\s+/g, " ").slice(0, 60);
  return `${date} ${title || "Recording"}.${ext}`;
}

export function extensionFor(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  if (base.includes("mp4") || base.includes("m4a") || base === "audio/aac") return "m4a";
  if (base.includes("webm")) return "webm";
  if (base.includes("ogg")) return "ogg";
  if (base.includes("mpeg")) return "mp3";
  if (base.includes("wav")) return "wav";
  return "audio";
}
