import JSZip from "jszip";
import { db, type CaseRec, type EvidenceRec, type NoteRec, type SubjectRec } from "./db";
import { downloadBlob, sha256Hex } from "./repo";
import { noteHeadline } from "./rules";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled";
const ymd = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const yaml = (o: Record<string, unknown>) => `---\n${Object.entries(o).map(([k, v]) => `${k}: ${JSON.stringify(v ?? null)}`).join("\n")}\n---\n`;

export interface ManifestEntry {
  path: string;
  blobId: string;
  sha256: string;
  size: number;
  mimeType: string;
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

/** caseIds null exports the whole vault. Appends "exported" custody to included evidence. */
export async function buildArchive(caseIds: string[] | null): Promise<{ blob: Blob; name: string }> {
  const cases: CaseRec[] = caseIds ? ((await db.cases.bulkGet(caseIds)).filter(Boolean) as CaseRec[]) : await db.cases.toArray();
  const ids = cases.map((c) => c.id);
  const now = Date.now();
  const [notes, subjects, links, evidence0, boardPositions] = await Promise.all([
    db.notes.where("caseId").anyOf(ids).toArray(),
    db.subjects.where("caseId").anyOf(ids).toArray(),
    db.links.where("caseId").anyOf(ids).toArray(),
    db.evidence.where("caseId").anyOf(ids).toArray(),
    db.boardPositions.where("caseId").anyOf(ids).toArray(),
  ]);
  const evidence: EvidenceRec[] = evidence0.map((e) => ({ ...e, custody: [...e.custody, { at: now, action: "exported", detail: "Included in archive export" }] }));
  await db.evidence.bulkPut(evidence);

  const zip = new JSZip();
  zip.file("vault.json", JSON.stringify({ format: "alien-technology/vault", version: 2, exportedAt: new Date(now).toISOString(), cases, notes, subjects, links, evidence, boardPositions }, null, 2));

  for (const c of cases) {
    const dir = `cases/${slug(c.codename)}`;
    const cs = subjects.filter((s) => s.caseId === c.id);
    const used = new Set<string>();
    const uniq = (base: string) => {
      let n = base;
      let i = 2;
      while (used.has(n)) n = `${base}-${i++}`;
      used.add(n);
      return n;
    };
    for (const n of notes.filter((x) => x.caseId === c.id)) zip.file(`${dir}/notes/${uniq(`${ymd(n.createdAt)}-${slug(noteHeadline(n)).slice(0, 48)}`)}.md`, noteMd(n, cs));
    for (const s of cs) zip.file(`${dir}/subjects/${uniq(slug(s.name))}.md`, subjectMd(s));
  }

  const refs: { blobId: string; name: string }[] = [];
  for (const e of evidence) {
    refs.push({ blobId: e.blobId, name: e.fileName });
    if (e.thumbBlobId) refs.push({ blobId: e.thumbBlobId, name: `thumb-${e.fileName}.jpg` });
  }
  for (const s of subjects) if (s.photoBlobId) refs.push({ blobId: s.photoBlobId, name: `subject-${slug(s.name)}.jpg` });

  const manifest: ManifestEntry[] = [];
  const usedNames = new Set<string>();
  for (const r of refs) {
    const b = await db.blobs.get(r.blobId);
    if (!b) continue;
    let name = r.name.replace(/[/\\]/g, "_");
    if (usedNames.has(name)) {
      const dot = name.lastIndexOf(".");
      name = dot > 0 ? `${name.slice(0, dot)}-${r.blobId.slice(0, 6)}${name.slice(dot)}` : `${name}-${r.blobId.slice(0, 6)}`;
    }
    usedNames.add(name);
    const path = `media/${name}`;
    zip.file(path, b.data);
    manifest.push({ path, blobId: r.blobId, sha256: await sha256Hex(b.data), size: b.data.size, mimeType: b.data.type });
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
}

async function mergeTable<T extends { id: string }>(table: { bulkGet: (k: string[]) => Promise<(T | undefined)[]>; bulkAdd: (r: T[]) => Promise<unknown> }, rows: T[] = []) {
  if (!rows.length) return { added: 0, skipped: 0 };
  const existing = await table.bulkGet(rows.map((r) => r.id));
  const fresh = rows.filter((_, i) => !existing[i]);
  if (fresh.length) await table.bulkAdd(fresh);
  return { added: fresh.length, skipped: rows.length - fresh.length };
}

/** Verify media against manifest.json, then merge by id; existing ids are skipped. */
export async function importArchive(file: Blob): Promise<ImportReport> {
  const zip = await JSZip.loadAsync(file);
  const vf = zip.file("vault.json");
  if (!vf) throw new Error("This file is not an Alien Technology archive.");
  const v = JSON.parse(await vf.async("string"));
  if (v.format !== "alien-technology/vault" && v.format !== "alien-technology/case") throw new Error("This file is not an Alien Technology archive.");
  const mf = zip.file("manifest.json");
  const manifest: ManifestEntry[] = mf ? JSON.parse(await mf.async("string")).media ?? [] : [];

  let mismatches = 0;
  const blobs: { id: string; data: Blob }[] = [];
  for (const m of manifest) {
    const f = zip.file(m.path);
    if (!f) {
      mismatches++;
      continue;
    }
    const data = new Blob([await f.async("arraybuffer")], { type: m.mimeType });
    if ((await sha256Hex(data)) !== m.sha256) mismatches++;
    blobs.push({ id: m.blobId, data });
  }

  const now = Date.now();
  const evidence: EvidenceRec[] = (v.evidence ?? []).map((e: EvidenceRec) => ({ ...e, custody: [...e.custody, { at: now, action: "imported", detail: "Imported from archive" }] }));

  const r = await db.transaction("rw", [db.cases, db.notes, db.subjects, db.links, db.evidence, db.boardPositions, db.blobs], async () => {
    await mergeTable(db.blobs, blobs);
    const c = await mergeTable(db.cases, v.cases ?? (v.case ? [v.case] : []));
    const n = await mergeTable(db.notes, v.notes);
    const s = await mergeTable(db.subjects, v.subjects);
    await mergeTable(db.links, v.links);
    const e = await mergeTable(db.evidence, evidence);
    await mergeTable(db.boardPositions, v.boardPositions);
    return { cases: c.added, notes: n.added, subjects: s.added, evidence: e.added, skipped: c.skipped + n.skipped + s.skipped + e.skipped };
  });
  return { ...r, mismatches };
}

export function reportText(r: ImportReport) {
  const pl = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return `Imported ${pl(r.cases, "case")}, ${pl(r.notes, "note")}, ${r.evidence} evidence item${r.evidence === 1 ? "" : "s"}. ${pl(r.mismatches, "hash mismatch").replace("mismatchs", "mismatches")}.${r.skipped ? ` ${r.skipped} existing records skipped.` : ""}`;
}
