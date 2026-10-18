// Everything the screens can do to a recording.

import { api, ApiError, getCode, type ServerFull } from "./api";
import { db, type RecordingRow } from "./db";
import { kick, storeFull } from "./sync";

export async function saveRecording(r: {
  id: string;
  recordedAt: number;
  durationMs: number;
  mimeType: string;
  blob: Blob;
  source: RecordingRow["source"];
}) {
  await db.transaction("rw", db.recordings, db.audio, async () => {
    await db.audio.put({ id: r.id, data: r.blob });
    await db.recordings.put({
      id: r.id,
      recordedAt: r.recordedAt,
      durationMs: r.durationMs,
      mimeType: r.mimeType,
      size: r.blob.size,
      hasAudio: true,
      sync: "pending",
      syncError: null,
      source: r.source,
      server: null,
      detailAt: null,
      createdAt: Date.now(),
    });
  });
  kick();
}

function needServer() {
  if (!getCode()) throw new ApiError(401, "Connect this phone to your server first.");
  if (!navigator.onLine) throw new ApiError(0, "You're offline. Try again when you're connected.");
}

async function applyFull(full: ServerFull) {
  await storeFull([full]);
}

export async function renameRecording(row: RecordingRow, title: string) {
  needServer();
  const { recording } = await api.update(row.id, { title: title.trim() || null });
  await applyFull(recording);
}

export async function renameSpeaker(row: RecordingRow, speaker: string, name: string) {
  needServer();
  const names = { ...(row.server?.speaker_names ?? {}) };
  if (name.trim()) names[speaker] = name.trim();
  else delete names[speaker];
  // Show it right away; the server copy replaces it a moment later.
  if (row.server) await db.recordings.update(row.id, { server: { ...row.server, speaker_names: names } });
  try {
    const { recording } = await api.update(row.id, { speaker_names: names });
    await applyFull(recording);
  } catch (e) {
    if (row.server) await db.recordings.update(row.id, { server: row.server });
    throw e;
  }
}

/** Try a failed recording again, from wherever it stopped. */
export async function retryRecording(row: RecordingRow) {
  if (row.sync !== "synced") {
    await db.recordings.update(row.id, { sync: "pending", syncError: null });
    kick();
    return;
  }
  needServer();
  const light = await api.retry(row.id);
  if (row.server) await db.recordings.update(row.id, { server: { ...row.server, ...light } });
  kick();
}

export async function rewriteNotes(row: RecordingRow) {
  needServer();
  const light = await api.renote(row.id);
  if (row.server) await db.recordings.update(row.id, { server: { ...row.server, ...light } });
  kick();
}

// ---------------------------------------------------------------- adding a file

/** The audio formats your server can read, by file extension. */
const BY_EXTENSION: Record<string, string> = {
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  webm: "audio/webm",
};
const KNOWN_TYPES = new Set([
  "audio/mp4",
  "audio/aac",
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/wav",
  "video/mp4",
  "video/webm",
]);
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

/** The type to store a picked file as, or null when it isn't audio the server reads. */
export function fileType(name: string, type: string): string | null {
  let base = type.split(";")[0].trim().toLowerCase();
  if (base === "audio/m4a" || base === "audio/x-m4a") base = "audio/mp4";
  if (base === "audio/x-wav" || base === "audio/wave") base = "audio/wav";
  if (base === "audio/mp3") base = "audio/mpeg";
  if (KNOWN_TYPES.has(base)) return base;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[ext] ?? null;
}

function lengthOf(file: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    let done = false;
    const finish = (ms: number) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(ms);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0);
    audio.onerror = () => finish(0);
    setTimeout(() => finish(0), 6000);
    audio.src = url;
  });
}

/** Adds an audio file from the phone (a call recording, a voice memo) as a recording. */
export async function addFile(file: File): Promise<string> {
  const type = fileType(file.name, file.type);
  if (!type) throw new Error("That file isn't audio Alien can read. Pick an m4a, mp3, wav or similar file.");
  if (file.size === 0) throw new Error("That file is empty.");
  if (file.size > MAX_FILE_BYTES) throw new Error("That file is over 200 MB, which is too large to process.");
  const id = crypto.randomUUID();
  const durationMs = await lengthOf(file);
  const blob = file.type === type ? file : new Blob([file], { type });
  await saveRecording({ id, recordedAt: file.lastModified || Date.now(), durationMs, mimeType: type, blob, source: "imported" });
  return id;
}

/** Deletes the recording from this phone and from your server. */
export async function deleteRecording(row: RecordingRow) {
  const onServer = row.sync === "synced" || !!row.server;
  if (onServer) {
    needServer();
    try {
      await api.remove(row.id);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
    }
  } else if (getCode() && navigator.onLine) {
    // It may have started uploading; clear any half-made server copy too.
    await api.remove(row.id).catch(() => undefined);
  }
  await db.transaction("rw", db.recordings, db.audio, async () => {
    await db.recordings.delete(row.id);
    await db.audio.delete(row.id);
  });
}

/** Frees space: drops the phone's copy of audio the server already holds. */
export async function removeLocalAudio(): Promise<number> {
  const rows = await db.recordings.where("sync").equals("synced").toArray();
  let freed = 0;
  for (const r of rows) {
    if (!r.hasAudio || !r.server || r.server.status === "uploading") continue;
    const a = await db.audio.get(r.id);
    freed += a?.data.size ?? 0;
    await db.audio.delete(r.id);
    await db.recordings.update(r.id, { hasAudio: false });
  }
  return freed;
}

/** The recording's audio: from this phone when it has it, otherwise from your server. */
export async function audioSource(row: RecordingRow): Promise<{ url: string; revoke: boolean } | null> {
  const local = row.hasAudio ? await db.audio.get(row.id) : undefined;
  if (local) return { url: URL.createObjectURL(local.data), revoke: true };
  if (!getCode() || !navigator.onLine || !row.server || row.server.status === "uploading") return null;
  const { urls, mime_type } = await api.audio(row.id);
  if (urls.length === 1) return { url: urls[0], revoke: false };
  const pieces: Blob[] = [];
  for (const u of urls) pieces.push(await (await fetch(u)).blob());
  return { url: URL.createObjectURL(new Blob(pieces, { type: mime_type ?? row.mimeType })), revoke: true };
}

export async function audioBlob(row: RecordingRow): Promise<Blob | null> {
  const local = row.hasAudio ? await db.audio.get(row.id) : undefined;
  if (local) return local.data;
  const src = await audioSource(row);
  if (!src) return null;
  const blob = await (await fetch(src.url)).blob();
  if (src.revoke) URL.revokeObjectURL(src.url);
  return blob;
}

/** Opens a recording that isn't on this phone yet (a link from another device). */
export async function fetchRecording(id: string): Promise<boolean> {
  if (!getCode() || !navigator.onLine) return false;
  try {
    const { recording } = await api.get(id);
    await db.recordings.put({
      id: recording.id,
      recordedAt: Date.parse(recording.recorded_at),
      durationMs: recording.duration_ms,
      mimeType: recording.mime_type ?? "",
      size: recording.size_bytes ?? 0,
      hasAudio: false,
      sync: "synced",
      syncError: null,
      source: "server",
      server: { ...recording },
      detailAt: recording.updated_at,
      createdAt: Date.now(),
    });
    return true;
  } catch {
    return false;
  }
}
