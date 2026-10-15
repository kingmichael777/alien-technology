import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { AudioWaveform, MoreHorizontal, Plus, Lock, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { useBlobUrl, useCase, useCaseNotes, useEvidenceList, useSubjects } from "@/data/hooks";
import type { CaseRec, EvidenceRec, NoteType, SubjectRec } from "@/data/db";
import { caseRepo, subjectRepo } from "@/data/repo";
import { isEncrypted } from "@/data/seal";
import { BackLink, EmptyState, IconButton, PageHeader, QuietState, Silhouette, splitCodename, StatusPill, SW, ThreatDot } from "@/components/at/ui";
import { CaseActionsSheet, filterChips, matchesTimeline, NO_FILTER, TimelineFilterSheet, type TimelineFilter } from "@/components/at/CaseSheets";
import { UnsealSheet } from "@/components/seal/UnsealSheet";
import { SEALED_ENCRYPTED } from "@/components/seal/SealMark";
import { NoteRow } from "@/components/at/notes";
import { CaseBoardTab } from "@/components/board/CaseBoardTab";
import { CaseMapTab } from "@/components/map/CaseMapTab";
import { compact, dayHeader } from "@/lib/format";
import { cn } from "@/lib/utils";

const TABS = ["timeline", "subjects", "notes", "evidence", "map", "board"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/case/$id/")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab | undefined } => ({
    tab: TABS.includes(s["tab"] as Tab) ? (s["tab"] as Tab) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Case file · Alien Technology" },
      { name: "description", content: "Timeline, subjects, notes and evidence for one case vault." },
      { property: "og:title", content: "Case file · Alien Technology" },
      { property: "og:description", content: "Timeline, subjects, notes and evidence for one case vault." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CaseScreen,
});

function CaseScreen() {
  const { id } = Route.useParams();
  const { tab = "timeline" } = Route.useSearch();
  const c = useCase(id);
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  if (!c) return null;
  const readOnly = c.status !== "active";

  return (
    <div>
      <PageHeader
        back={<BackLink to="/" label="Vault" />}
        title={<CaseTitle codename={c.codename} />}
        right={
          <div className="flex items-center gap-1">
            <StatusPill status={c.status} encrypted={isEncrypted(c)} />
            <IconButton label="Case options" onClick={() => setMenu(true)}>
              <MoreHorizontal size={22} strokeWidth={SW} />
            </IconButton>
          </div>
        }
        sub={<TabStrip id={id} tab={tab} />}
      />
      {readOnly && <ReadOnlyBanner c={c} />}
      <div className="px-4 pt-4">
        {tab === "timeline" && <Timeline caseId={id} />}
        {tab === "subjects" && <SubjectsTab c={c} />}
        {tab === "notes" && <NotesTab c={c} />}
        {tab === "evidence" && <EvidenceTab caseId={id} />}
        {tab === "map" && <CaseMapTab c={c} />}
        {tab === "board" && <CaseBoardTab c={c} />}
      </div>
      <CaseActionsSheet c={c} open={menu} onClose={() => setMenu(false)} onDeleted={() => navigate({ to: "/" })} />
    </div>
  );
}

/** Case tabs. The active tab is scrolled into view, so MAP and BOARD are visible when opened directly. */
function TabStrip({ id, tab }: { id: string; tab: Tab }) {
  const strip = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = strip.current;
    const active = box?.querySelector<HTMLElement>('[data-active="true"]');
    if (!box || !active) return;
    const left = active.offsetLeft - (box.clientWidth - active.offsetWidth) / 2;
    box.scrollTo({ left: Math.max(0, left), behavior: "auto" });
  }, [tab]);
  return (
    <div ref={strip} className="no-scrollbar flex gap-6 overflow-x-auto px-5">
      {TABS.map((t) => (
        <Link
          key={t}
          to="/case/$id"
          params={{ id }}
          search={{ tab: t }}
          replace
          data-active={tab === t}
          className={cn("relative flex h-11 shrink-0 items-center font-mono text-[12px] uppercase tracking-[0.12em] transition-colors", tab === t ? "text-amber" : "text-ink-muted")}
        >
          {t}
          {tab === t && <span className="absolute inset-x-0 bottom-0 h-px bg-amber" />}
        </Link>
      ))}
    </div>
  );
}

/** Never truncated: "OPERATION" as a small amber label over "NIGHTFALL" in serif. No colon, no label. */
function CaseTitle({ codename }: { codename: string }) {
  const { label, name } = splitCodename(codename);
  return (
    <h1 className="py-1.5">
      {label && <span className="block font-mono text-[10.5px] leading-4 font-medium tracking-[0.18em] text-amber uppercase">{label}</span>}
      <span className="codename block text-[22px] leading-[1.12] break-words text-ink">{name}</span>
    </h1>
  );
}

function ReadOnlyBanner({ c }: { c: CaseRec }) {
  const encrypted = isEncrypted(c);
  const [unseal, setUnseal] = useState(false);
  const reopen = async () => {
    try {
      await caseRepo.setStatus(c.id, "active");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="flex items-center gap-3 border-b border-line bg-surface px-5 py-2.5">
      <Lock size={15} strokeWidth={SW} className={encrypted ? "text-amber" : "text-ink-muted"} />
      <span className="flex-1 font-mono text-[11px] tracking-[0.12em] text-ink-muted uppercase">{encrypted ? SEALED_ENCRYPTED : `${c.status} · Read only`}</span>
      <button className="btn btn-outline min-h-9 px-3 text-xs" onClick={() => (encrypted ? setUnseal(true) : void reopen())}>
        {c.status === "sealed" ? "Unseal" : "Reopen"}
      </button>
      {encrypted && <UnsealSheet c={c} open={unseal} onClose={() => setUnseal(false)} />}
    </div>
  );
}

const TYPE_FILTERS: { key: "all" | NoteType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "voice", label: "Voice" },
  { key: "photo", label: "Photo" },
  { key: "text", label: "Text" },
  { key: "location", label: "Location" },
];

function Chip({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn("min-h-9 shrink-0 rounded-full border px-3 font-mono text-[11.5px] uppercase tracking-[0.08em]", on ? "border-amber-line bg-amber-fill text-amber" : "border-line-strong text-ink-muted")}>
      {children}
    </button>
  );
}

function Timeline({ caseId }: { caseId: string }) {
  const notes = useCaseNotes(caseId);
  const subjects = useSubjects(caseId) ?? [];
  const [type, setType] = useState<"all" | NoteType>("all");
  const [filter, setFilter] = useState<TimelineFilter>(NO_FILTER);
  const [sheet, setSheet] = useState(false);

  const groups = useMemo(() => {
    const now = Date.now();
    const f = (notes ?? []).filter((n) => (type === "all" || n.type === type) && matchesTimeline(n, filter, now));
    const map = new Map<string, typeof f>();
    for (const n of f) {
      const k = dayHeader(n.createdAt);
      map.set(k, [...(map.get(k) ?? []), n]);
    }
    return [...map.entries()];
  }, [notes, type, filter]);

  if (!notes) return null;
  if (notes.length === 0) return <EmptyState title="Nothing on the timeline." body="Captures filed to this case appear here, newest first." />;
  const chips = filterChips(filter, subjects);

  return (
    <div>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-2.5">
        {TYPE_FILTERS.map((t) => (
          <Chip key={t.key} on={type === t.key} onClick={() => setType(t.key)}>
            {t.label}
          </Chip>
        ))}
      </div>
      {/* Subject and date filters live in a sheet; what is applied shows here as removable chips. */}
      <div className="flex flex-wrap items-center gap-2 pb-4">
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setSheet(true)}
          className={cn("inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 font-mono text-[11.5px] uppercase tracking-[0.08em]", chips.length ? "border-amber-line text-amber" : "border-line-strong text-ink-muted")}
        >
          <SlidersHorizontal size={14} strokeWidth={SW} />
          Filter
        </button>
        {chips.map((ch) => (
          <button
            key={ch.key}
            type="button"
            aria-label={`Remove filter ${ch.label}`}
            onClick={() => setFilter(ch.next)}
            className="anim-fade inline-flex min-h-9 items-center gap-1.5 rounded-full border border-amber-line bg-amber-fill pr-2.5 pl-3 font-mono text-[11px] uppercase tracking-[0.08em] text-amber"
          >
            {ch.label}
            <X size={13} strokeWidth={SW} />
          </button>
        ))}
        {chips.length > 1 && (
          <button type="button" className="min-h-9 px-1 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-muted" onClick={() => setFilter(NO_FILTER)}>
            Clear all
          </button>
        )}
      </div>
      <TimelineFilterSheet open={sheet} onClose={() => setSheet(false)} subjects={subjects} value={filter} onChange={setFilter} />
      {groups.length === 0 && <EmptyState title="No entries match." body="Adjust the filters to widen the record." />}
      {groups.map(([day, items]) => (
        <section key={day} className="mb-5">
          <div className="mb-2 flex items-center gap-3">
            <span className="font-mono text-[11px] tracking-[0.14em] text-ink-muted">{day}</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="space-y-2">
            {items.map((n) => <NoteRow key={n.id} n={n} subjects={subjects} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function SubjectThumb({ s }: { s: SubjectRec }) {
  const url = useBlobUrl(s.photoBlobId);
  return url ? <img src={url} alt="" className="photo size-14 rounded-[8px] border border-amber/50 object-cover" /> : <Silhouette className="size-14 rounded-[8px] border border-line-strong" />;
}

function SubjectsTab({ c }: { c: CaseRec }) {
  const subjects = useSubjects(c.id);
  const navigate = useNavigate();
  if (!subjects) return null;
  const add = async () => {
    const sid = await subjectRepo.create(c.id);
    navigate({ to: "/case/$id/subject/$sid", params: { id: c.id, sid }, search: { edit: true } });
  };
  return (
    <div className="space-y-2">
      {c.status === "active" && (
        <button className="btn btn-outline mb-2 w-full" onClick={add}>
          <Plus size={18} strokeWidth={SW} /> New subject
        </button>
      )}
      {subjects.length === 0 && <EmptyState title="No subjects on file." body="Open a dossier for each person of interest." />}
      {subjects.map((s) => (
        <Link key={s.id} to="/case/$id/subject/$sid" params={{ id: c.id, sid: s.id }} className="card-at anim-fade flex items-center gap-4 p-3 active:bg-surface-raised">
          <SubjectThumb s={s} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-serif text-xl font-semibold text-ink">{s.name}</div>
            <div className="truncate font-mono text-[12px] text-ink-muted">{s.aliases.find((_, i) => !s.redacted.includes(`alias:${i}`)) ?? "No known aliases"}</div>
          </div>
          <ThreatDot level={s.threatLevel} />
        </Link>
      ))}
    </div>
  );
}

function NotesTab({ c }: { c: CaseRec }) {
  const notes = useCaseNotes(c.id);
  const subjects = useSubjects(c.id) ?? [];
  const [q, setQ] = useState("");
  if (!notes) return null;
  const ql = q.trim().toLowerCase();
  const list = ql ? notes.filter((n) => [n.title, n.body, n.transcript].join(" ").toLowerCase().includes(ql)) : notes;
  return (
    <div className="space-y-2">
      <div className="flex gap-2 pb-2">
        <input className="field" placeholder="Filter notes" value={q} onChange={(e) => setQ(e.target.value)} />
        {c.status === "active" && (
          <Link to="/capture/text" aria-label="New text note" className="btn btn-outline shrink-0 px-3">
            <Plus size={18} strokeWidth={SW} />
          </Link>
        )}
      </div>
      {notes.length === 0 && <EmptyState title="No notes in this case." />}
      {notes.length > 0 && list.length === 0 && <EmptyState title="No notes match." />}
      {list.map((n) => <NoteRow key={n.id} n={n} subjects={subjects} />)}
    </div>
  );
}

function EvidenceTile({ e }: { e: EvidenceRec }) {
  const url = useBlobUrl(e.thumbBlobId ?? e.blobId);
  return (
    <Link to="/evidence/$eid" params={{ eid: e.id }} aria-label={`Open ${e.fileName}`} className="relative block aspect-square overflow-hidden rounded-[10px] border border-line bg-surface-raised">
      {url && <img src={url} alt={e.fileName} className="photo size-full object-cover" />}
      <span className="absolute inset-x-0 bottom-0 truncate bg-bg/70 px-1.5 py-0.5 font-mono text-[9.5px] text-ink-muted">{e.fileName}</span>
    </Link>
  );
}

function EvidenceTab({ caseId }: { caseId: string }) {
  const ev = useEvidenceList(caseId);
  if (!ev) return null;
  const photos = ev.filter((e) => e.kind === "photo");
  const audio = ev.filter((e) => e.kind !== "photo");
  if (ev.length === 0) return <EmptyState title="No evidence logged." body="Photos taken with the camera button are hashed and logged here." />;
  return (
    <div className="space-y-6">
      <section>
        <div className="section-label mb-3">Photographs</div>
        {photos.length === 0 ? <p className="text-sm text-ink-muted">No photographs.</p> : <div className="grid grid-cols-3 gap-2">{photos.map((e) => <EvidenceTile key={e.id} e={e} />)}</div>}
      </section>
      <section>
        <div className="section-label mb-3">Audio and files</div>
        {audio.length === 0 ? (
          <p className="text-sm text-ink-muted">No recordings yet.</p>
        ) : (
          <div className="space-y-2">
            {audio.map((e) => (
              <Link key={e.id} to="/evidence/$eid" params={{ eid: e.id }} className="card-at flex items-center gap-3 px-4 py-3">
                <AudioWaveform size={20} strokeWidth={SW} className="text-amber" />
                <span className="flex-1 truncate font-mono text-[13px]">{e.fileName}</span>
                <span className="font-mono text-[11px] text-ink-muted">{compact(e.capturedAt)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
