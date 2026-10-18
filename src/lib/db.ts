import Dexie, { type Table } from "dexie";
import type { ServerFull, ServerStatus } from "./api";

/**
 * pending   saved on this phone, not yet on the server
 * synced    the server has it
 * rejected  the server refused it for good (shown with the reason)
 */
export type LocalSync = "pending" | "synced" | "rejected";

/** What this phone knows about the server copy. Transcript and notes arrive once they exist. */
export type ServerCopy = Partial<ServerFull> & { status: ServerStatus; updated_at: string };

export interface RecordingRow {
  id: string;
  recordedAt: number;
  durationMs: number;
  mimeType: string;
  size: number;
  /** The audio is stored on this phone. */
  hasAudio: boolean;
  sync: LocalSync;
  syncError: string | null;
  source: "app" | "recovered" | "earlier" | "server" | "imported";
  server: ServerCopy | null;
  /** updated_at of the last full copy fetched from the server. */
  detailAt: string | null;
  createdAt: number;
}

export interface AudioRow {
  id: string;
  data: Blob;
}

/** Audio pieces written while recording, so a crash loses at most a second. */
export interface ChunkRow {
  id: string;
  recId: string;
  seq: number;
  data: Blob;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

class RecorderDB extends Dexie {
  recordings!: Table<RecordingRow, string>;
  audio!: Table<AudioRow, string>;
  chunks!: Table<ChunkRow, string>;
  settings!: Table<SettingRow, string>;

  constructor() {
    super("alien-recorder");
    this.version(1).stores({
      recordings: "id, recordedAt, sync",
      audio: "id",
      chunks: "id, recId",
      settings: "key",
    });
  }
}

export const db = new RecorderDB();

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value });
}
