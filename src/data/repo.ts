import {
  db,
  type CaseRec,
  type CaseStatus,
  type CustodyEntry,
  type EntityKind,
  type EvidenceRec,
  type GeoPoint,
  type NoteRec,
  type SubjectRec,
} from "./db";
import type { Table } from "dexie";
import { normalizeCodename } from "./rules";
import { isEncrypted } from "./seal";

export const uid = () => crypto.randomUUID();

async function touch(caseId: string) {
  await db.cases.update(caseId, { lastActivityAt: Date.now() });
}

/** Throws unless the case exists and is Active. Every write goes through this. */
export async function assertWritable(caseId: string) {
  const c = await db.cases.get(caseId);
  if (!c) throw new Error("Case not found.");
  if (c.status !== "active") throw new Error("This case is not active. Reopen it to make changes.");
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const ALL = () => [db.cases, db.notes, db.subjects, db.links, db.evidence, db.boardPositions, db.blobs, db.settings];

/** The writability check and the write share one transaction, so nothing lands in a case that was sealed a moment earlier. */
function writeCase<T>(tables: Table[], fn: () => Promise<T>): Promise<T> {
  return db.transaction("rw", [db.cases, ...tables], fn);
}

// ---------- Settings ----------
export const settingsRepo = {
  async get<T>(key: string, fallback: T): Promise<T> {
    const r = await db.settings.get(key);
    return (r?.value as T) ?? fallback;
  },
  async set(key: string, value: unknown) {
    await db.settings.put({ key, value });
  },
};

// ---------- Cases ----------
export const caseRepo = {
  async create(codename: string): Promise<string> {
    const name = normalizeCodename(codename);
    if (!name) throw new Error("Enter a codename.");
    const now = Date.now();
    const id = uid();
    await db.cases.add({ id, codename: name, status: "active", createdAt: now, lastActivityAt: now, encryptionKeyRef: null, sample: false });
    return id;
  },
  async rename(id: string, codename: string) {
    const name = normalizeCodename(codename);
    if (!name) throw new Error("Enter a codename.");
    await db.cases.update(id, { codename: name, lastActivityAt: Date.now() });
  },
  /** Active or Archived. Sealing always means encryption (seal.ts), and an encrypted case reopens only through unsealCase. */
  async setStatus(id: string, status: CaseStatus) {
    if (status === "sealed") throw new Error("Seal a case with a passcode.");
    await db.transaction("rw", [db.cases], async () => {
      const c = await db.cases.get(id);
      if (!c) throw new Error("Case not found.");
      if (isEncrypted(c)) throw new Error("This case is encrypted. Unseal it with its passcode.");
      await db.cases.update(id, { status, lastActivityAt: Date.now() });
    });
  },
  async remove(id: string) {
    await db.transaction("rw", ALL(), async () => {
      const ev = await db.evidence.where("caseId").equals(id).toArray();
      const subs = await db.subjects.where("caseId").equals(id).toArray();
      await db.blobs.bulkDelete([...ev.flatMap((e) => [e.blobId, ...(e.thumbBlobId ? [e.thumbBlobId] : [])]), ...subs.flatMap((s) => (s.photoBlobId ? [s.photoBlobId] : []))]);
      await db.notes.where("caseId").equals(id).delete();
      await db.subjects.where("caseId").equals(id).delete();
      await db.links.where("caseId").equals(id).delete();
      await db.evidence.where("caseId").equals(id).delete();
      await db.boardPositions.where("caseId").equals(id).delete();
      await db.cases.delete(id);
    });
  },
};

// ---------- Notes ----------
export type NoteInput = Partial<Omit<NoteRec, "id" | "caseId" | "createdAt" | "updatedAt" | "sample">> & { type: NoteRec["type"] };

export const noteRepo = {
  async create(caseId: string, input: NoteInput): Promise<string> {
    const now = Date.now();
    const id = uid();
    await writeCase([db.notes], async () => {
      await assertWritable(caseId);
      await db.notes.add({
        id,
        caseId,
        title: "",
        body: "",
        transcript: "",
        durationMs: 0,
        location: null,
        attachmentIds: [],
        subjectIds: [],
        flagged: false,
        ...input,
        createdAt: now,
        updatedAt: now,
        sample: false,
      });
      await touch(caseId);
    });
    return id;
  },
  async update(id: string, patch: Partial<NoteRec>) {
    await writeCase([db.notes], async () => {
      const n = await db.notes.get(id);
      if (!n) throw new Error("Note not found.");
      await assertWritable(n.caseId);
      await db.notes.update(id, { ...patch, updatedAt: Date.now() });
      await touch(n.caseId);
    });
  },
  /** Adds a late GPS fix to a capture that was saved without one. */
  async attachLocation(id: string, p: GeoPoint) {
    await writeCase([db.notes, db.evidence], async () => {
      const n = await db.notes.get(id);
      if (!n || n.location) return;
      const c = await db.cases.get(n.caseId);
      if (c?.status !== "active") return;
      await db.notes.update(id, { location: p });
      for (const eid of n.attachmentIds) {
        const e = await db.evidence.get(eid);
        if (e && !e.gps) await db.evidence.update(eid, { gps: { lat: p.lat, lng: p.lng } });
      }
    });
  },
  async remove(id: string) {
    await writeCase([db.notes, db.links, db.boardPositions], async () => {
      const n = await db.notes.get(id);
      if (!n) return;
      await assertWritable(n.caseId);
      await db.links.where("fromId").equals(id).delete();
      await db.links.where("toId").equals(id).delete();
      await db.boardPositions.delete(id);
      await db.notes.delete(id);
      await touch(n.caseId);
    });
  },
};

// ---------- Subjects ----------
export const subjectRepo = {
  async create(caseId: string, name = "Unnamed subject"): Promise<string> {
    const id = uid();
    await writeCase([db.subjects], async () => {
      await assertWritable(caseId);
      await db.subjects.add({
        id,
        caseId,
        name,
        aliases: [],
        photoBlobId: null,
        lastSeen: { place: "", detail: "", at: null },
        coordinates: null,
        threatLevel: "undetermined",
        fields: [],
        redacted: [],
        sample: false,
      });
      await touch(caseId);
    });
    return id;
  },
  async update(id: string, patch: Partial<SubjectRec>) {
    await writeCase([db.subjects], async () => {
      const s = await db.subjects.get(id);
      if (!s) throw new Error("Subject not found.");
      await assertWritable(s.caseId);
      await db.subjects.update(id, patch);
      await touch(s.caseId);
    });
  },
  async setPhoto(id: string, file: Blob) {
    const blobId = uid();
    await writeCase([db.subjects, db.blobs], async () => {
      const s = await db.subjects.get(id);
      if (!s) throw new Error("Subject not found.");
      await assertWritable(s.caseId);
      await db.blobs.add({ id: blobId, data: file });
      if (s.photoBlobId) await db.blobs.delete(s.photoBlobId);
      await db.subjects.update(id, { photoBlobId: blobId });
      await touch(s.caseId);
    });
  },
  async remove(id: string) {
    await writeCase([db.subjects, db.links, db.notes, db.blobs, db.boardPositions], async () => {
      const s = await db.subjects.get(id);
      if (!s) return;
      await assertWritable(s.caseId);
      await db.links.where("fromId").equals(id).delete();
      await db.links.where("toId").equals(id).delete();
      const notes = await db.notes.where("subjectIds").equals(id).toArray();
      for (const n of notes) await db.notes.update(n.id, { subjectIds: n.subjectIds.filter((x) => x !== id) });
      if (s.photoBlobId) await db.blobs.delete(s.photoBlobId);
      await db.boardPositions.delete(id);
      await db.subjects.delete(id);
      await touch(s.caseId);
    });
  },
};

// ---------- Links ----------
export const linkRepo = {
  async create(caseId: string, from: { id: string; kind: EntityKind }, to: { id: string; kind: EntityKind }, label: string) {
    const id = uid();
    await writeCase([db.links], async () => {
      await assertWritable(caseId);
      if (from.id === to.id) throw new Error("An item cannot link to itself.");
      await db.links.add({ id, caseId, fromId: from.id, fromKind: from.kind, toId: to.id, toKind: to.kind, label: label.trim(), createdAt: Date.now() });
      await touch(caseId);
    });
    return id;
  },
  async update(id: string, label: string) {
    await writeCase([db.links], async () => {
      const l = await db.links.get(id);
      if (!l) return;
      await assertWritable(l.caseId);
      await db.links.update(id, { label: label.trim() });
      await touch(l.caseId);
    });
  },
  async remove(id: string) {
    await writeCase([db.links], async () => {
      const l = await db.links.get(id);
      if (!l) return;
      await assertWritable(l.caseId);
      await db.links.delete(id);
      await touch(l.caseId);
    });
  },
};

// ---------- Evidence ----------
export const evidenceRepo = {
  async addMedia(
    caseId: string,
    file: Blob,
    fileName: string,
    noteId: string | null,
    kind: EvidenceRec["kind"],
    meta: { exif?: Record<string, string>; gps?: { lat: number; lng: number } | null; thumb?: Blob | null; capturedAt?: number } = {},
  ): Promise<string> {
    await assertWritable(caseId); // fail before hashing; checked again where the write happens
    const sha = await sha256Hex(file);
    const blobId = uid();
    const thumbBlobId = meta.thumb ? uid() : null;
    const id = uid();
    const now = Date.now();
    const rec: EvidenceRec = {
      id, caseId, noteId, kind, blobId, thumbBlobId, fileName,
      mimeType: file.type || (kind === "photo" ? "image/jpeg" : "application/octet-stream"),
      size: file.size, sha256: sha, exif: meta.exif ?? {}, gps: meta.gps ?? null,
      capturedAt: meta.capturedAt ?? now,
      custody: [{ at: now, action: "captured", detail: `Captured on this device. SHA-256 ${sha.slice(0, 12)}... recorded.` }],
      sample: false,
    };
    await writeCase([db.blobs, db.evidence], async () => {
      await assertWritable(caseId);
      await db.blobs.add({ id: blobId, data: file });
      if (meta.thumb && thumbBlobId) await db.blobs.add({ id: thumbBlobId, data: meta.thumb });
      await db.evidence.add(rec);
      await touch(caseId);
    });
    return id;
  },
  /** Recompute the hash of the stored bytes and log the result. Encrypted evidence is verified in memory by its screen instead. */
  async verify(id: string): Promise<boolean> {
    const e = await db.evidence.get(id);
    if (!e) throw new Error("Evidence not found.");
    if (e.enc) throw new Error("This evidence is sealed. Open its case to verify it.");
    const b = await db.blobs.get(e.blobId);
    const ok = !!b && !b.iv && (await sha256Hex(b.data)) === e.sha256;
    const entry: CustodyEntry = { at: Date.now(), action: "verified", detail: ok ? "Integrity verified. Hash matches." : "Hash mismatch. Stored bytes differ from the capture record." };
    await db.transaction("rw", [db.evidence], async () => {
      const cur = await db.evidence.get(id);
      if (cur && !cur.enc) await db.evidence.update(id, { custody: [...cur.custody, entry] });
    });
    return ok;
  },
};

// ---------- Maintenance ----------
export const vaultRepo = {
  async clearSample() {
    await db.transaction("rw", ALL(), async () => {
      const sampleCases = (await db.cases.toArray()).filter((c) => c.sample).map((c) => c.id);
      const ev = (await db.evidence.toArray()).filter((e) => e.sample || sampleCases.includes(e.caseId));
      const subs = (await db.subjects.toArray()).filter((s) => s.sample || sampleCases.includes(s.caseId));
      await db.blobs.bulkDelete([...ev.flatMap((e) => [e.blobId, ...(e.thumbBlobId ? [e.thumbBlobId] : [])]), ...subs.flatMap((s) => (s.photoBlobId ? [s.photoBlobId] : []))]);
      await db.evidence.bulkDelete(ev.map((e) => e.id));
      await db.subjects.bulkDelete(subs.map((s) => s.id));
      const notes = (await db.notes.toArray()).filter((n) => n.sample || sampleCases.includes(n.caseId));
      await db.notes.bulkDelete(notes.map((n) => n.id));
      const gone = new Set([...ev.map((e) => e.id), ...subs.map((s) => s.id), ...notes.map((n) => n.id)]);
      const links = (await db.links.toArray()).filter((l) => l.sample || sampleCases.includes(l.caseId) || gone.has(l.fromId) || gone.has(l.toId));
      await db.links.bulkDelete(links.map((l) => l.id));
      await db.boardPositions.where("caseId").anyOf(sampleCases).delete();
      await db.cases.bulkDelete(sampleCases);
    });
  },
  async erase() {
    await db.transaction("rw", ALL(), async () => {
      await Promise.all(ALL().map((t) => t.clear()));
      await db.settings.put({ key: "seeded", value: true });
    });
  },
  async hasSample(): Promise<boolean> {
    return (await db.cases.filter((c: CaseRec) => c.sample).count()) > 0;
  },
};

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
