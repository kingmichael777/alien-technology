import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getSession, type Session } from "./api";
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

/** The account signed in on this phone, or null. */
export function useSession(): Session | null {
  const [session, setValue] = useState(() => getSession());
  useEffect(() => {
    const update = () => setValue(getSession());
    window.addEventListener("alien:session", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("alien:session", update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return session;
}

/** True when someone is signed in on this phone. */
export function useConnected(): boolean {
  return useSession() !== null;
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
