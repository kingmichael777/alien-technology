import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, Sparkles, X, AlertTriangle, Flag, Link2, MapPin, MoreHorizontal, Pencil, Trash2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useAudioEvidence, useBlobUrl, useCase, useEntityLinks, useNote, useNoteEvidence, useSubjects } from "@/data/hooks";
import type { EvidenceRec, NoteRec, SubjectRec } from "@/data/db";
import { noteRepo } from "@/data/repo";
import { noteHeadline, suggestEntities } from "@/data/rules";
import { BackLink, ConfirmSheet, IconButton, PageHeader, Sheet, SheetRow, SW } from "@/components/at/ui";
import { LinkPickerSheet, NoteEditor, SubjectChip, typeIcon, UnlinkButton } from "@/components/at/notes";
import { Markdown } from "@/components/at/Markdown";
import { EntityLink } from "./case.$id.subject.$sid";
import { compact, coords, duration } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/case/$id/note/$nid")({
  validateSearch: (s: Record<string, unknown>): { edit?: boolean | undefined } => ({ edit: s["edit"] === true || s["edit"] === "true" ? true : undefined }),
  head: () => ({
    meta: [
      { title: "Field note · Alien Technology" },
      { name: "description", content: "A field note with its linked subjects and evidence." },
      { property: "og:title", content: "Field note · Alien Technology" },
      { property: "og:description", content: "A field note with its linked subjects and evidence." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NoteScreen,
});

function NoteScreen() {
  const { id, nid } = Route.useParams();
  const { edit } = Route.useSearch();
  const n = useNote(nid);
  const c = useCase(id);
  const subjects = useSubjects(id) ?? [];
  const links = useEntityLinks(nid) ?? [];
  const evidence = useNoteEvidence(nid) ?? [];
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [del, setDel] = useState(false);
  const [picker, setPicker] = useState(false);
  const readOnly = c?.status !== "active";

  if (n === undefined) return null;
  if (n === null)
    return (
      <div className="px-6 py-24 text-center">
        <p className="font-serif text-2xl">This note is no longer on file.</p>
        <Link to="/case/$id" params={{ id }} className="btn btn-outline mt-6">Back to case</Link>
      </div>
    );

  const setEdit = (v: boolean) => navigate({ to: ".", search: { edit: v || undefined }, replace: true });
  const Icon = typeIcon[n.type];
  const linked = subjects.filter((s) => n.subjectIds.includes(s.id));

  return (
    <div>
      <PageHeader
        back={<BackLink to="/case/$id" params={{ id }} label="Back to case" />}
        title={<div className="truncate font-mono text-[11.5px] uppercase tracking-[0.12em] text-ink-muted">{c?.codename}</div>}
        right={
          !readOnly && !edit ? (
            <IconButton label="Note options" onClick={() => setMenu(true)}>
              <MoreHorizontal size={22} strokeWidth={SW} />
            </IconButton>
          ) : undefined
        }
      />
      {edit && !readOnly ? (
        <div className="px-5 pt-5">
          <NoteEditor caseId={id} note={n} onSaved={() => setEdit(false)} onCancel={() => setEdit(false)} />
        </div>
      ) : (
        <article className="anim-fade px-5 pt-5">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-amber">
            <Icon size={15} strokeWidth={SW} /> {n.type} note
            {n.flagged && (
              <span className="ml-auto inline-flex items-center gap-1"><AlertTriangle size={14} strokeWidth={SW} /> Flagged</span>
            )}
          </div>
          <h1 className="mt-2 font-serif text-[30px] leading-tight font-semibold text-ink">{noteHeadline(n)}</h1>
          <div className="mt-1.5 font-mono text-[12px] text-ink-muted">
            {compact(n.createdAt)}
            {n.updatedAt - n.createdAt > 60_000 && ` · edited ${compact(n.updatedAt)}`}
          </div>
          {linked.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{linked.map((s) => <SubjectChip key={s.id} s={s} />)}</div>}

          {n.location && (
            <div className="card-at mt-5 flex items-center gap-3 px-4 py-3">
              <MapPin size={22} strokeWidth={SW} className="text-amber" />
              <div>
                <div className="font-mono text-[13.5px] text-ink">{coords(n.location.lat, n.location.lng)}</div>
                <div className="font-mono text-[11px] text-ink-muted uppercase">
                  {n.location.accuracy != null && `±${n.location.accuracy} m · `}source: {n.location.source}
                </div>
              </div>
            </div>
          )}

          {evidence.some((e) => e.kind === "photo") && <div className="mt-5 space-y-2">{evidence.filter((e) => e.kind === "photo").map((e) => <EvidenceFigure key={e.id} e={e} />)}</div>}

          {n.type === "voice" && <VoiceBlock n={n} readOnly={readOnly} />}

          {n.body && <div className="mt-5"><Markdown source={n.body} /></div>}
          {!n.body && n.type === "text" && <p className="mt-5 text-sm text-ink-muted">No body text.</p>}
          {!readOnly && <Suggestions n={n} subjects={subjects} />}

          <section className="mt-8">
            <div className="mb-2 flex items-center justify-between">
              <div className="section-label">Connected entities ({links.length})</div>
              {!readOnly && (
                <button className="tap -mr-2 inline-flex items-center gap-1.5 px-2 font-mono text-[11px] uppercase tracking-[0.1em] text-amber" onClick={() => setPicker(true)}>
                  <Link2 size={15} strokeWidth={SW} /> Link
                </button>
              )}
            </div>
            {links.length === 0 && <p className="text-sm text-ink-muted">No connections recorded.</p>}
            <div className="card-at overflow-hidden">
              {links.map((l) => (
                <div key={l.linkId} className="flex items-center border-b border-line pl-4 last:border-b-0">
                  <EntityLink kind={l.other.kind} id={l.other.id} caseId={id} className="flex min-h-14 flex-1 items-center gap-2 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[13px] text-ink">{l.other.name}</span>
                      <span className="block truncate font-mono text-[11px] text-ink-muted">{l.label}</span>
                    </span>
                    <ChevronRight size={18} strokeWidth={SW} className="text-ink-muted" />
                  </EntityLink>
                  <UnlinkButton linkId={l.linkId} disabled={readOnly} />
                </div>
              ))}
            </div>
          </section>
        </article>
      )}

      <Sheet open={menu} onClose={() => setMenu(false)} title="Note">
        <SheetRow icon={<Pencil size={20} strokeWidth={SW} />} label="Edit" onClick={() => { setMenu(false); setEdit(true); }} />
        <SheetRow icon={<Flag size={20} strokeWidth={SW} />} label={n.flagged ? "Remove flag" : "Flag"} onClick={async () => { await noteRepo.update(n.id, { flagged: !n.flagged }); setMenu(false); }} />
        <SheetRow icon={<Link2 size={20} strokeWidth={SW} />} label="Link to subject or note" onClick={() => { setMenu(false); setPicker(true); }} />
        <SheetRow icon={<Trash2 size={20} strokeWidth={SW} />} label="Delete note" danger onClick={() => { setMenu(false); setDel(true); }} />
      </Sheet>
      <ConfirmSheet
        open={del}
        onClose={() => setDel(false)}
        title="Delete note"
        body="This note and its links are removed from this device. Attached evidence stays in the case."
        confirmLabel="Delete note"
        onConfirm={async () => {
          await noteRepo.remove(n.id);
          toast("Note deleted.");
          navigate({ to: "/case/$id", params: { id } });
        }}
      />
      <LinkPickerSheet open={picker} onClose={() => setPicker(false)} caseId={id} from={{ id: n.id, kind: "note" }} />
    </div>
  );
}

function EvidenceFigure({ e }: { e: EvidenceRec }) {
  const url = useBlobUrl(e.blobId);
  return (
    <Link to="/evidence/$eid" params={{ eid: e.id }} className="card-at block overflow-hidden">
      {url && <img src={url} alt={e.fileName} className="photo w-full object-cover" />}
      <div className="flex justify-between px-3 py-2 font-mono text-[11px] text-ink-muted">
        <span>{e.fileName}</span>
        <span>{compact(e.capturedAt)}</span>
      </div>
    </Link>
  );
}

function VoiceBlock({ n, readOnly }: { n: NoteRec; readOnly: boolean }) {
  const ev = useAudioEvidence(n.id);
  const url = useBlobUrl(ev?.blobId);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [text, setText] = useState(n.transcript);
  useEffect(() => setText(n.transcript), [n.transcript]);
  const total = n.durationMs / 1000;
  const dirty = text !== n.transcript;

  return (
    <div className="mt-5 space-y-4">
      {url ? (
        <div className="card-at flex items-center gap-3 px-3 py-2.5">
          <audio
            ref={audio}
            src={url}
            preload="metadata"
            onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
            onEnded={() => setPlaying(false)}
            onPause={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
          />
          <button aria-label={playing ? "Pause" : "Play"} className="tap inline-flex items-center justify-center rounded-full text-amber" onClick={() => (playing ? audio.current?.pause() : void audio.current?.play())}>
            {playing ? <Pause size={22} strokeWidth={SW} /> : <Play size={22} strokeWidth={SW} />}
          </button>
          <span className="w-11 font-mono text-[11px] text-ink-muted tabular-nums">{duration(t * 1000)}</span>
          <input
            aria-label="Playback position"
            type="range"
            min={0}
            max={total || 1}
            step={0.05}
            value={Math.min(t, total)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (audio.current) audio.current.currentTime = v;
              setT(v);
            }}
            className="h-1 flex-1 cursor-pointer accent-[var(--amber)]"
          />
          <span className="w-11 text-right font-mono text-[11px] text-ink-muted tabular-nums">{duration(n.durationMs)}</span>
        </div>
      ) : (
        <p className="font-mono text-[11px] text-ink-faint">Transcript only. No audio attached.</p>
      )}
      <div>
        <div className="mono-label mb-2">Transcript{n.durationMs ? ` · ${duration(n.durationMs)}` : ""}</div>
        {readOnly ? (
          <p className="card-at px-4 py-3 font-mono text-[13px] leading-relaxed text-ink">{n.transcript || "No transcript."}</p>
        ) : (
          <>
            <textarea className="field min-h-[120px] font-mono text-[13px] leading-relaxed" placeholder="No transcript. Type one here." value={text} onChange={(e) => setText(e.target.value)} />
            {dirty && (
              <div className="mt-2 flex gap-2">
                <button className="btn btn-ghost flex-1" onClick={() => setText(n.transcript)}>Revert</button>
                <button className="btn btn-primary flex-1" onClick={async () => { await noteRepo.update(n.id, { transcript: text }); toast.success("Transcript saved."); }}>Save transcript</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Suggestions({ n, subjects }: { n: NoteRec; subjects: SubjectRec[] }) {
  const text = [n.title, n.body, n.transcript].join("\n");
  const sug = suggestEntities(text, subjects);
  const dismissed = new Set(n.dismissed ?? []);
  const subs = sug.subjectIds.filter((id) => !n.subjectIds.includes(id) && !dismissed.has(`subject:${id}`));
  const pts = n.location ? [] : sug.coords.filter((c) => !dismissed.has(`coords:${c.lat},${c.lng}`)).slice(0, 2);
  if (!subs.length && !pts.length) return null;
  const dismiss = (k: string) => noteRepo.update(n.id, { dismissed: [...(n.dismissed ?? []), k] });
  const chip = "inline-flex min-h-9 items-center gap-2 rounded-full border border-amber-line bg-amber-fill pl-3 font-mono text-[12px] text-amber";
  return (
    <div className="anim-fade mt-5">
      <div className="mono-label mb-2 flex items-center gap-1.5 text-ink-muted"><Sparkles size={13} strokeWidth={SW} /> Suggestions</div>
      <div className="flex flex-wrap gap-2">
        {subs.map((id) => {
          const s = subjects.find((x) => x.id === id)!;
          return (
            <span key={id} className={chip}>
              <button className="min-h-9" onClick={() => noteRepo.update(n.id, { subjectIds: [...n.subjectIds, id] })}>Link to {s.name}</button>
              <button aria-label="Dismiss" className="inline-flex size-9 items-center justify-center text-ink-muted" onClick={() => dismiss(`subject:${id}`)}><X size={14} strokeWidth={SW} /></button>
            </span>
          );
        })}
        {pts.map((c) => (
          <span key={`${c.lat},${c.lng}`} className={cn(chip)}>
            <button className="min-h-9" onClick={() => noteRepo.update(n.id, { location: { lat: c.lat, lng: c.lng, accuracy: null, source: "manual" } })}>Add as location {coords(c.lat, c.lng)}</button>
            <button aria-label="Dismiss" className="inline-flex size-9 items-center justify-center text-ink-muted" onClick={() => dismiss(`coords:${c.lat},${c.lng}`)}><X size={14} strokeWidth={SW} /></button>
          </span>
        ))}
      </div>
    </div>
  );
}
