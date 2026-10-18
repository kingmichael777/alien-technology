// The first version of this app was a notebook that kept its records in a
// database called "alien-technology", seeded with made-up sample cases.
// On first launch of the recorder:
//   - voice notes you recorded yourself become recordings here (and get notes)
//   - the made-up sample data is deleted
//   - anything else you wrote yourself is kept, and Settings offers it as a file
// Nothing you made is deleted.

import Dexie from "dexie";
import { getSetting, setSetting } from "./db";
import { saveRecording } from "./library";
import { baseType } from "./recorder";

const OLD_DB = "alien-technology";
const DONE_KEY = "earlierImported";

interface OldNote {
  id: string;
  caseId: string;
  type: "text" | "voice" | "photo" | "location";
  title: string;
  body: string;
  transcript: string;
  durationMs: number;
  createdAt: number;
  attachmentIds: string[];
  enc?: unknown;
  sample: boolean;
}
interface OldEvidence {
  id: string;
  noteId: string | null;
  kind: "photo" | "audio" | "file";
  blobId: string;
  mimeType: string;
  capturedAt: number;
  enc?: unknown;
  sample: boolean;
}
interface OldBlob {
  id: string;
  data: Blob;
  iv?: string;
}
interface OldCase {
  id: string;
  codename: string;
  sample: boolean;
}

async function openOld(): Promise<Dexie | null> {
  if (!(await Dexie.exists(OLD_DB))) return null;
  const old = new Dexie(OLD_DB);
  await old.open(); // no schema given: opens whatever is there, read as-is
  return old;
}

async function own<T extends { sample?: boolean }>(old: Dexie, table: string): Promise<T[]> {
  if (!old.tables.some((t) => t.name === table)) return [];
  return ((await old.table(table).toArray()) as T[]).filter((r) => !r.sample);
}

/** Runs once. Returns how many earlier voice notes became recordings. */
export async function importEarlier(): Promise<number> {
  if (await getSetting(DONE_KEY, false)) return 0;
  let old: Dexie | null = null;
  let imported = 0;
  try {
    old = await openOld();
    if (!old) {
      await setSetting(DONE_KEY, true);
      return 0;
    }
    const notes = await own<OldNote>(old, "notes");
    const evidence = await own<OldEvidence>(old, "evidence");
    const cases = await own<OldCase>(old, "cases");

    for (const n of notes) {
      if (n.type !== "voice" || n.enc) continue;
      const ev = evidence.find((e) => e.kind === "audio" && !e.enc && (e.noteId === n.id || n.attachmentIds.includes(e.id)));
      if (!ev) continue;
      const blob = (await old.table("blobs").get(ev.blobId)) as OldBlob | undefined;
      if (!blob || blob.iv || !blob.data?.size) continue;
      await saveRecording({
        id: crypto.randomUUID(),
        recordedAt: ev.capturedAt || n.createdAt,
        durationMs: n.durationMs || 0,
        mimeType: baseType(ev.mimeType || blob.data.type || "audio/mp4"),
        blob: blob.data,
        source: "earlier",
      });
      imported++;
    }

    const keep = notes.length > 0 || evidence.length > 0 || cases.length > 0;
    old.close();
    old = null;
    await setSetting(DONE_KEY, true);
    // Only made-up sample data was there: remove it completely. (An old tab
    // still open can hold this up; it finishes when that tab closes.)
    if (!keep) void Dexie.delete(OLD_DB).catch(() => undefined);
  } catch {
    // Leave everything as it was; it will be tried again next launch.
  } finally {
    old?.close();
  }
  return imported;
}

/** Notes you wrote in the earlier version, as one plain text file. Null when there are none. */
export async function earlierNotesFile(): Promise<{ count: number; text: string } | null> {
  let old: Dexie | null = null;
  try {
    old = await openOld();
    if (!old) return null;
    const notes = (await own<OldNote>(old, "notes")).filter((n) => !n.enc).sort((a, b) => a.createdAt - b.createdAt);
    const cases = await own<OldCase>(old, "cases");
    if (notes.length === 0) return null;
    const caseName = new Map(cases.map((c) => [c.id, c.codename]));
    const lines: string[] = ["Notes from the earlier version of Alien Technology", ""];
    for (const n of notes) {
      lines.push(`${new Date(n.createdAt).toLocaleString("en-US")}${caseName.get(n.caseId) ? ` · ${caseName.get(n.caseId)}` : ""} · ${n.type}`);
      if (n.title) lines.push(n.title);
      if (n.body) lines.push(n.body);
      if (n.transcript) lines.push(n.transcript);
      lines.push("");
    }
    return { count: notes.length, text: lines.join("\n") };
  } catch {
    return null;
  } finally {
    old?.close();
  }
}
