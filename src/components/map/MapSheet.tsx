import { useMemo, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AudioWaveform, ChevronRight, File, FileText, UserRound } from "lucide-react";
import type { EntityKind, EvidenceRec, NoteRec } from "@/data/db";
import { useBlobUrl, useEntityLinks, type ResolvedLink } from "@/data/hooks";
import { Redact, Silhouette, SW, ThreatDot } from "@/components/at/ui";
import { typeIcon } from "@/components/at/notes";
import { compact, coords } from "@/lib/format";
import { cn } from "@/lib/utils";
import { kindLabel, type MapItem, type SubjectItem } from "./model";

interface Lookup {
  caseId: string;
  notesById: Map<string, NoteRec>;
  evidenceById: Map<string, EvidenceRec>;
  /** Evidence filed under each note, photos first */
  evidenceByNote: Map<string, EvidenceRec[]>;
}

export function sheetTitle(items: MapItem[]): string {
  return items.length === 1 ? kindLabel(items[0]!) : `${items.length} records at this location`;
}

/** Body of the sheet a pin opens: one block per record at that spot. */
export function MapSheetBody({ items, caseId, notes, evidence }: { items: MapItem[]; caseId: string; notes: NoteRec[]; evidence: EvidenceRec[] }) {
  const lookup = useMemo<Lookup>(() => {
    const evidenceByNote = new Map<string, EvidenceRec[]>();
    for (const e of evidence) {
      if (!e.noteId) continue;
      const list = evidenceByNote.get(e.noteId) ?? [];
      list.push(e);
      evidenceByNote.set(e.noteId, list);
    }
    for (const list of evidenceByNote.values()) list.sort((a, b) => Number(b.kind === "photo") - Number(a.kind === "photo"));
    return { caseId, notesById: new Map(notes.map((n) => [n.id, n])), evidenceById: new Map(evidence.map((e) => [e.id, e])), evidenceByNote };
  }, [caseId, notes, evidence]);
  const grouped = items.length > 1;
  return (
    <div className="pb-1">
      {items.map((it) => (
        <ItemBlock key={it.key} item={it} grouped={grouped} lookup={lookup} />
      ))}
    </div>
  );
}

function sourceLine(it: MapItem): string {
  if (it.kind === "note") return `${it.accuracy != null ? `±${Math.round(it.accuracy)} m · ` : ""}source: ${it.source}`;
  if (it.kind === "evidence") return "source: evidence record";
  return "source: dossier";
}

/** Links of the record plus those of the capture it is part of (a note and its evidence are one capture). */
function mergeLinks(own: ResolvedLink[] | undefined, related: ResolvedLink[] | undefined, self: Set<string>): ResolvedLink[] | undefined {
  if (!own || !related) return undefined;
  const seen = new Set<string>();
  const out: ResolvedLink[] = [];
  for (const l of [...own, ...related]) {
    const k = `${l.other.kind}:${l.other.id}:${l.label}`;
    if (self.has(l.other.id) || seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

function ItemBlock({ item, grouped, lookup }: { item: MapItem; grouped: boolean; lookup: Lookup }) {
  const filed = item.kind === "note" ? (lookup.evidenceByNote.get(item.id) ?? []) : [];
  const relatedId = item.kind === "note" ? (filed[0]?.id ?? "") : item.kind === "evidence" ? (item.evidence.noteId ?? "") : "";
  const own = useEntityLinks(item.id);
  const related = useEntityLinks(relatedId);
  const links = useMemo(() => mergeLinks(own, related, new Set([item.id, relatedId])), [own, related, item.id, relatedId]);
  const photo = item.kind === "note" ? filed.find((e) => e.kind === "photo") : item.kind === "evidence" && item.evidence.kind === "photo" ? item.evidence : undefined;

  return (
    <article className="border-line px-5 pt-1 pb-5 [&+&]:border-t [&+&]:pt-4">
      {grouped && <KindLine item={item} />}
      <div className="flex gap-3.5">
        {photo ? <EvidenceThumb e={photo} /> : item.kind === "subject" ? <SubjectThumb item={item} /> : <IconTile item={item} />}
        <div className="min-w-0 flex-1">
          <h3 className={cn("break-words text-ink", item.kind === "evidence" ? "font-mono text-[15px] leading-snug" : "font-serif text-[23px] leading-[1.1] font-semibold")}>
            {item.title}
            {item.kind === "subject" && <ThreatDot level={item.subject.threatLevel} className="ml-2 align-middle" />}
          </h3>
          {item.kind === "subject" && item.subject.lastSeen.place && (
            <div className="mt-1 font-mono text-[12px] text-ink-muted">
              <Redact text={item.subject.lastSeen.place} redacted={item.subject.redacted.includes("lastSeen.place")} />
            </div>
          )}
          {item.time != null && (
            <div className="mt-1 font-mono text-[12px] text-ink-muted">
              {item.kind === "subject" ? "Last seen " : ""}
              {compact(item.time)}
            </div>
          )}
        </div>
      </div>
      <div className="mt-3.5 flex items-center gap-3 border-t border-line pt-3.5">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[13px] text-ink">{coords(item.lat, item.lng)}</div>
          <div className="mt-0.5 font-mono text-[11px] text-ink-muted uppercase">{sourceLine(item)}</div>
        </div>
        <EntityLink kind={item.kind} id={item.id} caseId={lookup.caseId} className="btn btn-outline min-h-11 shrink-0 px-5" label={`Open ${item.title}`}>
          Open
        </EntityLink>
      </div>
      {links && (
        <section className="mt-4">
          <div className="mono-label mb-2">Connected entities ({links.length})</div>
          {links.length === 0 ? (
            <p className="text-[13px] text-ink-muted">No connections recorded.</p>
          ) : (
            <div className="card-at overflow-hidden">
              {links.map((l) => (
                <LinkRow key={l.linkId} link={l} lookup={lookup} />
              ))}
            </div>
          )}
        </section>
      )}
    </article>
  );
}

function KindLine({ item }: { item: MapItem }) {
  const Icon = glyphFor(item.kind, item.kind === "note" ? item.note : undefined, item.kind === "evidence" ? item.evidence : undefined);
  return (
    <div className="mb-2.5 flex items-center gap-1.5 font-mono text-[11px] tracking-[0.12em] text-amber uppercase">
      <Icon size={14} strokeWidth={SW} /> {kindLabel(item)}
    </div>
  );
}

function glyphFor(kind: EntityKind, note?: NoteRec, ev?: EvidenceRec) {
  if (kind === "subject") return UserRound;
  if (kind === "note") return note ? typeIcon[note.type] : FileText;
  return ev?.kind === "audio" ? AudioWaveform : File;
}

const tile = "size-[72px] shrink-0 overflow-hidden rounded-[10px] border border-line-strong bg-surface";

function EvidenceThumb({ e }: { e: EvidenceRec }) {
  const url = useBlobUrl(e.thumbBlobId ?? e.blobId);
  return (
    <Link to="/evidence/$eid" params={{ eid: e.id }} aria-label={`Open ${e.fileName}`} className={cn(tile, "block")}>
      {url && <img src={url} alt={e.fileName} className="photo size-full object-cover" />}
    </Link>
  );
}

function SubjectThumb({ item }: { item: SubjectItem }) {
  const url = useBlobUrl(item.subject.photoBlobId);
  return url ? <img src={url} alt={item.subject.name} className={cn(tile, "photo border-amber/50 object-cover")} /> : <Silhouette className={tile} />;
}

function IconTile({ item }: { item: MapItem }) {
  const Icon = glyphFor(item.kind, item.kind === "note" ? item.note : undefined, item.kind === "evidence" ? item.evidence : undefined);
  return (
    <div className={cn(tile, "grid place-items-center text-amber")} aria-hidden>
      <Icon size={26} strokeWidth={SW} />
    </div>
  );
}

function LinkRow({ link, lookup }: { link: ResolvedLink; lookup: Lookup }) {
  const { kind, id, name } = link.other;
  const ev = kind === "evidence" ? lookup.evidenceById.get(id) : undefined;
  const Icon = glyphFor(kind, kind === "note" ? lookup.notesById.get(id) : undefined, ev);
  return (
    <EntityLink kind={kind} id={id} caseId={lookup.caseId} className="flex min-h-14 items-center gap-3 border-t border-line px-3 py-2 first:border-t-0 active:bg-surface-raised">
      {ev?.kind === "photo" ? (
        <RowThumb e={ev} />
      ) : (
        <span className="grid size-9 shrink-0 place-items-center text-amber" aria-hidden>
          <Icon size={18} strokeWidth={SW} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[13px] text-ink">{name}</span>
        {link.label && <span className="block truncate font-mono text-[11px] text-ink-muted">{link.label}</span>}
      </span>
      <ChevronRight size={18} strokeWidth={SW} className="shrink-0 text-ink-muted" />
    </EntityLink>
  );
}

function RowThumb({ e }: { e: EvidenceRec }) {
  const url = useBlobUrl(e.thumbBlobId ?? e.blobId);
  return <span className="block size-9 shrink-0 overflow-hidden rounded-[6px] border border-line bg-surface-raised">{url && <img src={url} alt="" className="photo size-full object-cover" />}</span>;
}

function EntityLink({ kind, id, caseId, className, label, children }: { kind: EntityKind; id: string; caseId: string; className?: string; label?: string; children: ReactNode }) {
  if (kind === "subject")
    return (
      <Link to="/case/$id/subject/$sid" params={{ id: caseId, sid: id }} className={className} aria-label={label}>
        {children}
      </Link>
    );
  if (kind === "note")
    return (
      <Link to="/case/$id/note/$nid" params={{ id: caseId, nid: id }} className={className} aria-label={label}>
        {children}
      </Link>
    );
  return (
    <Link to="/evidence/$eid" params={{ eid: id }} className={className} aria-label={label}>
      {children}
    </Link>
  );
}
