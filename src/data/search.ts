import MiniSearch from "minisearch";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { db } from "./db";
import { noteHeadline } from "./rules";
import { isEncrypted } from "./seal";

export type HitKind = "case" | "subject" | "note" | "evidence";

export interface SearchDoc {
  id: string;
  kind: HitKind;
  caseId: string;
  codename: string;
  title: string;
  /** Searchable text with no redacted values */
  text: string;
  /** Redacted values: searchable, never displayed */
  hidden: string;
  noteType?: string;
}

/** Builds an in-memory index from Dexie; rebuilt whenever the data changes. Sealed and encrypted cases are excluded, and so is any record still carrying ciphertext. */
export function useSearchIndex() {
  const docs = useLiveQuery(async () => {
    const [cases, notes, subjects, evidence] = await Promise.all([db.cases.toArray(), db.notes.toArray(), db.subjects.toArray(), db.evidence.toArray()]);
    const open = new Map(cases.filter((c) => c.status !== "sealed" && !isEncrypted(c)).map((c) => [c.id, c.codename]));
    const out: SearchDoc[] = [];
    for (const c of cases) if (open.has(c.id)) out.push({ id: c.id, kind: "case", caseId: c.id, codename: c.codename, title: c.codename, text: "", hidden: "" });
    for (const n of notes) {
      const cn = n.enc ? undefined : open.get(n.caseId);
      if (cn) out.push({ id: n.id, kind: "note", caseId: n.caseId, codename: cn, title: noteHeadline(n), text: [n.body, n.transcript].filter(Boolean).join("\n"), hidden: "", noteType: n.type });
    }
    for (const s of subjects) {
      const cn = s.enc ? undefined : open.get(s.caseId);
      if (!cn) continue;
      const vis: string[] = [];
      const hid: string[] = [];
      s.aliases.forEach((a, i) => (s.redacted.includes(`alias:${i}`) ? hid : vis).push(a));
      s.fields.forEach((f) => (s.redacted.includes(`field:${f.key}`) ? hid : vis).push(`${f.key}: ${f.value}`));
      out.push({ id: s.id, kind: "subject", caseId: s.caseId, codename: cn, title: s.name, text: vis.join(" · "), hidden: hid.join(" ") });
    }
    for (const e of evidence) {
      const cn = e.enc ? undefined : open.get(e.caseId);
      if (cn) out.push({ id: e.id, kind: "evidence", caseId: e.caseId, codename: cn, title: e.fileName, text: e.kind, hidden: "" });
    }
    return { docs: out, sealed: cases.length - open.size };
  }, []);

  const index = useMemo(() => {
    if (!docs) return null;
    const ms = new MiniSearch<SearchDoc>({
      fields: ["title", "text", "hidden", "codename"],
      storeFields: ["id", "kind", "caseId", "codename", "title", "text", "hidden", "noteType"],
      searchOptions: { prefix: true, fuzzy: 0.15, boost: { title: 3, codename: 1.5 } },
    });
    ms.addAll(docs.docs);
    return ms;
  }, [docs]);

  return { index, sealedCount: docs?.sealed ?? 0, ready: !!index };
}

export function search(index: MiniSearch<SearchDoc> | null, q: string) {
  if (!index || !q.trim()) return [];
  return index.search(q.trim()).map((r) => ({ ...(r as unknown as SearchDoc), terms: r.terms, score: r.score }));
}
