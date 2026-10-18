// Database, storage and input checks for alien-tech. Everything here talks to
// this project's own database and private storage with the service key.

import type { Notes, Transcript } from "./lib.ts";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
export const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const REST = `${SUPABASE_URL}/rest/v1/alien_recordings`;
const STORAGE = `${SUPABASE_URL}/storage/v1`;
const BUCKET = "alien-recordings";

export const EXTENSIONS: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export type Status = "uploading" | "uploaded" | "processing" | "ready" | "failed";
export type Step = "transcribe" | "notes";

export type Row = {
  id: string;
  created_at: string;
  updated_at: string;
  recorded_at: string;
  duration_ms: number;
  mime_type: string | null;
  size_bytes: number | null;
  audio_path: string | null;
  parts: number;
  time_zone: string | null;
  status: Status;
  stage: string | null;
  error: string | null;
  title: string | null;
  language: string | null;
  transcript: Transcript | null;
  transcript_text: string | null;
  notes: Notes | null;
  speaker_names: Record<string, string>;
  attempts: number;
  processing_started_at: string | null;
};

// A problem the app can show to the person as it is.
export class Problem extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------- database

export function serviceHeaders(): Record<string, string> {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
}

export async function getRow(id: string): Promise<Row | null> {
  const res = await fetch(`${REST}?id=eq.${id}&select=*`, { headers: serviceHeaders() });
  if (!res.ok) throw new Error(`select ${res.status}: ${await res.text()}`);
  const rows = (await res.json()) as Row[];
  return rows[0] ?? null;
}

export async function mustGet(id: string): Promise<Row> {
  const row = await getRow(id);
  if (!row) throw new Problem(404, "That recording wasn't found.");
  return row;
}

export async function patch(id: string, changes: Partial<Row>, filter = ""): Promise<Row | null> {
  const res = await fetch(`${REST}?id=eq.${id}${filter}`, {
    method: "PATCH",
    headers: { ...serviceHeaders(), "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(changes),
  });
  if (!res.ok) throw new Error(`update ${res.status}: ${await res.text()}`);
  const rows = (await res.json()) as Row[];
  return rows[0] ?? null;
}

export function light(row: Row) {
  return {
    id: row.id,
    recorded_at: row.recorded_at,
    duration_ms: row.duration_ms,
    status: row.status,
    stage: row.stage,
    error: row.error,
    title: row.title,
    ai_title: row.notes?.title ?? null,
    summary: row.notes?.summary ?? null,
    speaker_names: row.speaker_names ?? {},
    updated_at: row.updated_at,
    parts: row.parts,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
  };
}

export function full(row: Row) {
  return {
    ...light(row),
    language: row.language,
    transcript: row.transcript,
    notes: row.notes,
    time_zone: row.time_zone,
  };
}

// ---------------------------------------------------------------- storage

export function partPaths(row: Pick<Row, "id" | "parts" | "mime_type">): string[] {
  const ext = EXTENSIONS[row.mime_type ?? ""] ?? "m4a";
  return Array.from({ length: Math.max(1, row.parts || 1) }, (_, i) => `${row.id}/part-${i}.${ext}`);
}

export async function signUpload(path: string): Promise<string> {
  const res = await fetch(`${STORAGE}/object/upload/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: { ...serviceHeaders(), "x-upsert": "true" },
  });
  if (!res.ok) throw new Error(`sign upload ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { url?: string };
  if (!data.url) throw new Error("sign upload returned no url");
  return `${STORAGE}${data.url}`;
}

export async function signDownload(path: string, expiresIn: number): Promise<string> {
  const res = await fetch(`${STORAGE}/object/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: { ...serviceHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) throw new Error(`sign download ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { signedURL?: string; signedUrl?: string };
  const signed = data.signedURL ?? data.signedUrl;
  if (!signed) throw new Error("sign download returned no url");
  return `${STORAGE}${signed}`;
}

export async function listObjects(folder: string): Promise<{ name: string; metadata: { size?: number } | null }[]> {
  const res = await fetch(`${STORAGE}/object/list/${BUCKET}`, {
    method: "POST",
    headers: { ...serviceHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: folder, limit: 100, offset: 0, sortBy: { column: "name", order: "asc" } }),
  });
  if (!res.ok) throw new Error(`list objects ${res.status}: ${await res.text()}`);
  return await res.json();
}

export async function removeObjects(paths: string[]): Promise<void> {
  const res = await fetch(`${STORAGE}/object/${BUCKET}`, {
    method: "DELETE",
    headers: { ...serviceHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!res.ok) throw new Error(`remove objects ${res.status}: ${await res.text()}`);
  await res.body?.cancel();
}

export async function download(path: string): Promise<Blob> {
  const res = await fetch(`${STORAGE}/object/authenticated/${BUCKET}/${path}`, { headers: serviceHeaders() });
  if (!res.ok) throw new Error(`download ${res.status}: ${await res.text()}`);
  return await res.blob();
}

// ---------------------------------------------------------------- input checks

export function uuid(value: unknown): string {
  if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return value.toLowerCase();
  }
  throw new Problem(400, "That recording id looks wrong.");
}

export function int(value: unknown, min: number, max: number, message: string): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) throw new Problem(400, message);
  return Math.round(n);
}

export function isoDate(value: unknown): string {
  const t = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(t)) throw new Problem(400, "The recording time looks wrong.");
  return new Date(t).toISOString();
}

export function zone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

export function baseMime(value: unknown): string {
  return typeof value === "string" ? value.split(";")[0].trim().toLowerCase() : "";
}

export function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}
