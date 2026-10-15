import { db, type BlobRec, type CaseRec, type EvidenceRec, type LinkRec, type NoteRec, type SubjectRec } from "./db";
import {
  b64,
  decryptBytes,
  decryptJSON,
  deriveKey,
  encryptBytes,
  encryptJSON,
  packMedia,
  PBKDF2_ITERATIONS,
  randomBytes,
  unb64,
  unpackMedia,
  VERIFIER,
  type KeyRef,
  type Sealed,
} from "@/lib/crypto";
import type { Bundle } from "@/store/unlocked";

export const MIN_PASSCODE = 6;
export const MAX_TRIES = 5;
export const LOCKOUT_MS = 30_000;

export function keyRefOf(c: CaseRec | null | undefined): KeyRef | null {
  if (!c?.encryptionKeyRef) return null;
  try {
    const r = JSON.parse(c.encryptionKeyRef) as KeyRef;
    return r && typeof r.salt === "string" && r.verifier ? r : null;
  } catch {
    return null;
  }
}
export const isEncrypted = (c: CaseRec | null | undefined) => !!keyRefOf(c);

/** Authenticated label for each ciphertext: it only opens under the record id it was sealed for. */
export const aadFor = (kind: "case" | "note" | "subject" | "link" | "evidence" | "blob", id: string) => `alien-technology/${kind}/${id}`;

// ---- wrong passcode throttling (memory only) ----
const tries = new Map<string, { fails: number; until: number }>();
export function lockoutRemaining(caseId: string, now = Date.now()): number {
  const t = tries.get(caseId);
  return t ? Math.max(0, t.until - now) : 0;
}
export const lockoutMessage = (ms: number) => `Wait ${Math.ceil(ms / 1000)} seconds before trying again.`;
function fail(caseId: string) {
  const t = tries.get(caseId) ?? { fails: 0, until: 0 };
  t.fails++;
  if (t.fails >= MAX_TRIES) {
    t.until = Date.now() + LOCKOUT_MS;
    t.fails = 0;
  }
  tries.set(caseId, t);
}

async function unlockKey(c: CaseRec, passcode: string): Promise<CryptoKey> {
  const ref = keyRefOf(c);
  if (!ref) throw new Error("This case is not encrypted.");
  const wait = lockoutRemaining(c.id);
  if (wait > 0) throw new Error(lockoutMessage(wait));
  const key = await deriveKey(passcode, unb64(ref.salt), ref.iterations);
  try {
    const v = await decryptJSON<string>(key, ref.verifier, aadFor("case", c.id));
    if (v !== VERIFIER) throw new Error();
  } catch {
    fail(c.id);
    throw new Error("Passcode incorrect.");
  }
  tries.delete(c.id);
  return key;
}

// ---- what a sealed record keeps readable at rest: ids, case, type, timestamps, references ----
// Built field by field, so nothing added to a record later can stay plaintext by accident.

export function sealedNote(n: NoteRec, enc: Sealed): NoteRec {
  return { id: n.id, caseId: n.caseId, type: n.type, createdAt: n.createdAt, updatedAt: n.updatedAt, sample: n.sample, title: "", body: "", transcript: "", durationMs: 0, location: null, attachmentIds: [], subjectIds: [], flagged: false, enc };
}
export function sealedSubject(s: SubjectRec, enc: Sealed): SubjectRec {
  return { id: s.id, caseId: s.caseId, sample: s.sample, photoBlobId: s.photoBlobId, name: "", aliases: [], lastSeen: { place: "", detail: "", at: null }, coordinates: null, threatLevel: "undetermined", fields: [], redacted: [], enc };
}
export function sealedLink(l: LinkRec, enc: Sealed): LinkRec {
  return { id: l.id, caseId: l.caseId, fromId: l.fromId, fromKind: l.fromKind, toId: l.toId, toKind: l.toKind, label: "", createdAt: l.createdAt, ...(l.sample === undefined ? {} : { sample: l.sample }), enc };
}
export function sealedEvidence(e: EvidenceRec, enc: Sealed): EvidenceRec {
  return { id: e.id, caseId: e.caseId, noteId: e.noteId, kind: e.kind, blobId: e.blobId, thumbBlobId: e.thumbBlobId ?? null, capturedAt: e.capturedAt, sample: e.sample, fileName: "", mimeType: "", size: 0, sha256: "", exif: {}, gps: null, custody: [], enc };
}

/** Blob ids a case owns: evidence originals and previews, subject photos. */
export function mediaIds(evidence: EvidenceRec[], subjects: SubjectRec[]): string[] {
  return [...new Set([...evidence.flatMap((e) => [e.blobId, ...(e.thumbBlobId ? [e.thumbBlobId] : [])]), ...subjects.flatMap((s) => (s.photoBlobId ? [s.photoBlobId] : []))])];
}

interface Rows {
  notes: NoteRec[];
  subjects: SubjectRec[];
  links: LinkRec[];
  evidence: EvidenceRec[];
}

/** Same order as an index read on caseId (primary key order), which the read hooks rely on. */
export const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

async function readRows(caseId: string): Promise<Rows> {
  const [notes, subjects, links, evidence] = await Promise.all([
    db.notes.where("caseId").equals(caseId).toArray(),
    db.subjects.where("caseId").equals(caseId).toArray(),
    db.links.where("caseId").equals(caseId).toArray(),
    db.evidence.where("caseId").equals(caseId).toArray(),
  ]);
  return { notes: notes.sort(byId), subjects: subjects.sort(byId), links: links.sort(byId), evidence: evidence.sort(byId) };
}

/** Records and their media read in one transaction, so they describe the same moment. */
function snapshot(caseId: string) {
  return db.transaction("r", [db.notes, db.subjects, db.links, db.evidence, db.blobs], async () => {
    const rows = await readRows(caseId);
    const blobs = (await db.blobs.bulkGet(mediaIds(rows.evidence, rows.subjects))).filter((b): b is BlobRec => !!b);
    return { rows, blobs };
  });
}

const WRITE_TABLES = () => [db.cases, db.notes, db.subjects, db.links, db.evidence, db.blobs];
const CHANGED = "CaseChangedWhileSealing";

/**
 * Encrypt every record and media Blob of an Active case. All-or-nothing.
 * Encryption happens in memory; the write is one transaction that first checks the case still matches
 * what was encrypted. A capture, edit or late GPS fix that landed meanwhile triggers a fresh pass.
 */
export async function sealCase(caseId: string, passcode: string, onProgress: (done: number, total: number) => void = () => {}) {
  if (passcode.length < MIN_PASSCODE) throw new Error(`Use at least ${MIN_PASSCODE} characters.`);
  const c = await db.cases.get(caseId);
  if (!c || c.status !== "active" || isEncrypted(c)) throw new Error("Only an active case can be sealed.");

  let snap = await snapshot(caseId);
  const size = (s: typeof snap) => s.rows.notes.length + s.rows.subjects.length + s.rows.links.length + s.rows.evidence.length + s.blobs.length + 1;
  onProgress(0, size(snap));

  const salt = randomBytes(16);
  const key = await deriveKey(passcode, salt, PBKDF2_ITERATIONS);
  const ref: KeyRef = { v: 1, kdf: "PBKDF2-SHA256", cipher: "AES-GCM-256", salt: b64(salt), iterations: PBKDF2_ITERATIONS, verifier: await encryptJSON(key, VERIFIER, aadFor("case", caseId)) };

  for (let attempt = 1; ; attempt++) {
    const { rows, blobs } = snap;
    const total = size(snap);
    let done = 1;
    onProgress(done, total);
    const step = () => onProgress(++done, total);
    const before = JSON.stringify(rows);

    const notes: NoteRec[] = [];
    for (const n of rows.notes) {
      notes.push(sealedNote(n, await encryptJSON(key, n, aadFor("note", n.id))));
      step();
    }
    const subjects: SubjectRec[] = [];
    for (const s of rows.subjects) {
      subjects.push(sealedSubject(s, await encryptJSON(key, s, aadFor("subject", s.id))));
      step();
    }
    const links: LinkRec[] = [];
    for (const l of rows.links) {
      links.push(sealedLink(l, await encryptJSON(key, l, aadFor("link", l.id))));
      step();
    }
    const evidence: EvidenceRec[] = [];
    for (const e of rows.evidence) {
      evidence.push(sealedEvidence(e, await encryptJSON(key, e, aadFor("evidence", e.id))));
      step();
    }
    const media: BlobRec[] = [];
    for (const b of blobs) {
      const { iv, ct } = await encryptBytes(key, packMedia(b.data.type, new Uint8Array(await b.data.arrayBuffer())), aadFor("blob", b.id));
      media.push({ id: b.id, data: new Blob([ct], { type: "application/octet-stream" }), iv: b64(iv) });
      step();
    }

    try {
      await db.transaction("rw", WRITE_TABLES(), async () => {
        const fresh = await db.cases.get(caseId);
        if (!fresh || fresh.status !== "active" || isEncrypted(fresh)) throw new Error("The case changed while sealing. Nothing was sealed.");
        if (JSON.stringify(await readRows(caseId)) !== before) throw Object.assign(new Error("The case changed while sealing."), { name: CHANGED });
        await db.notes.bulkPut(notes);
        await db.subjects.bulkPut(subjects);
        await db.links.bulkPut(links);
        await db.evidence.bulkPut(evidence);
        await db.blobs.bulkPut(media); // replaces the plaintext Blobs in place
        await db.cases.update(caseId, { status: "sealed", encryptionKeyRef: JSON.stringify(ref), lastActivityAt: Date.now() });
      });
      return;
    } catch (e) {
      if ((e as Error).name !== CHANGED) throw e;
      if (attempt >= 3) throw new Error("The case kept changing while sealing. Nothing was sealed. Try again.");
      snap = await snapshot(caseId);
    }
  }
}

export type OpenStage = "key" | "decrypt" | "write";

/** Decrypt into memory. Nothing plaintext is written. */
export async function openSealed(caseId: string, passcode: string, onStage: (s: OpenStage) => void = () => {}): Promise<Bundle> {
  const c = await db.cases.get(caseId);
  if (!c) throw new Error("Case not found.");
  onStage("key");
  const key = await unlockKey(c, passcode);
  onStage("decrypt");
  const { rows, blobs } = await snapshot(caseId);
  try {
    const open = <T extends { id: string; enc?: Sealed }>(kind: Parameters<typeof aadFor>[0], list: T[]) =>
      Promise.all(list.map(async (r) => (r.enc ? await decryptJSON<T>(key, r.enc, aadFor(kind, r.id)) : r)));
    const [notes, subjects, links, evidence] = await Promise.all([open("note", rows.notes), open("subject", rows.subjects), open("link", rows.links), open("evidence", rows.evidence)]);
    const media = new Map<string, Blob>();
    for (const r of blobs) {
      if (!r.iv) {
        media.set(r.id, r.data);
        continue;
      }
      const { type, bytes } = unpackMedia(await decryptBytes(key, unb64(r.iv), await r.data.arrayBuffer(), aadFor("blob", r.id)));
      media.set(r.id, new Blob([bytes], { type }));
    }
    return { caseId, keyRef: c.encryptionKeyRef ?? "", notes: notes.sort(byId), subjects: subjects.sort(byId), links: links.sort(byId), evidence: evidence.sort(byId), blobs: media };
  } catch {
    throw new Error("Part of this case did not decrypt. The stored data may be damaged.");
  }
}

/** Decrypt and write plaintext back; the case becomes Active. */
export async function unsealCase(caseId: string, passcode: string, onStage: (s: OpenStage) => void = () => {}) {
  const b = await openSealed(caseId, passcode, onStage);
  onStage("write");
  await db.transaction("rw", WRITE_TABLES(), async () => {
    const fresh = await db.cases.get(caseId);
    if (!fresh || fresh.encryptionKeyRef !== b.keyRef) throw new Error("The case changed. Open it again.");
    await db.notes.bulkPut(b.notes);
    await db.subjects.bulkPut(b.subjects);
    await db.links.bulkPut(b.links);
    await db.evidence.bulkPut(b.evidence);
    await db.blobs.bulkPut([...b.blobs].map(([id, data]) => ({ id, data }))); // original bytes and MIME types
    await db.cases.update(caseId, { status: "active", encryptionKeyRef: null, lastActivityAt: Date.now() });
  });
}
