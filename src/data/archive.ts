import JSZip from "jszip";
import { db, type BlobRec, type CaseRec, type CustodyEntry, type EvidenceRec, type LinkRec, type NoteRec, type SubjectRec } from "./db";
import { downloadBlob, sha256Hex } from "./repo";
import { noteHeadline } from "./rules";
import { isEncrypted } from "./seal";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled";
const ymd = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const yaml = (o: Record<string, unknown>) => `---\n${Object.entries(o).map(([k, v]) => `${k}: ${JSON.stringify(v ?? null)}`).join("\n")}\n---\n`;

export interface ManifestEntry {
  path: string;
  blobId: string;
  /** SHA-256 of the file exactly as stored in the archive (ciphertext for a sealed case) */
  sha256: string;
  size: number;
  mimeType: string;
  /** Base64 AES-GCM IV, present when the file is ciphertext from an encrypted case */
  iv?: string;
}

/** The only readable file an encrypted case contributes to an archive. */
export const SEALED_MD = "This case is sealed. Open it in Alien Technology with its passcode.\n";

/** Preview file name: "IMG_0047.NV" becomes "thumb-IMG_0047.jpg". Previews are always JPEG. */
export function thumbName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return `thumb-${dot > 0 ? fileName.slice(0, dot) : fileName}.jpg`;
}

function noteMd(n: NoteRec, subjects: SubjectRec[]) {
  const fm = yaml({
    id: n.id,
    type: n.type,
    title: n.title,
    created: new Date(n.createdAt).toISOString(),
    location: n.location,
    subjects: subjects.filter((s) => n.subjectIds.includes(s.id)).map((s) => s.name),
    flagged: n.flagged,
    transcript: n.transcript || null,
  });
  return `${fm}\n# ${noteHeadline(n)}\n\n${n.body || n.transcript || ""}\n`;
}

function subjectMd(s: SubjectRec) {
  const red = (k: string, v: string) => (s.redacted.includes(k) ? "[REDACTED]" : v);
  const fm = yaml({ id: s.id, name: s.name, threat: s.threatLevel, coordinates: s.coordinates });
  const lines = [
    `# ${s.name}`,
    "",
    `**Aliases:** ${s.aliases.map((a, i) => red(`alias:${i}`, a)).join(", ") || "None"}`,
    `**Last seen:** ${[red("lastSeen.place", s.lastSeen.place), red("lastSeen.detail", s.lastSeen.detail)].filter(Boolean).join(" / ")}${s.lastSeen.at ? ` (${new Date(s.lastSeen.at).toISOString()})` : ""}`,
    ...s.fields.map((f) => `**${f.key}:** ${red(`field:${f.key}`, f.value)}`),
  ];
  return `${fm}\n${lines.join("\n")}\n`;
}

/**
 * caseIds null exports the whole vault. Appends "exported" custody to included evidence.
 * An encrypted case is exported exactly as stored: records with their ciphertext, media as ciphertext
 * files with their IVs, and a SEALED.md in place of Markdown. Its evidence gets no custody entry.
 */
export async function buildArchive(caseIds: string[] | null): Promise<{ blob: Blob; name: string }> {
  const now = Date.now();
  const exported: CustodyEntry = { at: now, action: "exported", detail: "Included in archive export" };

  // One transaction: the records, their media and the custody entries describe the same moment, and a case
  // sealed during an export can never get a plaintext record written back over its ciphertext.
  const snap = await db.transaction("rw", [db.cases, db.notes, db.subjects, db.links, db.evidence, db.boardPositions, db.blobs], async () => {
    const cases: CaseRec[] = caseIds ? ((await db.cases.bulkGet(caseIds)).filter(Boolean) as CaseRec[]) : await db.cases.toArray();
    const ids = cases.map((c) => c.id);
    const sealed = new Set(cases.filter(isEncrypted).map((c) => c.id));
    const [notes, subjects, links, evidence0, boardPositions] = await Promise.all([
      db.notes.where("caseId").anyOf(ids).toArray(),
      db.subjects.where("caseId").anyOf(ids).toArray(),
      db.links.where("caseId").anyOf(ids).toArray(),
      db.evidence.where("caseId").anyOf(ids).toArray(),
      db.boardPositions.where("caseId").anyOf(ids).toArray(),
    ]);
    const isSealed = (r: { caseId: string; enc?: unknown }) => !!r.enc || sealed.has(r.caseId);
    const evidence: EvidenceRec[] = evidence0.map((e) => (isSealed(e) ? e : { ...e, custody: [...e.custody, exported] }));
    await db.evidence.bulkPut(evidence.filter((e) => !isSealed(e)));

    const refs: { blobId: string; name: string; sealed: boolean }[] = [];
    for (const e of evidence) {
      const s = isSealed(e);
      refs.push({ blobId: e.blobId, name: s ? `${e.blobId}.bin` : e.fileName, sealed: s });
      if (e.thumbBlobId) refs.push({ blobId: e.thumbBlobId, name: s ? `${e.thumbBlobId}.bin` : thumbName(e.fileName), sealed: s });
    }
    for (const sub of subjects) {
      if (!sub.photoBlobId) continue;
      const s = isSealed(sub);
      refs.push({ blobId: sub.photoBlobId, name: s ? `${sub.photoBlobId}.bin` : `subject-${slug(sub.name)}.jpg`, sealed: s });
    }
    const blobs = await db.blobs.bulkGet(refs.map((r) => r.blobId));
    return { cases, notes, subjects, links, evidence, boardPositions, sealed, refs, blobs, isSealed };
  });
  const { cases, notes, subjects, links, evidence, boardPositions, sealed, refs, blobs, isSealed } = snap;

  const zip = new JSZip();
  zip.file("vault.json", JSON.stringify({ format: "alien-technology/vault", version: 2, exportedAt: new Date(now).toISOString(), cases, notes, subjects, links, evidence, boardPositions }, null, 2));

  const dirs = new Set<string>();
  for (const c of cases) {
    let dir = `cases/${slug(c.codename)}`;
    for (let i = 2; dirs.has(dir); i++) dir = `cases/${slug(c.codename)}-${i}`;
    dirs.add(dir);
    if (sealed.has(c.id)) {
      zip.file(`${dir}/SEALED.md`, SEALED_MD);
      continue;
    }
    const cs = subjects.filter((s) => s.caseId === c.id && !s.enc);
    const used = new Set<string>();
    const uniq = (base: string) => {
      let n = base;
      let i = 2;
      while (used.has(n)) n = `${base}-${i++}`;
      used.add(n);
      return n;
    };
    for (const n of notes.filter((x) => x.caseId === c.id && !isSealed(x))) zip.file(`${dir}/notes/${uniq(`${ymd(n.createdAt)}-${slug(noteHeadline(n)).slice(0, 48)}`)}.md`, noteMd(n, cs));
    for (const s of cs) zip.file(`${dir}/subjects/${uniq(slug(s.name))}.md`, subjectMd(s));
  }

  const manifest: ManifestEntry[] = [];
  const usedNames = new Set<string>();
  const done = new Set<string>();
  for (const [i, r] of refs.entries()) {
    const b: BlobRec | undefined = blobs[i];
    if (!b || done.has(r.blobId)) continue;
    // An encrypted case contributes ciphertext only; a readable Blob in one is left out rather than exported.
    if (r.sealed && !b.iv) continue;
    done.add(r.blobId);
    let name = (b.iv ? `${r.blobId}.bin` : r.name).replace(/[/\\]/g, "_");
    if (usedNames.has(name)) {
      const dot = name.lastIndexOf(".");
      name = dot > 0 ? `${name.slice(0, dot)}-${r.blobId.slice(0, 6)}${name.slice(dot)}` : `${name}-${r.blobId.slice(0, 6)}`;
    }
    usedNames.add(name);
    const path = `media/${name}`;
    zip.file(path, b.data);
    manifest.push({ path, blobId: r.blobId, sha256: await sha256Hex(b.data), size: b.data.size, mimeType: b.data.type, ...(b.iv ? { iv: b.iv } : {}) });
  }
  zip.file("manifest.json", JSON.stringify({ format: "alien-technology/manifest", media: manifest }, null, 2));

  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/zip" });
  const single = caseIds && cases.length === 1 ? cases[0] : null;
  const name = single ? `alien-technology-${slug(single.codename.replace(/^OPERATION:\s*/, ""))}-${ymd(now)}.zip` : `alien-technology-vault-${ymd(now)}.zip`;
  return { blob, name };
}

/** Share sheet on phones that support file sharing, else a download. */
export async function shareOrDownload(blob: Blob, name: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([blob], name, { type: "application/zip" });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return "shared";
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return "cancelled";
    }
  }
  downloadBlob(blob, name);
  return "downloaded";
}

export interface ImportReport {
  cases: number;
  notes: number;
  subjects: number;
  evidence: number;
  skipped: number;
  mismatches: number;
  /** Records left out because their case is stored differently here (encrypted versus readable, or another key) */
  refused?: number;
}

async function mergeTable<T extends { id: string }>(table: { bulkGet: (k: string[]) => Promise<(T | undefined)[]>; bulkAdd: (r: T[]) => Promise<unknown> }, rows: T[] = []) {
  if (!rows.length) return { added: 0, skipped: 0 };
  const existing = await table.bulkGet(rows.map((r) => r.id));
  const fresh = rows.filter((_, i) => !existing[i]);
  if (fresh.length) await table.bulkAdd(fresh);
  return { added: fresh.length, skipped: rows.length - fresh.length };
}

type CaseScoped = { caseId: string; enc?: unknown };

/**
 * Verify media against manifest.json, then merge by id; existing ids are skipped.
 * Encrypted cases come back sealed with their ciphertext and IVs, and open with their original passcode.
 * A record only joins a case stored the same way: ciphertext under the same key, or plaintext in a plaintext case.
 */
export async function importArchive(file: Blob): Promise<ImportReport> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const vf = zip.file("vault.json");
  if (!vf) throw new Error("This file is not an Alien Technology archive.");
  const v = JSON.parse(await vf.async("string"));
  if (v.format !== "alien-technology/vault" && v.format !== "alien-technology/case") throw new Error("This file is not an Alien Technology archive.");
  const mf = zip.file("manifest.json");
  const manifest: ManifestEntry[] = mf ? JSON.parse(await mf.async("string")).media ?? [] : [];

  let mismatches = 0;
  const blobs: BlobRec[] = [];
  for (const m of manifest) {
    const f = zip.file(m.path);
    if (!f) {
      mismatches++;
      continue;
    }
    const data = new Blob([await f.async("arraybuffer")], { type: m.mimeType });
    if ((await sha256Hex(data)) !== m.sha256) mismatches++;
    blobs.push(m.iv ? { id: m.blobId, data, iv: m.iv } : { id: m.blobId, data });
  }

  const now = Date.now();
  const imported: CustodyEntry = { at: now, action: "imported", detail: "Imported from archive" };
  const archiveCases: CaseRec[] = v.cases ?? (v.case ? [v.case] : []);
  const archiveKey = new Map(archiveCases.map((c) => [c.id, c.encryptionKeyRef ?? null]));

  const r = await db.transaction("rw", [db.cases, db.notes, db.subjects, db.links, db.evidence, db.boardPositions, db.blobs], async () => {
    const c = await mergeTable(db.cases, archiveCases);
    const rows = { notes: (v.notes ?? []) as NoteRec[], subjects: (v.subjects ?? []) as SubjectRec[], links: (v.links ?? []) as LinkRec[], evidence: (v.evidence ?? []) as EvidenceRec[] };
    const caseIds = [...new Set([...rows.notes, ...rows.subjects, ...rows.links, ...rows.evidence].map((x) => x.caseId))];
    const stored = new Map(caseIds.map((id, i) => [id, i] as const));
    const here = await db.cases.bulkGet(caseIds);
    const fits = (x: CaseScoped) => {
      const lc = here[stored.get(x.caseId)!];
      const localKey = lc && isEncrypted(lc) ? lc.encryptionKeyRef : null;
      return x.enc ? !!localKey && localKey === archiveKey.get(x.caseId) : !localKey;
    };
    const notes = rows.notes.filter(fits);
    const subjects = rows.subjects.filter(fits);
    const links = rows.links.filter(fits);
    const evidence = rows.evidence.filter(fits).map((e) => (e.enc ? e : { ...e, custody: [...e.custody, imported] }));
    const refused = rows.notes.length + rows.subjects.length + rows.links.length + rows.evidence.length - notes.length - subjects.length - links.length - evidence.length;
    const refusedMedia = new Set([
      ...rows.evidence.filter((e) => !fits(e)).flatMap((e) => [e.blobId, ...(e.thumbBlobId ? [e.thumbBlobId] : [])]),
      ...rows.subjects.filter((s) => !fits(s)).flatMap((s) => (s.photoBlobId ? [s.photoBlobId] : [])),
    ]);

    await mergeTable(db.blobs, blobs.filter((b) => !refusedMedia.has(b.id)));
    const n = await mergeTable(db.notes, notes);
    const s = await mergeTable(db.subjects, subjects);
    await mergeTable(db.links, links);
    const e = await mergeTable(db.evidence, evidence);
    await mergeTable(db.boardPositions, v.boardPositions);
    return { cases: c.added, notes: n.added, subjects: s.added, evidence: e.added, skipped: c.skipped + n.skipped + s.skipped + e.skipped, refused };
  });
  return { ...r, mismatches };
}

export function reportText(r: ImportReport) {
  const pl = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return `Imported ${pl(r.cases, "case")}, ${pl(r.notes, "note")}, ${r.evidence} evidence item${r.evidence === 1 ? "" : "s"}. ${pl(r.mismatches, "hash mismatch").replace("mismatchs", "mismatches")}.${r.skipped ? ` ${r.skipped} existing records skipped.` : ""}${r.refused ? ` ${pl(r.refused, "record")} left out: ${r.refused === 1 ? "its case is" : "their case is"} stored differently on this device.` : ""}`;
}
