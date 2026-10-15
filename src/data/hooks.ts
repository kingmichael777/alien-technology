import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { db, type EntityKind, type EvidenceRec, type LinkRec, type NoteRec, type SubjectRec } from "./db";
import { resolveCaptureCase, sortCases, noteHeadline } from "./rules";
import { isEncrypted } from "./seal";
import { useApp } from "@/store/app";
import { useUnlocked, type Bundle } from "@/store/unlocked";

export const useCases = () => useLiveQuery(async () => sortCases(await db.cases.toArray()), []);

export const useCase = (id: string | undefined) =>
  useLiveQuery(async () => (id ? ((await db.cases.get(id)) ?? null) : null), [id]);

// ---- Sort orders shared by the live reads and the unlocked overlay ----
// Both sides start from primary key order (an index read on caseId, noteId or subjectIds returns
// records by id; a bundle keeps its arrays in id order), so a stable sort gives identical results.
const newestFirst = (a: NoteRec, b: NoteRec) => b.createdAt - a.createdAt;
const oldestFirst = (a: NoteRec, b: NoteRec) => a.createdAt - b.createdAt;
const byName = (a: SubjectRec, b: SubjectRec) => a.name.localeCompare(b.name);
const latestCaptured = (a: EvidenceRec, b: EvidenceRec) => b.capturedAt - a.capturedAt;
const oldestLink = (a: LinkRec, b: LinkRec) => a.createdAt - b.createdAt;

export interface ResolvedLink {
  linkId: string;
  label: string;
  other: { id: string; kind: EntityKind; name: string };
}

const otherEnd = (l: LinkRec, id: string) => (l.fromId === id ? { id: l.toId, kind: l.toKind } : { id: l.fromId, kind: l.fromKind });

async function entityName(id: string, kind: EntityKind): Promise<string | null> {
  if (kind === "subject") return (await db.subjects.get(id))?.name ?? null;
  if (kind === "note") {
    const n = await db.notes.get(id);
    return n ? noteHeadline(n) : null;
  }
  return (await db.evidence.get(id))?.fileName ?? null;
}

/** The Dexie reads behind the hooks. */
export const liveReads = {
  caseNotes: async (caseId: string) => (await db.notes.where("caseId").equals(caseId).toArray()).sort(newestFirst),
  note: async (id: string) => (await db.notes.get(id)) ?? null,
  subjects: async (caseId: string) => (await db.subjects.where("caseId").equals(caseId).toArray()).sort(byName),
  subject: async (id: string) => (await db.subjects.get(id)) ?? null,
  subjectNotes: async (sid: string) => (await db.notes.where("subjectIds").equals(sid).toArray()).sort(oldestFirst),
  evidenceList: async (caseId: string) => (await db.evidence.where("caseId").equals(caseId).toArray()).sort(latestCaptured),
  evidence: async (id: string) => (await db.evidence.get(id)) ?? null,
  noteEvidence: (noteId: string) => db.evidence.where("noteId").equals(noteId).toArray(),
  audioEvidence: async (noteId: string) => (await db.evidence.where("noteId").equals(noteId).toArray()).find((e) => e.kind === "audio") ?? null,
  caseLinks: async (caseId: string) => (await db.links.where("caseId").equals(caseId).toArray()).sort(oldestLink),
  entityLinks: async (id: string): Promise<ResolvedLink[]> => {
    const [from, to] = await Promise.all([db.links.where("fromId").equals(id).toArray(), db.links.where("toId").equals(id).toArray()]);
    const out: ResolvedLink[] = [];
    for (const l of [...from, ...to].sort(oldestLink)) {
      const other = otherEnd(l, id);
      const name = await entityName(other.id, other.kind);
      if (name !== null) out.push({ linkId: l.id, label: l.label, other: { ...other, name } });
    }
    return out;
  },
};

const ownsNote = (b: Bundle, noteId: string) => b.notes.some((n) => n.id === noteId) || b.evidence.some((e) => e.noteId === noteId);
const ownsEntity = (b: Bundle, id: string) =>
  b.notes.some((n) => n.id === id) || b.subjects.some((s) => s.id === id) || b.evidence.some((e) => e.id === id) || b.links.some((l) => l.fromId === id || l.toId === id);

function bundleEntityName(b: Bundle, id: string, kind: EntityKind): string | null {
  if (kind === "subject") return b.subjects.find((s) => s.id === id)?.name ?? null;
  if (kind === "note") {
    const n = b.notes.find((x) => x.id === id);
    return n ? noteHeadline(n) : null;
  }
  return b.evidence.find((e) => e.id === id)?.fileName ?? null;
}

/** The same reads answered from an unlocked case. `undefined` means the bundle does not hold the answer. */
export const bundleReads = {
  caseNotes: (b: Bundle | null, caseId: string) => (b?.caseId === caseId ? [...b.notes].sort(newestFirst) : undefined),
  note: (b: Bundle | null, id: string) => b?.notes.find((n) => n.id === id),
  subjects: (b: Bundle | null, caseId: string) => (b?.caseId === caseId ? [...b.subjects].sort(byName) : undefined),
  subject: (b: Bundle | null, id: string) => b?.subjects.find((s) => s.id === id),
  subjectNotes: (b: Bundle | null, sid: string) => (b?.subjects.some((s) => s.id === sid) ? b.notes.filter((n) => n.subjectIds.includes(sid)).sort(oldestFirst) : undefined),
  evidenceList: (b: Bundle | null, caseId: string) => (b?.caseId === caseId ? [...b.evidence].sort(latestCaptured) : undefined),
  evidence: (b: Bundle | null, id: string) => b?.evidence.find((e) => e.id === id),
  noteEvidence: (b: Bundle | null, noteId: string) => (b && ownsNote(b, noteId) ? b.evidence.filter((e) => e.noteId === noteId) : undefined),
  audioEvidence: (b: Bundle | null, noteId: string) => (b && ownsNote(b, noteId) ? (b.evidence.filter((e) => e.noteId === noteId).find((e) => e.kind === "audio") ?? null) : undefined),
  caseLinks: (b: Bundle | null, caseId: string) => (b?.caseId === caseId ? [...b.links].sort(oldestLink) : undefined),
  entityLinks: (b: Bundle | null, id: string): ResolvedLink[] | undefined => {
    if (!b || !ownsEntity(b, id)) return undefined;
    const touching = [...b.links.filter((l) => l.fromId === id), ...b.links.filter((l) => l.toId === id)].sort(oldestLink);
    const out: ResolvedLink[] = [];
    for (const l of touching) {
      const other = otherEnd(l, id);
      const name = bundleEntityName(b, other.id, other.kind);
      if (name !== null) out.push({ linkId: l.id, label: l.label, other: { ...other, name } });
    }
    return out;
  },
};

const useBundle = () => useUnlocked((s) => s.bundle);

/**
 * Every case read hook runs its live query (rules of hooks), then answers from the unlocked bundle
 * when the record belongs to the case that is open in memory. Sealed records on disk are ciphertext.
 */
function useRead<T, L>(live: L | undefined, unlocked: T | undefined): T | L | undefined {
  return unlocked !== undefined ? unlocked : live;
}

export const useCaseNotes = (caseId: string) => {
  const live = useLiveQuery(() => liveReads.caseNotes(caseId), [caseId]);
  const b = useBundle();
  return useRead(live, useMemo(() => bundleReads.caseNotes(b, caseId), [b, caseId]));
};

export const useNote = (id: string) => {
  const live = useLiveQuery(() => liveReads.note(id), [id]);
  const b = useBundle();
  return useRead(live, useMemo(() => bundleReads.note(b, id), [b, id]));
};

export const useSubjects = (caseId: string) => {
  const live = useLiveQuery(() => liveReads.subjects(caseId), [caseId]);
  const b = useBundle();
  return useRead(live, useMemo(() => bundleReads.subjects(b, caseId), [b, caseId]));
};

export const useSubject = (id: string) => {
  const live = useLiveQuery(() => liveReads.subject(id), [id]);
  const b = useBundle();
  return useRead(live, useMemo(() => bundleReads.subject(b, id), [b, id]));
};

export const useSubjectNotes = (sid: string) => {
  const live = useLiveQuery(() => liveReads.subjectNotes(sid), [sid]);
  const b = useBundle();
  return useRead(live, useMemo(() => bundleReads.subjectNotes(b, sid), [b, sid]));
};

export const useEvidenceList = (caseId: string) => {
  const live = useLiveQuery(() => liveReads.evidenceList(caseId), [caseId]);
  const b = useBundle();
  return useRead(live, useMemo(() => bundleReads.evidenceList(b, caseId), [b, caseId]));
};

export const useEvidence = (id: string) => {
  const live = useLiveQuery(() => liveReads.evidence(id), [id]);
  const b = useBundle();
  return useRead(live, useMemo(() => bundleReads.evidence(b, id), [b, id]));
};

export const useNoteEvidence = (noteId: string) => {
  const live = useLiveQuery(() => liveReads.noteEvidence(noteId), [noteId]);
  const b = useBundle();
  return useRead(live, useMemo(() => bundleReads.noteEvidence(b, noteId), [b, noteId]));
};

/** Every link (red string) in a case, oldest first. */
export const useCaseLinks = (caseId: string) => {
  const live = useLiveQuery(() => liveReads.caseLinks(caseId), [caseId]);
  const b = useBundle();
  return useRead(live, useMemo(() => bundleReads.caseLinks(b, caseId), [b, caseId]));
};

/** Links touching an entity, resolved to the entity on the other end. */
export const useEntityLinks = (id: string) => {
  const live = useLiveQuery(() => liveReads.entityLinks(id), [id]);
  const b = useBundle();
  return useRead(live, useMemo(() => bundleReads.entityLinks(b, id), [b, id]));
};

export function useBlobUrl(id: string | null | undefined): string | undefined {
  const rec = useLiveQuery(async () => (id ? ((await db.blobs.get(id)) ?? null) : null), [id]);
  const b = useBundle();
  // Ciphertext never reaches the screen: a sealed blob shows only through the unlocked bundle.
  const data = (id ? b?.blobs.get(id) : undefined) ?? (rec && !rec.iv ? rec.data : undefined);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!data) {
      setUrl(undefined);
      return;
    }
    const u = URL.createObjectURL(data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [data]);
  return url;
}

export function useSetting<T>(key: string, fallback: T): T {
  const r = useLiveQuery(() => db.settings.get(key), [key]);
  return r === undefined ? fallback : (r.value as T);
}

export function useCaptureTarget() {
  const current = useApp((s) => s.currentCaseId);
  const override = useApp((s) => s.filingOverride);
  const lastId = useSetting<string | null>("lastActiveCaseId", null);
  const cases = useCases();
  return { cases: cases ?? [], target: resolveCaptureCase(cases ?? [], override ?? current, lastId), loading: cases === undefined };
}

/** Recent captures across all cases that are neither sealed nor encrypted. */
export const useRecentNotes = (limit = 20) =>
  useLiveQuery(async () => {
    const cases = await db.cases.toArray();
    const open = new Map(cases.filter((c) => c.status !== "sealed" && !isEncrypted(c)).map((c) => [c.id, c.codename]));
    const notes = await db.notes.orderBy("createdAt").reverse().filter((n) => open.has(n.caseId) && !n.enc).limit(limit).toArray();
    return notes.map((n) => ({ note: n, codename: open.get(n.caseId) ?? "" }));
  }, [limit]);

/**
 * For the vault trust line: how many cases are encrypted, and how many records still sit readable
 * inside sealed cases that were never encrypted (older or sample seals).
 */
export const useSealSummary = () =>
  useLiveQuery(async () => {
    const cases = await db.cases.toArray();
    const plain = cases.filter((c) => c.status === "sealed" && !isEncrypted(c)).map((c) => c.id);
    const counts = plain.length
      ? await Promise.all([db.notes, db.subjects, db.links, db.evidence].map((t) => t.where("caseId").anyOf(plain).count()))
      : [];
    return { encrypted: cases.filter(isEncrypted).length, readableInSealed: counts.reduce((a, n) => a + n, 0) };
  }, []);

export function useOnline() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const u = () => setOn(navigator.onLine);
    u();
    window.addEventListener("online", u);
    window.addEventListener("offline", u);
    return () => {
      window.removeEventListener("online", u);
      window.removeEventListener("offline", u);
    };
  }, []);
  return on;
}

export const useAudioEvidence = (noteId: string) => {
  const live = useLiveQuery(() => liveReads.audioEvidence(noteId), [noteId]);
  const b = useBundle();
  return useRead(live, useMemo(() => bundleReads.audioEvidence(b, noteId), [b, noteId]));
};
