import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getCode } from "./api";
import { db, type RecordingRow } from "./db";

/** Newest first. Undefined while the first read is in flight. */
export function useRecordings(): RecordingRow[] | undefined {
  return useLiveQuery(() => db.recordings.orderBy("recordedAt").reverse().toArray(), []);
}

/** Null when there is no such recording on this phone. */
export function useRecording(id: string): RecordingRow | null | undefined {
  return useLiveQuery(async () => (await db.recordings.get(id)) ?? null, [id]);
}

export function useSetting<T>(key: string, fallback: T): T {
  const v = useLiveQuery(async () => (await db.settings.get(key))?.value as T | undefined, [key]);
  return v === undefined ? fallback : v;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** True when an access code is saved on this phone. */
export function useConnected(): boolean {
  const [connected, setConnected] = useState(() => !!getCode());
  useEffect(() => {
    const update = () => setConnected(!!getCode());
    window.addEventListener("alien:code", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("alien:code", update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return connected;
}

export function useStorageUse(): { count: number; bytes: number } | undefined {
  return useLiveQuery(async () => {
    const rows = await db.recordings.toArray();
    let bytes = 0;
    let count = 0;
    for (const r of rows) {
      if (!r.hasAudio) continue;
      count++;
      bytes += r.size;
    }
    return { count, bytes };
  }, []);
}
