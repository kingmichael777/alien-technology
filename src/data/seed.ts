import nvUrl from "@/assets/sample-nv.jpg";
import { db, type CaseRec, type NoteRec, type SubjectRec, type LinkRec } from "./db";
import { sha256Hex, uid } from "./repo";

let running: Promise<void> | null = null;

/** First launch only. Every record carries sample: true. */
export function ensureSeeded(): Promise<void> {
  running ??= seed().catch((e) => {
    running = null;
    console.error("Seeding failed", e);
  });
  return running;
}

function at(daysAgo: number, h: number, m: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

async function seed() {
  if ((await db.settings.get("seeded"))?.value) return;

  let photo: Blob | null = null;
  try {
    photo = await (await fetch(nvUrl)).blob();
  } catch {
    photo = null;
  }
  const sha = photo ? await sha256Hex(photo) : "";

  const mk = (codename: string, status: CaseRec["status"], ts: number): CaseRec => ({
    id: uid(), codename, status, createdAt: ts - 86_400_000 * 10, lastActivityAt: ts, encryptionKeyRef: null, sample: true,
  });
  const nightfall = mk("OPERATION: NIGHTFALL", "active", at(0, 2, 17));
  const cases = [
    nightfall,
    mk("OPERATION: SILENT ECHO", "sealed", at(1, 23, 43)),
    mk("OPERATION: BLACKSTONE", "sealed", at(3, 20, 9)),
    mk("OPERATION: DREADNOUGHT", "archived", at(7, 16, 22)),
  ];
  const cid = nightfall.id;

  const subj = (name: string, p: Partial<SubjectRec>): SubjectRec => ({
    id: uid(), caseId: cid, name, aliases: [], photoBlobId: null, lastSeen: { place: "", detail: "", at: null },
    coordinates: null, threatLevel: "undetermined", fields: [], redacted: [], sample: true, ...p,
  });
  const kaelin = subj("Kaelin, E.", {
    aliases: ["E. Kaelin", "J. Varek", "Elias Kane"],
    lastSeen: { place: "New Seattle, P.N.W.", detail: "Sector 7 / Perimeter 12", at: new Date(2025, 3, 17, 23, 47).getTime() },
    fields: [{ key: "CITIZEN ID", value: "PNW-4471-0093-KE" }],
    redacted: ["alias:1", "field:CITIZEN ID"],
  });
  const morrow = subj("L. Morrow", { aliases: ["Lena Morrow"], threatLevel: "low" });
  const solis = subj("V. Solis", { aliases: ["Vic"], threatLevel: "elevated" });

  const note = (p: Partial<NoteRec> & { type: NoteRec["type"]; createdAt: number }): NoteRec => ({
    id: uid(), caseId: cid, title: "", body: "", transcript: "", durationMs: 0, updatedAt: p.createdAt, location: null,
    attachmentIds: [], subjectIds: [], flagged: false, sample: true, ...p,
  });
  const n1 = note({ type: "text", createdAt: new Date(2025, 3, 17, 23, 47).getTime(), title: "Surveillance Excerpt // 04.17.25", body: "Subject observed meeting with two unidentified individuals. Discussion appeared tense. Data packet exchange suspected.", subjectIds: [kaelin.id] });
  const n2 = note({ type: "voice", createdAt: new Date(2025, 3, 18, 9, 12).getTime(), title: "Field Report // R. Delgado", transcript: "Subject's biometrics partially scanned. Facial geometry matches archived pattern with 82% confidence. Further analysis required.", durationMs: 41_000, subjectIds: [kaelin.id] });
  const n3 = note({ type: "text", createdAt: new Date(2025, 3, 19, 3, 5).getTime(), title: "Internal Flag // AI Threat Matrix", body: "Subject exhibits non-standard behavioral patterns. Possible vector for external influence. Monitor closely.", subjectIds: [kaelin.id], flagged: true });
  const pale = note({ type: "text", createdAt: new Date(2025, 3, 20, 1, 30).getTime(), title: "The Pale Signal", body: "Encrypted broadcast intercepted on an unregistered band. Origin unresolved. Repeats every 47 minutes." });

  const evId = uid();
  const blobId = uid();
  const t0217 = new Date(2024, 10, 8, 2, 17).getTime();
  const photoNote = note({ type: "photo", createdAt: t0217, title: "IMG_0047.NV", attachmentIds: photo ? [evId] : [], location: { lat: 39.7425, lng: -105.1786, accuracy: 8, source: "exif" } });
  const locNote = note({ type: "location", createdAt: t0217 + 20_000, title: "PINE RIDGE, CO", location: { lat: 39.7425, lng: -105.1786, accuracy: 12, source: "device" } });
  const textNote = note({ type: "text", createdAt: new Date(2024, 10, 8, 2, 21).getTime(), body: "Multiple reports of lights and humming sounds. No aircraft in vicinity." });

  const link = (fromId: string, fromKind: LinkRec["fromKind"], toId: string, toKind: LinkRec["toKind"], label: string): LinkRec => ({
    id: uid(), caseId: cid, fromId, fromKind, toId, toKind, label, createdAt: Date.now(), sample: true,
  });
  const fromPhoto = photo ? evId : photoNote.id;
  const photoKind = photo ? "evidence" : "note";
  const links = [
    link(kaelin.id, "subject", morrow.id, "subject", "Associate / Possible Contact"),
    link(kaelin.id, "subject", solis.id, "subject", "Informant / Nexus-9 Link"),
    link(kaelin.id, "subject", pale.id, "note", "Event / Encrypted Broadcast"),
    link(fromPhoto, photoKind, locNote.id, "note", "Captured at"),
    link(fromPhoto, photoKind, textNote.id, "note", "Corroborates"),
    link(textNote.id, "note", locNote.id, "note", "Reported at"),
  ];

  await db.transaction("rw", [db.cases, db.notes, db.subjects, db.links, db.evidence, db.blobs, db.settings], async () => {
    if ((await db.settings.get("seeded"))?.value) return;
    await db.cases.bulkAdd(cases);
    await db.subjects.bulkAdd([kaelin, morrow, solis]);
    await db.notes.bulkAdd([n1, n2, n3, pale, photoNote, locNote, textNote]);
    await db.links.bulkAdd(links);
    if (photo) {
      await db.blobs.add({ id: blobId, data: photo });
      await db.evidence.add({
        id: evId, caseId: cid, noteId: photoNote.id, kind: "photo", blobId, fileName: "IMG_0047.NV", mimeType: photo.type || "image/jpeg",
        size: photo.size, sha256: sha, exif: { Camera: "NV-Scope Mk II", Exposure: "1/8 s", ISO: "12800", Lens: "50mm f/1.4" },
        gps: { lat: 39.7425, lng: -105.1786 }, capturedAt: t0217,
        custody: [
          { at: t0217, action: "captured", detail: "Captured on NV-Scope Mk II" },
          { at: t0217 + 3_600_000, action: "imported", detail: "Imported to OPERATION: NIGHTFALL" },
        ],
        sample: true,
      });
    }
    await db.settings.put({ key: "lastActiveCaseId", value: cid });
    await db.settings.put({ key: "seeded", value: true });
  });
}
