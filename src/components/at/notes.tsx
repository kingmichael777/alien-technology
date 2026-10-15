import { useEffect, useRef, useState } from "react";
import { startFix } from "@/lib/location";
import type { GeoPoint } from "@/data/db";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, AudioWaveform, Camera, FileText, MapPin, Flag, Link2, X } from "lucide-react";
import { toast } from "sonner";
import type { EntityKind, NoteRec, NoteType, SubjectRec } from "@/data/db";
import { linkRepo, noteRepo } from "@/data/repo";
import { useCaseNotes, useEntityLinks, useSubjects } from "@/data/hooks";
import { noteHeadline } from "@/data/rules";
import { clock, compact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Sheet, SW } from "./ui";

export const typeIcon: Record<NoteType, typeof FileText> = { text: FileText, voice: AudioWaveform, photo: Camera, location: MapPin };

export function SubjectChip({ s }: { s: Pick<SubjectRec, "id" | "name" | "caseId"> }) {
  return (
    <Link
      to="/case/$id/subject/$sid"
      params={{ id: s.caseId, sid: s.id }}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex h-6 items-center rounded-full border border-line-strong px-2 font-mono text-[11px] text-ink-muted"
    >
      {s.name}
    </Link>
  );
}

export function NoteRow({ n, subjects }: { n: NoteRec; subjects: SubjectRec[] }) {
  const Icon = typeIcon[n.type];
  const linked = subjects.filter((s) => n.subjectIds.includes(s.id));
  return (
    <Link to="/case/$id/note/$nid" params={{ id: n.caseId, nid: n.id }} className="card-at anim-fade flex gap-3 px-4 py-3.5 active:bg-surface-raised">
      <Icon size={20} strokeWidth={SW} className="mt-0.5 shrink-0 text-amber" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 text-[14.5px] leading-snug text-ink">{noteHeadline(n)}</div>
          {n.flagged && <AlertTriangle size={16} strokeWidth={SW} className="shrink-0 text-amber" aria-label="Flagged" />}
        </div>
        <div className="mt-1 font-mono text-[11px] text-ink-muted">{compact(n.createdAt)}</div>
        {linked.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {linked.map((s) => <span key={s.id} className="inline-flex h-6 items-center rounded-full border border-line-strong px-2 font-mono text-[11px] text-ink-muted">{s.name}</span>)}
          </div>
        )}
      </div>
    </Link>
  );
}

export function MiniWave() {
  const h = [4, 8, 5, 12, 7, 16, 10, 6, 13, 5, 9, 4];
  return (
    <svg viewBox="0 0 48 20" className="h-5 w-12 text-ink-muted" aria-hidden>
      {h.map((v, i) => <rect key={i} x={i * 4} y={10 - v / 2} width="1.5" height={v} fill="currentColor" />)}
    </svg>
  );
}

/** Note editor: serif title, Markdown body, subject links, flag. */
export function NoteEditor({ caseId, note, onSaved, onCancel }: { caseId: string | null; note?: NoteRec; onSaved: (id: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [subjectIds, setSubjectIds] = useState<string[]>(note?.subjectIds ?? []);
  const [flagged, setFlagged] = useState(note?.flagged ?? false);
  const [busy, setBusy] = useState(false);
  const subjects = useSubjects(caseId ?? "") ?? [];
  const fix = useRef<Promise<GeoPoint | null> | null>(null);
  useEffect(() => {
    if (!note && !fix.current) fix.current = startFix();
  }, [note]);
  const empty = !title.trim() && !body.trim() && !(note && note.type !== "text");

  const save = async () => {
    if (!caseId) {
      toast.error("Choose a case before saving.");
      return;
    }
    setBusy(true);
    try {
      if (note) {
        await noteRepo.update(note.id, { title, body, subjectIds, flagged });
        onSaved(note.id);
      } else {
        const id = await noteRepo.create(caseId, { type: "text", title, body, subjectIds, flagged });
        void fix.current?.then((p) => p && noteRepo.attachLocation(id, p));
        onSaved(id);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <input className="w-full bg-transparent font-serif text-[28px] leading-tight font-semibold text-ink outline-none placeholder:text-ink-faint" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea
        className="field min-h-[220px] resize-y font-sans text-[15px] leading-relaxed"
        placeholder={"Observations. Markdown supported:\n# Heading, **bold**, *italic*, - list"}
        value={body}
        autoFocus={!note}
        onChange={(e) => setBody(e.target.value)}
      />
      <div>
        <div className="mono-label mb-2">Linked subjects</div>
        {subjects.length === 0 ? (
          <p className="text-sm text-ink-muted">No subjects in this case yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {subjects.map((s) => {
              const on = subjectIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSubjectIds(on ? subjectIds.filter((x) => x !== s.id) : [...subjectIds, s.id])}
                  className={cn("min-h-9 rounded-full border px-3 font-mono text-[12px]", on ? "border-amber-line bg-amber-fill text-amber" : "border-line-strong text-ink-muted")}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <button type="button" onClick={() => setFlagged(!flagged)} className={cn("btn w-full justify-start", flagged ? "btn-outline" : "btn-ghost")}>
        <Flag size={18} strokeWidth={SW} />
        {flagged ? "Flagged" : "Flag this note"}
      </button>
      <div className="flex gap-3">
        <button type="button" className="btn btn-ghost flex-1" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary flex-1" disabled={busy || empty || !caseId} onClick={save}>
          Save note
        </button>
      </div>
    </div>
  );
}

/** Pick a subject or note in this case and label the connection. */
export function LinkPickerSheet({ open, onClose, caseId, from }: { open: boolean; onClose: () => void; caseId: string; from: { id: string; kind: EntityKind } }) {
  const [tab, setTab] = useState<"subject" | "note">("subject");
  const [label, setLabel] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const subjects = (useSubjects(caseId) ?? []).filter((s) => s.id !== from.id);
  const notes = (useCaseNotes(caseId) ?? []).filter((n) => n.id !== from.id);
  const existing = useEntityLinks(from.id) ?? [];
  const taken = new Set(existing.map((l) => l.other.id));
  const items = tab === "subject" ? subjects.map((s) => ({ id: s.id, name: s.name, meta: s.aliases[0] ?? "" })) : notes.map((n) => ({ id: n.id, name: noteHeadline(n), meta: compact(n.createdAt) }));

  return (
    <Sheet open={open} onClose={onClose} title="Link">
      <div className="flex gap-2 px-5 pb-3">
        {(["subject", "note"] as const).map((t) => (
          <button key={t} onClick={() => { setTab(t); setSel(null); }} className={cn("min-h-9 flex-1 rounded-full border font-mono text-[11.5px] uppercase tracking-[0.1em]", tab === t ? "border-amber-line bg-amber-fill text-amber" : "border-line-strong text-ink-muted")}>
            {t === "subject" ? "Subjects" : "Notes"}
          </button>
        ))}
      </div>
      <div className="max-h-[38vh] overflow-y-auto">
        {items.length === 0 && <p className="px-5 py-4 text-sm text-ink-muted">Nothing to link in this case yet.</p>}
        {items.map((it) => (
          <button key={it.id} disabled={taken.has(it.id)} onClick={() => setSel(it.id)} className={cn("flex min-h-14 w-full items-center gap-3 border-t border-line px-5 text-left disabled:opacity-35", sel === it.id && "bg-amber-fill")}>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[13px] text-ink">{it.name}</span>
              <span className="block truncate font-mono text-[11px] text-ink-muted">{taken.has(it.id) ? "Already linked" : it.meta}</span>
            </span>
            {sel === it.id && <Link2 size={18} strokeWidth={SW} className="text-amber" />}
          </button>
        ))}
      </div>
      <div className="space-y-3 border-t border-line px-5 pt-4">
        <input className="field font-mono text-[13px]" placeholder="Relationship, e.g. Associate / Possible Contact" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button
          className="btn btn-primary w-full"
          disabled={!sel}
          onClick={async () => {
            try {
              await linkRepo.create(caseId, from, { id: sel!, kind: tab }, label || (tab === "subject" ? "Associate" : "Related note"));
              setSel(null);
              setLabel("");
              onClose();
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        >
          Create link
        </button>
      </div>
    </Sheet>
  );
}

export function UnlinkButton({ linkId, disabled }: { linkId: string; disabled?: boolean }) {
  if (disabled) return null;
  return (
    <button aria-label="Remove link" className="tap inline-flex items-center justify-center text-ink-faint active:text-pin" onClick={(e) => { e.stopPropagation(); void linkRepo.remove(linkId); }}>
      <X size={16} strokeWidth={SW} />
    </button>
  );
}

export { clock };
