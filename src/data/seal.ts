import { db, type BlobRec, type CaseRec, type EvidenceRec, type LinkRec, type NoteRec, type SubjectRec } from "./db";
import { b64, decryptBytes, decryptJSON, deriveKey, encryptBytes, encryptJSON, PBKDF2_ITERATIONS, randomBytes, unb64, VERIFIER, type KeyRef } from "@/lib/crypto";
import type { Bundle } from "@/store/unlocked";

export const MIN_PASSCODE = 6;

export function keyRefOf(c: CaseRec | null | undefined): KeyRef | null {
  if (!c?.encryptionKeyRef) return null;
  try {
    return JSON.parse(c.encryptionKeyRef) as KeyRef;
  } catch {
    return null;
  }
}
export const isEncrypted = (c: CaseRec | null | undefined) => !!keyRefOf(c);

// ---- wrong passcode throttling (memory only) ----
const tries = new Map<string, { fails: number; until: number }>();
export function lockoutRemaining(caseId: string): number {
  const t = tries.get(caseId);
  return t ? Math.max(0, t.until - Date.now()) : 0;
}
function fail(caseId: string) {
  const t = tries.get(caseId) ?? { fails: 0, until: 0 };
  t.fails++;
  if (t.fails >= 5) {
    t.until = Date.now() + 30_000;
    t.fails = 0;
  }
  tries.set(caseId, t);
}

async function unlockKey(c: CaseRec, passcode: string): Promise<CryptoKey> {
  const ref = keyRefOf(c);
  if (!ref) throw new Error("This case is not encrypted.");
  const wait = lockoutRemaining(c.id);
  if (wait > 0) throw new Error(`Wait ${Math.ceil(wait / 1000)} seconds before trying again.`);
  const key = await deriveKey(passcode, unb64(ref.salt), ref.iterations);
  try {
    const v = await decryptJSON<string>(key, ref.verifier);
    if (v !== VERIFIER) throw new Error();
  } catch {
    fail(c.id);
    throw new Error("Passcode incorrect.");
  }
  tries.delete(c.id);
  return key;
}

const mediaIds = (evidence: EvidenceRec[], subjects: SubjectRec[]) => [
  ...evidence.flatMap((e) => [e.blobId, ...(e.thumbBlobId ? [e.thumbBlobId] : [])]),
  ...subjects.flatMap((s) => (s.photoBlobId ? [s.photoBlobId] : [])),
];

/** Encrypt every record and media Blob of an Active case. All-or-nothing. */
export async function sealCase(caseId: string, passcode: string, onProgress: (done: number, total: number) => void) {
  if (passcode.length < MIN_PASSCODE) throw new Error(`Use at least ${MIN_PASSCODE} characters.`);
  const c = await db.cases.get(caseId);
  if (!c || c.status !== "active") throw new Error("Only an active case can be sealed.");
  const [notes, subjects, links, evidence] = await Promise.all([
    db.notes.where("caseId").equals(caseId).toArray(),
    db.subjects.where("caseId").equals(caseId).toArray(),
    db.links.where("caseId").equals(caseId).toArray(),
    db.evidence.where("caseId").equals(caseId).toArray(),
  ]);
  const blobs = (await db.blobs.bulkGet(mediaIds(evidence, subjects))).filter(Boolean) as BlobRec[];
  const total = notes.length + subjects.length + links.length + evidence.length + blobs.length + 1;
  let done = 0;
  const step = () => onProgress(++done, total);
  onProgress(0, total);

  const salt = randomBytes(16);
  const key = await deriveKey(passcode, salt, PBKDF2_ITERATIONS);
  const ref: KeyRef = { v: 1, kdf: "PBKDF2-SHA256", cipher: "AES-GCM-256", salt: b64(salt), iterations: PBKDF2_ITERATIONS, verifier: await encryptJSON(key, VERIFIER) };
  step();

  // Everything is encrypted in memory first; the write below is a single transaction.
  const eNotes: NoteRec[] = [];
  for (const n of notes) {
    eNotes.push({ id: n.id, caseId: n.caseId, type: n.type, createdAt: n.createdAt, updatedAt: n.updatedAt, sample: n.sample, title: "", body: "", transcript: "", durationMs: 0, location: null, attachmentIds: [], subjectIds: [], flagged: false, enc: await encryptJSON(key, n) });
    step();
  }
  const eSubs: SubjectRec[] = [];
  for (const s of subjects) {
    eSubs.push({ id: s.id, caseId: s.caseId, sample: s.sample, photoBlobId: s.photoBlobId, name: "", aliases: [], lastSeen: { place: "", detail: "", at: null }, coordinates: null, threatLevel: "undetermined", fields: [], redacted: [], enc: await encryptJSON(key, s) });
    step();
  }
  const eLinks: LinkRec[] = [];
  for (const l of links) {
    eLinks.push({ ...l, label: "", enc: await encryptJSON(key, l) });
    step();
  }
  const eEv: EvidenceRec[] = [];
  for (const e of evidence) {
    eEv.push({ id: e.id, caseId: e.caseId, noteId: e.noteId, kind: e.kind, blobId: e.blobId, thumbBlobId: e.thumbBlobId ?? null, capturedAt: e.capturedAt, sample: e.sample, fileName: "", mimeType: "", size: 0, sha256: "", exif: {}, gps: null, custody: [], enc: await encryptJSON(key, e) });
    step();
  }
  const eBlobs: BlobRec[] = [];
  for (const b of blobs) {
    const { iv, ct } = await encryptBytes(key, await b.data.arrayBuffer());
    eBlobs.push({ id: b.id, data: new Blob([ct]), iv: b64(iv) });
    step();
  }

  await db.transaction("rw", [db.cases, db.notes, db.subjects, db.links, db.evidence, db.blobs], async () => {
    const fresh = await db.cases.get(caseId);
    if (fresh?.status !== "active") throw new Error("The case changed while sealing.");
    await db.notes.bulkPut(eNotes);
    await db.subjects.bulkPut(eSubs);
    await db.links.bulkPut(eLinks);
    await db.evidence.bulkPut(eEv);
    await db.blobs.bulkPut(eBlobs); // replaces the plaintext Blobs in place
    await db.cases.update(caseId, { status: "sealed", encryptionKeyRef: JSON.stringify(ref), lastActivityAt: Date.now() });
  });
}

/** Decrypt into memory. Nothing plaintext is written. */
export async function openSealed(caseId: string, passcode: string): Promise<Bundle> {
  const c = await db.cases.get(caseId);
  if (!c) throw new Error("Case not found.");
  const key = await unlockKey(c, passcode);
  const [n, s, l, e] = await Promise.all([
    db.notes.where("caseId").equals(caseId).toArray(),
    db.subjects.where("caseId").equals(caseId).toArray(),
    db.links.where("caseId").equals(caseId).toArray(),
    db.evidence.where("caseId").equals(caseId).toArray(),
  ]);
  const open = <T extends { enc?: unknown }>(rows: T[]) => Promise.all(rows.map(async (r) => (r.enc ? await decryptJSON<T>(key, r.enc as never) : r)));
  const [notes, subjects, links, evidence] = await Promise.all([open(n), open(s), open(l), open(e)]);
  const blobs = new Map<string, Blob>();
  const types = new Map<string, string>();
  for (const ev of evidence) {
    types.set(ev.blobId, ev.mimeType);
    if (ev.thumbBlobId) types.set(ev.thumbBlobId, "image/jpeg");
  }
  for (const r of (await db.blobs.bulkGet(mediaIds(evidence, subjects))).filter(Boolean) as BlobRec[]) {
    if (!r.iv) {
      blobs.set(r.id, r.data);
      continue;
    }
    const buf = await decryptBytes(key, unb64(r.iv), await r.data.arrayBuffer());
    blobs.set(r.id, new Blob([buf], { type: types.get(r.id) ?? "image/jpeg" }));
  }
  return { caseId, notes, subjects, links, evidence, blobs };
}

/** Decrypt and write plaintext back; the case becomes Active. */
export async function unsealCase(caseId: string, passcode: string) {
  const b = await openSealed(caseId, passcode);
  await db.transaction("rw", [db.cases, db.notes, db.subjects, db.links, db.evidence, db.blobs], async () => {
    await db.notes.bulkPut(b.notes);
    await db.subjects.bulkPut(b.subjects);
    await db.links.bulkPut(b.links);
    await db.evidence.bulkPut(b.evidence);
    await db.blobs.bulkPut([...b.blobs].map(([id, data]) => ({ id, data })));
    await db.cases.update(caseId, { status: "active", encryptionKeyRef: null, lastActivityAt: Date.now() });
  });
}
