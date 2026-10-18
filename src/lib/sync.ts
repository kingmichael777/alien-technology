// Keeps this phone and your server in step:
//   1. uploads recordings saved on this phone, oldest first
//   2. reads the server's list and merges it in (status, titles, names)
//   3. fetches transcripts and notes once they exist
// It runs after every recording, when the phone comes back online, when the
// app comes to the front, every few seconds while something is processing,
// and once a minute otherwise.

import { create } from "zustand";
import { api, ApiError, getCode, putFile, type ServerFull, type ServerLight } from "./api";
import { db, type RecordingRow, type ServerCopy } from "./db";

/** Parts stay under the server's 50 MB storage limit. */
export const PART_BYTES = 40 * 1024 * 1024;
const FAST_MS = 3000;
const SLOW_MS = 60_000;

interface SyncState {
  /** Upload progress by recording id, from 0 to 1. */
  progress: Record<string, number>;
  /** The server refused the access code saved on this phone. */
  codeRefused: boolean;
  lastError: string | null;
  lastSyncAt: number | null;
}

export const useSync = create<SyncState>(() => ({ progress: {}, codeRefused: false, lastError: null, lastSyncAt: null }));

const setProgress = (id: string, value: number | null) =>
  useSync.setState((s) => {
    const progress = { ...s.progress };
    if (value === null) delete progress[id];
    else progress[id] = value;
    return { progress };
  });

let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Run a sync pass now (or right after the one in progress). */
export function kick() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (running) {
    again = true;
    return;
  }
  running = true;
  void (async () => {
    try {
      do {
        again = false;
        await pass();
      } while (again);
    } finally {
      running = false;
      await schedule();
    }
  })();
}

async function schedule() {
  if (timer) clearTimeout(timer);
  if (!getCode()) return;
  const rows = await db.recordings.toArray();
  const busy = rows.some(
    (r) =>
      (r.sync === "pending" && navigator.onLine) ||
      (r.server && (r.server.status === "uploaded" || r.server.status === "processing")) ||
      (r.server?.status === "uploading" && r.hasAudio),
  );
  timer = setTimeout(kick, busy ? FAST_MS : SLOW_MS);
}

let started = false;

/** Wire up the triggers once, from the app shell. */
export function startSync() {
  if (started) return;
  started = true;
  window.addEventListener("online", kick);
  window.addEventListener("alien:code", kick);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") kick();
  });
  kick();
}

async function pass() {
  if (!getCode() || !navigator.onLine) return;
  try {
    await uploadPending();
    const { recordings } = await api.list();
    await merge(recordings);
    await fetchDetails();
    useSync.setState({ codeRefused: false, lastError: null, lastSyncAt: Date.now() });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) useSync.setState({ codeRefused: true });
    useSync.setState({ lastError: e instanceof Error ? e.message : String(e) });
  }
}

// ---------------------------------------------------------------- uploads

async function uploadPending() {
  const pending = (await db.recordings.where("sync").equals("pending").toArray()).sort((a, b) => a.recordedAt - b.recordedAt);
  for (const row of pending) {
    try {
      await upload(row);
    } catch (e) {
      setProgress(row.id, null);
      const status = e instanceof ApiError ? e.status : -1;
      const message = e instanceof Error ? e.message : "The upload failed. It will try again.";
      if (status === 401) throw e; // wrong code: stop and say so
      const permanent = status === 413 || status === 415;
      await db.recordings.update(row.id, { sync: permanent ? "rejected" : "pending", syncError: message });
      if (status === 0) return; // offline or unreachable: try the rest later
    }
  }
}

async function upload(row: RecordingRow) {
  const audio = await db.audio.get(row.id);
  if (!audio) {
    await db.recordings.update(row.id, { sync: "rejected", syncError: "The audio for this recording is missing on this phone." });
    return;
  }
  const blob = audio.data;
  const parts = Math.max(1, Math.ceil(blob.size / PART_BYTES));
  setProgress(row.id, 0);
  const begun = await api.begin({
    id: row.id,
    recorded_at: new Date(row.recordedAt).toISOString(),
    duration_ms: Math.round(row.durationMs),
    mime_type: row.mimeType,
    size_bytes: blob.size,
    parts,
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles",
  });
  let sent = 0;
  for (let i = 0; i < begun.uploads.length; i++) {
    const piece = blob.slice(i * PART_BYTES, (i + 1) * PART_BYTES);
    await putFile(begun.uploads[i].url, piece, begun.content_type || row.mimeType.split(";")[0], (n) =>
      setProgress(row.id, (sent + n) / blob.size),
    );
    sent += piece.size;
  }
  const light = await api.uploaded(row.id);
  setProgress(row.id, null);
  await db.recordings.update(row.id, { sync: "synced", syncError: null, server: copyFrom(row.server, light) });
}

// ---------------------------------------------------------------- merging

/** Light fields replace what we had; transcript and notes stay until a fresh full copy arrives. */
function copyFrom(prev: ServerCopy | null, next: ServerLight | ServerFull): ServerCopy {
  return { ...(prev ?? {}), ...next };
}

export async function merge(serverRows: ServerLight[]) {
  const onServer = new Set(serverRows.map((r) => r.id));
  await db.transaction("rw", db.recordings, db.audio, async () => {
    for (const s of serverRows) {
      const local = await db.recordings.get(s.id);
      if (!local) {
        await db.recordings.add({
          id: s.id,
          recordedAt: Date.parse(s.recorded_at),
          durationMs: s.duration_ms,
          mimeType: s.mime_type ?? "",
          size: s.size_bytes ?? 0,
          hasAudio: false,
          sync: "synced",
          syncError: null,
          source: "server",
          server: copyFrom(null, s),
          detailAt: null,
          createdAt: Date.now(),
        });
        continue;
      }
      const changes: Partial<RecordingRow> = { server: copyFrom(local.server, s) };
      // The server already has the audio, even if this phone missed the moment it finished.
      if (local.sync === "pending" && s.status !== "uploading") {
        changes.sync = "synced";
        changes.syncError = null;
      }
      // The server is waiting for audio this phone holds: send it again.
      if (local.sync === "synced" && local.hasAudio && s.status === "uploading") {
        changes.sync = "pending";
        changes.syncError = null;
      }
      await db.recordings.update(s.id, changes);
    }
    // Gone from the server. When this phone still holds the audio, nothing is
    // lost: it uploads again. Only a copy without audio here is removed.
    const synced = await db.recordings.where("sync").equals("synced").toArray();
    for (const r of synced) {
      if (onServer.has(r.id)) continue;
      if (r.hasAudio) {
        await db.recordings.update(r.id, { sync: "pending", syncError: null });
        continue;
      }
      await db.recordings.delete(r.id);
      await db.audio.delete(r.id);
    }
  });
}

/** Which recordings need their transcript or notes fetched again. */
export function needsDetail(r: RecordingRow): boolean {
  const s = r.server;
  if (!s || s.updated_at === r.detailAt) return false;
  if (s.status === "ready" || s.status === "failed") return true;
  return s.status === "processing" && (s.stage === "notes" || s.stage === "queued_notes");
}

async function fetchDetails() {
  const want = (await db.recordings.toArray()).filter(needsDetail).map((r) => r.id);
  for (let i = 0; i < want.length; i += 20) {
    const { recordings } = await api.getMany(want.slice(i, i + 20));
    await storeFull(recordings);
  }
}

export async function storeFull(rows: ServerFull[]) {
  await db.transaction("rw", db.recordings, async () => {
    for (const full of rows) {
      const local = await db.recordings.get(full.id);
      if (!local) continue;
      await db.recordings.update(full.id, { server: copyFrom(local.server, full), detailAt: full.updated_at });
    }
  });
}
