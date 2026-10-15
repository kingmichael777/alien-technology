// @vitest-environment node
import "fake-indexeddb/auto";
import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";
import { db, type BlobRec, type CaseRec, type EvidenceRec, type LinkRec, type NoteRec, type SubjectRec } from "@/data/db";
import { isEncrypted, lockoutRemaining, openSealed, sealCase, sealedEvidence, sealedLink, sealedNote, sealedSubject, unsealCase } from "@/data/seal";
import { bundleReads, liveReads } from "@/data/hooks";
import { caseRepo, evidenceRepo, noteRepo, sha256Hex } from "@/data/repo";
import { buildArchive, importArchive, SEALED_MD, thumbName } from "@/data/archive";
import { decryptJSON, deriveKey, encryptJSON, packMedia, randomBytes, unpackMedia } from "@/lib/crypto";

const PASS = "fieldtest1";
const SECRETS = ["Kaelin", "Surveillance", "PINE RIDGE", "IMG_0047", "humming", "Morrow", "Associate", "PNW-4471", "PHOTO-BYTES"];
const T1 = new Date(2024, 10, 8, 2, 17).getTime();

const bytes = (s: string) => new TextEncoder().encode(s);
const latin1 = async (b: Blob) => String.fromCharCode(...new Uint8Array(await b.arrayBuffer()));

function kase(id: string, codename: string): CaseRec {
  return { id, codename, status: "active", createdAt: T1, lastActivityAt: T1, encryptionKeyRef: null, sample: false };
}
function note(id: string, caseId: string, p: Partial<NoteRec>): NoteRec {
  return { id, caseId, type: "text", title: "", body: "", transcript: "", durationMs: 0, createdAt: T1, updatedAt: T1, location: null, attachmentIds: [], subjectIds: [], flagged: false, sample: false, ...p };
}
function subject(id: string, caseId: string, name: string, p: Partial<SubjectRec> = {}): SubjectRec {
  return { id, caseId, name, aliases: [], photoBlobId: null, lastSeen: { place: "", detail: "", at: null }, coordinates: null, threatLevel: "undetermined", fields: [], redacted: [], sample: false, ...p };
}

/** A case shaped like NIGHTFALL, inserted out of id order and with timestamp ties, so sort orders are really exercised. */
async function seedCase(caseId = "case-n") {
  const subjects = [
    subject(`${caseId}-s-k`, caseId, "Kaelin, E.", { aliases: ["E. Kaelin", "J. Varek"], redacted: ["alias:1", "field:CITIZEN ID"], fields: [{ key: "CITIZEN ID", value: "PNW-4471-0093-KE" }], photoBlobId: `${caseId}-b-face` }),
    subject(`${caseId}-s-m`, caseId, "L. Morrow"),
    subject(`${caseId}-s-a`, caseId, "A. Solis"),
  ];
  const [k] = subjects;
  const notes = [
    note(`${caseId}-n-9`, caseId, { title: "Surveillance Excerpt", body: "Data packet exchange suspected.", subjectIds: [k!.id], createdAt: T1 }),
    note(`${caseId}-n-2`, caseId, { type: "voice", title: "Field Report", transcript: "Lights and humming sounds.", subjectIds: [k!.id], createdAt: T1 }),
    note(`${caseId}-n-5`, caseId, { type: "photo", title: "IMG_0047.NV", attachmentIds: [`${caseId}-e-1`], createdAt: T1 + 5, location: { lat: 39.7425, lng: -105.1786, accuracy: 8, source: "exif" } }),
    note(`${caseId}-n-1`, caseId, { type: "location", title: "PINE RIDGE, CO", createdAt: T1 + 9, subjectIds: [k!.id] }),
  ];
  const evidence: EvidenceRec[] = [
    { id: `${caseId}-e-1`, caseId, noteId: `${caseId}-n-5`, kind: "photo", blobId: `${caseId}-b-img`, thumbBlobId: `${caseId}-b-thumb`, fileName: "IMG_0047.NV", mimeType: "image/jpeg", size: 0, sha256: "", exif: { Camera: "NV-Scope" }, gps: { lat: 39.7425, lng: -105.1786 }, capturedAt: T1, custody: [{ at: T1, action: "captured", detail: "Captured" }], sample: false },
    { id: `${caseId}-e-0`, caseId, noteId: `${caseId}-n-2`, kind: "audio", blobId: `${caseId}-b-audio`, thumbBlobId: null, fileName: "humming.webm", mimeType: "audio/webm", size: 0, sha256: "", exif: {}, gps: null, capturedAt: T1, custody: [], sample: false },
  ];
  const links: LinkRec[] = [
    { id: `${caseId}-l-3`, caseId, fromId: k!.id, fromKind: "subject", toId: `${caseId}-s-m`, toKind: "subject", label: "Associate / Possible Contact", createdAt: T1 + 1 },
    { id: `${caseId}-l-1`, caseId, fromId: `${caseId}-e-1`, fromKind: "evidence", toId: `${caseId}-n-1`, toKind: "note", label: "Captured at", createdAt: T1 + 1 },
    { id: `${caseId}-l-2`, caseId, fromId: k!.id, fromKind: "subject", toId: `${caseId}-n-1`, toKind: "note", label: "Seen at", createdAt: T1 },
  ];
  const blobs: BlobRec[] = [
    { id: `${caseId}-b-img`, data: new Blob([bytes("PHOTO-BYTES of Kaelin at PINE RIDGE")], { type: "image/jpeg" }) },
    { id: `${caseId}-b-thumb`, data: new Blob([bytes("PHOTO-BYTES thumb")], { type: "image/jpeg" }) },
    { id: `${caseId}-b-face`, data: new Blob([bytes("PHOTO-BYTES face png")], { type: "image/png" }) },
    { id: `${caseId}-b-audio`, data: new Blob([bytes("PHOTO-BYTES humming audio")]) }, // no MIME type at all
  ];
  for (const e of evidence) {
    const b = blobs.find((x) => x.id === e.blobId)!;
    e.size = b.data.size;
    e.sha256 = await sha256Hex(b.data);
  }
  await db.cases.add(kase(caseId, "OPERATION: NIGHTFALL"));
  await db.subjects.bulkAdd(subjects);
  await db.notes.bulkAdd(notes);
  await db.evidence.bulkAdd(evidence);
  await db.links.bulkAdd(links);
  await db.blobs.bulkAdd(blobs);
  return { caseId, k: k!, notes, subjects, evidence, links, blobs };
}

async function rawCase(caseId: string) {
  const [notes, subjects, links, evidence] = await Promise.all([
    db.notes.where("caseId").equals(caseId).toArray(),
    db.subjects.where("caseId").equals(caseId).toArray(),
    db.links.where("caseId").equals(caseId).toArray(),
    db.evidence.where("caseId").equals(caseId).toArray(),
  ]);
  return { notes, subjects, links, evidence };
}

/** Every read the hooks perform, for one case. */
async function allLiveReads(caseId: string, ids: { k: string; photoNote: string; voiceNote: string; evidence: string; locNote: string }) {
  return {
    caseNotes: await liveReads.caseNotes(caseId),
    note: await liveReads.note(ids.photoNote),
    subjects: await liveReads.subjects(caseId),
    subject: await liveReads.subject(ids.k),
    subjectNotes: await liveReads.subjectNotes(ids.k),
    evidenceList: await liveReads.evidenceList(caseId),
    evidence: await liveReads.evidence(ids.evidence),
    noteEvidence: await liveReads.noteEvidence(ids.photoNote),
    audioEvidence: await liveReads.audioEvidence(ids.voiceNote),
    noAudio: await liveReads.audioEvidence(ids.photoNote),
    caseLinks: await liveReads.caseLinks(caseId),
    subjectLinks: await liveReads.entityLinks(ids.k),
    locLinks: await liveReads.entityLinks(ids.locNote),
    evidenceLinks: await liveReads.entityLinks(ids.evidence),
  };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("crypto helpers", () => {
  it("round-trips the media envelope and keeps unwrapped bytes whole", () => {
    const body = bytes("raw media");
    const { type, bytes: out } = unpackMedia(packMedia("audio/webm;codecs=opus", body));
    expect(type).toBe("audio/webm;codecs=opus");
    expect([...out]).toEqual([...body]);
    expect(unpackMedia(packMedia("", body)).type).toBe("");
    const plain = unpackMedia(bytes("\xff\xd8 jpeg"));
    expect(plain.type).toBe("");
    expect(plain.bytes.length).toBe(bytes("\xff\xd8 jpeg").length);
  });

  it("derives the same key for composed and decomposed passcodes, and binds ciphertext to its label", async () => {
    const salt = randomBytes(16);
    const nfc = await deriveKey("café-1234", salt, 1000);
    const nfd = await deriveKey("café-1234", salt, 1000);
    const s = await encryptJSON(nfc, { a: 1 }, "alien-technology/note/1");
    expect(await decryptJSON(nfd, s, "alien-technology/note/1")).toEqual({ a: 1 });
    await expect(decryptJSON(nfd, s, "alien-technology/note/2")).rejects.toThrow();
  });
});

describe("clear projections", () => {
  it("keep only ids, case, type, timestamps and references readable", async () => {
    const { notes, subjects, links, evidence } = await seedCase();
    const enc = { iv: "x", ct: "y" };
    const at = JSON.stringify([...notes.map((n) => sealedNote(n, enc)), ...subjects.map((s) => sealedSubject(s, enc)), ...links.map((l) => sealedLink(l, enc)), ...evidence.map((e) => sealedEvidence(e, enc))]);
    for (const w of SECRETS) expect(at).not.toContain(w);
    expect(sealedLink({ ...links[0]!, color: "red" } as LinkRec & { color: string }, enc)).not.toHaveProperty("color");
  });
});

describe("sealing a case", () => {
  it("leaves no readable content at rest, opens with the passcode, and unseals byte for byte", async () => {
    const seeded = await seedCase();
    const { caseId } = seeded;
    await db.cases.add(kase("case-other", "OPERATION: OTHER"));
    await db.notes.add(note("other-1", "case-other", { title: "Kaelin elsewhere" }));
    const ids = { k: seeded.k.id, photoNote: `${caseId}-n-5`, voiceNote: `${caseId}-n-2`, evidence: `${caseId}-e-1`, locNote: `${caseId}-n-1` };
    const before = await rawCase(caseId);
    const reads = await allLiveReads(caseId, ids);

    const progress: [number, number][] = [];
    await sealCase(caseId, PASS, (d, t) => progress.push([d, t]));
    expect(progress.at(-1)).toEqual([4 + 3 + 3 + 2 + 4 + 1, 17]);

    // At rest: ciphertext only.
    const c = await db.cases.get(caseId);
    expect(c?.status).toBe("sealed");
    expect(isEncrypted(c)).toBe(true);
    const raw = await rawCase(caseId);
    expect(raw.notes.every((n) => n.enc)).toBe(true);
    const text = JSON.stringify(raw);
    for (const w of SECRETS) expect(text).not.toContain(w);
    for (const b of seeded.blobs) {
      const stored = (await db.blobs.get(b.id))!;
      expect(stored.iv).toBeTruthy();
      expect(stored.data.type).toBe("application/octet-stream");
      for (const w of SECRETS) expect(await latin1(stored.data)).not.toContain(w);
    }
    expect((await db.notes.get("other-1"))?.title).toBe("Kaelin elsewhere");

    // Wrong passcode.
    await expect(openSealed(caseId, "fieldtest2")).rejects.toThrow("Passcode incorrect.");

    // Right passcode: every hook read answers from the bundle exactly as the live read did before sealing.
    const b = await openSealed(caseId, PASS);
    expect(b.keyRef).toBe(c!.encryptionKeyRef);
    expect(bundleReads.caseNotes(b, caseId)).toEqual(reads.caseNotes);
    expect(bundleReads.note(b, ids.photoNote)).toEqual(reads.note);
    expect(bundleReads.subjects(b, caseId)).toEqual(reads.subjects);
    expect(bundleReads.subject(b, ids.k)).toEqual(reads.subject);
    expect(bundleReads.subjectNotes(b, ids.k)).toEqual(reads.subjectNotes);
    expect(bundleReads.evidenceList(b, caseId)).toEqual(reads.evidenceList);
    expect(bundleReads.evidence(b, ids.evidence)).toEqual(reads.evidence);
    expect(bundleReads.noteEvidence(b, ids.photoNote)).toEqual(reads.noteEvidence);
    expect(bundleReads.audioEvidence(b, ids.voiceNote)).toEqual(reads.audioEvidence);
    expect(bundleReads.audioEvidence(b, ids.photoNote)).toEqual(reads.noAudio);
    expect(bundleReads.caseLinks(b, caseId)).toEqual(reads.caseLinks);
    expect(bundleReads.entityLinks(b, ids.k)).toEqual(reads.subjectLinks);
    expect(bundleReads.entityLinks(b, ids.locNote)).toEqual(reads.locLinks);
    expect(bundleReads.entityLinks(b, ids.evidence)).toEqual(reads.evidenceLinks);
    // Records of other cases are never answered from the bundle.
    expect(bundleReads.caseNotes(b, "case-other")).toBeUndefined();
    expect(bundleReads.note(b, "other-1")).toBeUndefined();
    expect(bundleReads.entityLinks(b, "other-1")).toBeUndefined();
    for (const blob of seeded.blobs) {
      const open = b.blobs.get(blob.id)!;
      expect(open.type).toBe(blob.data.type);
      expect(await latin1(open)).toBe(await latin1(blob.data));
    }

    // Unseal: plaintext and original MIME types come back exactly.
    await unsealCase(caseId, PASS);
    const after = await db.cases.get(caseId);
    expect(after?.status).toBe("active");
    expect(after?.encryptionKeyRef).toBeNull();
    expect(await rawCase(caseId)).toEqual(before);
    for (const blob of seeded.blobs) {
      const stored = (await db.blobs.get(blob.id))!;
      expect(stored.iv).toBeUndefined();
      expect(stored.data.type).toBe(blob.data.type);
      expect(await latin1(stored.data)).toBe(await latin1(blob.data));
    }
    expect(await evidenceRepo.verify(ids.evidence)).toBe(true);
  });

  it("seals a write that lands while it encrypts instead of leaving it readable", async () => {
    const { caseId } = await seedCase("case-race");
    let passes = 0;
    await sealCase(caseId, PASS, (done) => {
      if (done !== 1) return;
      if (++passes === 1) void db.notes.add(note("case-race-late", caseId, { title: "Late GPS fix near PINE RIDGE" }));
    });
    expect(passes).toBe(2);
    const late = await db.notes.get("case-race-late");
    expect(late?.enc).toBeTruthy();
    expect(late?.title).toBe("");
    const b = await openSealed(caseId, PASS);
    expect(b.notes.find((n) => n.id === "case-race-late")?.title).toBe("Late GPS fix near PINE RIDGE");
  });

  it("locks out after five wrong passcodes", async () => {
    const { caseId } = await seedCase("case-lock");
    await sealCase(caseId, PASS);
    for (let i = 0; i < 5; i++) await expect(openSealed(caseId, `wrong-${i}`)).rejects.toThrow("Passcode incorrect.");
    expect(lockoutRemaining(caseId)).toBeGreaterThan(25_000);
    await expect(openSealed(caseId, PASS)).rejects.toThrow(/^Wait 30 seconds before trying again\.$/);
  }, 30_000);

  it("keeps sealed cases read only and refuses shortcuts around encryption", async () => {
    const { caseId } = await seedCase("case-ro");
    await expect(sealCase(caseId, "short")).rejects.toThrow("Use at least 6 characters.");
    await expect(caseRepo.setStatus(caseId, "sealed")).rejects.toThrow();
    await sealCase(caseId, PASS);
    await expect(sealCase(caseId, PASS)).rejects.toThrow("Only an active case can be sealed.");
    await expect(caseRepo.setStatus(caseId, "active")).rejects.toThrow(/Unseal it with its passcode/);
    await expect(noteRepo.create(caseId, { type: "text", title: "x" })).rejects.toThrow(/not active/);
    await expect(evidenceRepo.verify(`${caseId}-e-1`)).rejects.toThrow(/sealed/);
    expect((await db.evidence.get(`${caseId}-e-1`))?.custody).toEqual([]);
  }, 30_000);
});

describe("archive", () => {
  it("names previews after the original without its extension", () => {
    expect(thumbName("IMG_0047.NV")).toBe("thumb-IMG_0047.jpg");
    expect(thumbName("photo.final.jpeg")).toBe("thumb-photo.final.jpg");
    expect(thumbName("scan")).toBe("thumb-scan.jpg");
    expect(thumbName(".hidden")).toBe("thumb-.hidden.jpg");
  });

  it("exports an encrypted case as stored and imports it back sealed", async () => {
    const seeded = await seedCase("case-x");
    const { caseId } = seeded;
    await db.cases.add(kase("case-open", "OPERATION: DAYLIGHT"));
    await db.evidence.add({ ...seeded.evidence[0]!, id: "open-e", caseId: "case-open", blobId: "open-b", thumbBlobId: "open-t", fileName: "IMG_0100.JPG" });
    await db.blobs.bulkAdd([{ id: "open-b", data: new Blob([bytes("open")], { type: "image/jpeg" }) }, { id: "open-t", data: new Blob([bytes("t")], { type: "image/jpeg" }) }]);
    await sealCase(caseId, PASS);
    const sealedEvidence = await db.evidence.get(`${caseId}-e-1`);

    const { blob } = await buildArchive(null);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir);
    for (const n of names) {
      const body = await zip.files[n]!.async("binarystring");
      for (const w of SECRETS) expect(`${n}\n${body}`).not.toContain(w);
    }
    expect(names).toContain("cases/operation-nightfall/SEALED.md");
    expect(await zip.file("cases/operation-nightfall/SEALED.md")!.async("string")).toBe(SEALED_MD);
    expect(names.filter((n) => n.startsWith("cases/operation-nightfall/"))).toEqual(["cases/operation-nightfall/SEALED.md"]);
    expect(names).toContain("media/thumb-IMG_0100.jpg");
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string")).media as { path: string; blobId: string; iv?: string; sha256: string }[];
    for (const b of seeded.blobs) {
      const m = manifest.find((x) => x.blobId === b.id)!;
      expect(m.path).toBe(`media/${b.id}.bin`);
      const stored = (await db.blobs.get(b.id))!;
      expect(m.iv).toBe(stored.iv);
      expect(m.sha256).toBe(await sha256Hex(stored.data));
    }
    // No custody entry was added to encrypted evidence; plaintext evidence got its "exported" entry.
    expect(await db.evidence.get(`${caseId}-e-1`)).toEqual(sealedEvidence);
    expect((await db.evidence.get("open-e"))?.custody.at(-1)?.action).toBe("exported");

    await Promise.all(db.tables.map((t) => t.clear()));
    const report = await importArchive(blob);
    expect(report.mismatches).toBe(0);
    expect(report.refused ?? 0).toBe(0);
    const back = await db.cases.get(caseId);
    expect(back?.status).toBe("sealed");
    expect(isEncrypted(back)).toBe(true);
    expect(await db.evidence.get(`${caseId}-e-1`)).toEqual(sealedEvidence);
    const b = await openSealed(caseId, PASS);
    expect(b.notes.map((n) => n.title).sort()).toEqual(seeded.notes.map((n) => n.title).sort());
    for (const orig of seeded.blobs) expect(await latin1(b.blobs.get(orig.id)!)).toBe(await latin1(orig.data));
  });

  it("never merges plaintext records into an encrypted case", async () => {
    const { caseId } = await seedCase("case-mix");
    const { blob } = await buildArchive([caseId]); // readable export, taken before sealing
    await db.notes.delete(`${caseId}-n-9`);
    await sealCase(caseId, PASS);
    const report = await importArchive(blob);
    expect(report.refused).toBeGreaterThan(0);
    expect(await db.notes.get(`${caseId}-n-9`)).toBeUndefined();
  });
});
