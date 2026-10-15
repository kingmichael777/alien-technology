import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { db, type EntityKind } from "./db";
import { resolveCaptureCase, sortCases, noteHeadline } from "./rules";
import { useApp } from "@/store/app";

export const useCases = () => useLiveQuery(async () => sortCases(await db.cases.toArray()), []);

export const useCase = (id: string | undefined) =>
  useLiveQuery(async () => (id ? ((await db.cases.get(id)) ?? null) : null), [id]);

export const useCaseNotes = (caseId: string) =>
  useLiveQuery(async () => (await db.notes.where("caseId").equals(caseId).toArray()).sort((a, b) => b.createdAt - a.createdAt), [caseId]);

export const useNote = (id: string) => useLiveQuery(async () => (await db.notes.get(id)) ?? null, [id]);

export const useSubjects = (caseId: string) =>
  useLiveQuery(async () => (await db.subjects.where("caseId").equals(caseId).toArray()).sort((a, b) => a.name.localeCompare(b.name)), [caseId]);

export const useSubject = (id: string) => useLiveQuery(async () => (await db.subjects.get(id)) ?? null, [id]);

export const useSubjectNotes = (sid: string) =>
  useLiveQuery(async () => (await db.notes.where("subjectIds").equals(sid).toArray()).sort((a, b) => a.createdAt - b.createdAt), [sid]);

export const useEvidenceList = (caseId: string) =>
  useLiveQuery(async () => (await db.evidence.where("caseId").equals(caseId).toArray()).sort((a, b) => b.capturedAt - a.capturedAt), [caseId]);

export const useEvidence = (id: string) => useLiveQuery(async () => (await db.evidence.get(id)) ?? null, [id]);

export const useNoteEvidence = (noteId: string) => useLiveQuery(() => db.evidence.where("noteId").equals(noteId).toArray(), [noteId]);

export interface ResolvedLink {
  linkId: string;
  label: string;
  other: { id: string; kind: EntityKind; name: string };
}

/** Links touching an entity, resolved to the entity on the other end. */
export const useEntityLinks = (id: string) =>
  useLiveQuery(async (): Promise<ResolvedLink[]> => {
    const [from, to] = await Promise.all([db.links.where("fromId").equals(id).toArray(), db.links.where("toId").equals(id).toArray()]);
    const all = [...from, ...to].sort((a, b) => a.createdAt - b.createdAt);
    const out: ResolvedLink[] = [];
    for (const l of all) {
      const otherId = l.fromId === id ? l.toId : l.fromId;
      const kind = l.fromId === id ? l.toKind : l.fromKind;
      const name = await entityName(otherId, kind);
      if (name !== null) out.push({ linkId: l.id, label: l.label, other: { id: otherId, kind, name } });
    }
    return out;
  }, [id]);

async function entityName(id: string, kind: EntityKind): Promise<string | null> {
  if (kind === "subject") return (await db.subjects.get(id))?.name ?? null;
  if (kind === "note") {
    const n = await db.notes.get(id);
    return n ? noteHeadline(n) : null;
  }
  return (await db.evidence.get(id))?.fileName ?? null;
}

export function useBlobUrl(id: string | null | undefined): string | undefined {
  const rec = useLiveQuery(async () => (id ? ((await db.blobs.get(id)) ?? null) : null), [id]);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!rec?.data) {
      setUrl(undefined);
      return;
    }
    const u = URL.createObjectURL(rec.data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [rec]);
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

/** Recent captures across all cases that are not sealed. */
export const useRecentNotes = (limit = 20) =>
  useLiveQuery(async () => {
    const cases = await db.cases.toArray();
    const open = new Map(cases.filter((c) => c.status !== "sealed").map((c) => [c.id, c.codename]));
    const notes = await db.notes.orderBy("createdAt").reverse().filter((n) => open.has(n.caseId)).limit(limit).toArray();
    return notes.map((n) => ({ note: n, codename: open.get(n.caseId) ?? "" }));
  }, [limit]);

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

export const useAudioEvidence = (noteId: string) =>
  useLiveQuery(async () => (await db.evidence.where("noteId").equals(noteId).toArray()).find((e) => e.kind === "audio") ?? null, [noteId]);
