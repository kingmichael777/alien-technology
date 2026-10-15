import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Box, Check, FileText, MapPin, UserPlus, FolderPlus, Pencil, Download, Trash2, Layers, Lock } from "lucide-react";
import { toast } from "sonner";
import type { CaseRec, CaseStatus, NoteRec, SubjectRec } from "@/data/db";
import { caseRepo, noteRepo, subjectRepo } from "@/data/repo";
import { buildArchive, shareOrDownload } from "@/data/archive";
import { getFixNow } from "@/lib/location";
import { useCaptureTarget, useCases } from "@/data/hooks";
import { canCapture } from "@/data/rules";
import { useApp } from "@/store/app";
import { compactDate, relative } from "@/lib/format";
import { isEncrypted } from "@/data/seal";
import { SealSheet } from "@/components/seal/SealSheet";
import { ConfirmSheet, Sheet, SheetRow, StatusPill, SW, TextPromptSheet } from "./ui";
import { cn } from "@/lib/utils";

export function NewCaseSheet() {
  const open = useApp((s) => s.newCaseOpen);
  const setOpen = useApp((s) => s.setNewCaseOpen);
  const navigate = useNavigate();
  return (
    <TextPromptSheet
      open={open}
      onClose={() => setOpen(false)}
      title="New case vault"
      label="Codename"
      placeholder="OPERATION: CODENAME"
      submitLabel="Open case"
      onSubmit={async (v) => {
        const id = await caseRepo.create(v);
        setOpen(false);
        navigate({ to: "/case/$id", params: { id } });
      }}
    />
  );
}

/** Choose an Active case, or open a new one. */
export function CasePickerSheet({ open, onClose, onPick, selectedId }: { open: boolean; onClose: () => void; onPick: (id: string) => void; selectedId?: string | null | undefined }) {
  const cases = useCases() ?? [];
  const active = cases.filter(canCapture);
  const [name, setName] = useState("");
  return (
    <Sheet open={open} onClose={onClose} title="File to case">
      {active.length === 0 && <p className="px-5 pb-3 text-sm text-ink-muted">No active cases. Open one to file this capture.</p>}
      {active.map((c) => (
        <button key={c.id} onClick={() => onPick(c.id)} className="flex min-h-14 w-full items-center gap-3 border-t border-line px-5 text-left active:bg-surface">
          <Box size={20} strokeWidth={SW} className="text-amber" />
          <span className="codename flex-1 text-[15px]">{c.codename}</span>
          {selectedId === c.id && <Check size={18} strokeWidth={SW} className="text-amber" />}
        </button>
      ))}
      <form
        className="flex gap-2 border-t border-line px-5 pt-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const id = await caseRepo.create(name);
          setName("");
          onPick(id);
        }}
      >
        <input className="field codename" placeholder="OPERATION: CODENAME" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-outline shrink-0" disabled={!name.trim()}>
          Open
        </button>
      </form>
    </Sheet>
  );
}

export function FilingChip() {
  const { target } = useCaptureTarget();
  const setOverride = useApp((s) => s.setFilingOverride);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("inline-flex min-h-9 max-w-full items-center gap-2 rounded-full border px-3 font-mono text-[11.5px] uppercase tracking-[0.08em]", target ? "border-amber-line bg-amber-fill text-amber" : "border-pin/50 text-pin")}
      >
        <span className={cn("size-1.5 shrink-0 rounded-full", target ? "bg-amber" : "bg-pin")} />
        <span className="truncate">{target ? `Filing to ${target.codename}` : "Choose a case to file to"}</span>
      </button>
      <CasePickerSheet
        open={open}
        onClose={() => setOpen(false)}
        selectedId={target?.id}
        onPick={(id) => {
          setOverride(id);
          setOpen(false);
        }}
      />
    </>
  );
}

export function PlusSheet() {
  const open = useApp((s) => s.plusOpen);
  const setOpen = useApp((s) => s.setPlusOpen);
  const setNewCase = useApp((s) => s.setNewCaseOpen);
  const navigate = useNavigate();
  const { target } = useCaptureTarget();
  const [pending, setPending] = useState<null | ((caseId: string) => void)>(null);
  const [busy, setBusy] = useState(false);

  const withCase = (fn: (caseId: string) => void) => {
    if (target) fn(target.id);
    else setPending(() => fn);
  };

  const [pingCase, setPingCase] = useState<string | null>(null);
  const [pingLabel, setPingLabel] = useState("");
  const ping = async (caseId: string) => {
    setBusy(true);
    try {
      const p = await getFixNow(8000);
      await noteRepo.create(caseId, { type: "location", title: pingLabel.trim() || "Location ping", location: p });
      toast.success(`Location ping filed. Accuracy ±${p.accuracy ?? "?"} m.`);
      setPingCase(null);
      setPingLabel("");
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet open={open && !pending && !pingCase} onClose={() => setOpen(false)} title={target ? `New in ${target.codename}` : "New"}>
        <SheetRow icon={<FileText size={22} strokeWidth={SW} />} label="Text note" hint="Title and Markdown body" onClick={() => { setOpen(false); navigate({ to: "/capture/text" }); }} />
        <SheetRow icon={<MapPin size={22} strokeWidth={SW} />} label="Location ping" hint="Saves your current coordinates" onClick={() => withCase((id) => setPingCase(id))} />
        <SheetRow
          icon={<UserPlus size={22} strokeWidth={SW} />}
          label="New subject"
          hint="Open a dossier"
          onClick={() =>
            withCase(async (caseId) => {
              const sid = await subjectRepo.create(caseId);
              setOpen(false);
              navigate({ to: "/case/$id/subject/$sid", params: { id: caseId, sid }, search: { edit: true } });
            })
          }
        />
        <SheetRow icon={<FolderPlus size={22} strokeWidth={SW} />} label="New case" hint="Opens as Active" onClick={() => { setOpen(false); setNewCase(true); }} />
      </Sheet>
      <Sheet open={open && !!pingCase} onClose={() => setPingCase(null)} title="Location ping">
        <form className="space-y-4 px-5 pb-2" onSubmit={(e) => { e.preventDefault(); if (pingCase) void ping(pingCase); }}>
          <input autoFocus className="field font-mono text-[13px]" placeholder="Label (optional), e.g. PINE RIDGE, CO" value={pingLabel} onChange={(e) => setPingLabel(e.target.value)} />
          <button type="submit" className="btn btn-primary w-full" disabled={busy}>{busy ? "Getting a fix" : "Save ping"}</button>
        </form>
      </Sheet>
      <CasePickerSheet
        open={!!pending}
        onClose={() => setPending(null)}
        onPick={(id) => {
          const fn = pending;
          setPending(null);
          fn?.(id);
        }}
      />
    </>
  );
}

/** Rename, Change status, Seal, Export, Delete. Sealing always means encryption; an encrypted case leaves Sealed only by its passcode. */
export function CaseActionsSheet({ c, open, onClose, onDeleted }: { c: CaseRec | null; open: boolean; onClose: () => void; onDeleted?: () => void }) {
  const [mode, setMode] = useState<null | "rename" | "status" | "seal" | "delete">(null);
  const close = () => {
    setMode(null);
    onClose();
  };
  if (!c) return null;
  const encrypted = isEncrypted(c);
  return (
    <>
      <Sheet open={open && !mode} onClose={close} title={c.codename}>
        <SheetRow icon={<Pencil size={20} strokeWidth={SW} />} label="Rename" onClick={() => setMode("rename")} />
        {!encrypted && <SheetRow icon={<Layers size={20} strokeWidth={SW} />} label="Change status" hint={`Currently ${c.status}`} onClick={() => setMode("status")} />}
        {c.status === "active" && <SheetRow icon={<Lock size={20} strokeWidth={SW} />} label="Seal case" hint="Encrypt with a passcode" onClick={() => setMode("seal")} />}
        <SheetRow
          icon={<Download size={20} strokeWidth={SW} />}
          label="Export case"
          hint={encrypted ? "Zip of the encrypted records and files, with hashes" : "Zip with Markdown, media and hashes"}
          onClick={async () => {
            close();
            const t = toast.loading("Building archive.");
            try {
              const { blob, name } = await buildArchive([c.id]);
              const r = await shareOrDownload(blob, name);
              toast.success(r === "cancelled" ? "Export cancelled." : "Case exported.", { id: t });
            } catch (e) {
              toast.error((e as Error).message, { id: t });
            }
          }}
        />
        <SheetRow icon={<Trash2 size={20} strokeWidth={SW} />} label="Delete" danger onClick={() => setMode("delete")} />
      </Sheet>
      <TextPromptSheet open={open && mode === "rename"} onClose={close} title="Rename case" label="Codename" initial={c.codename} submitLabel="Save" onSubmit={async (v) => { await caseRepo.rename(c.id, v); close(); }} />
      <Sheet open={open && mode === "status"} onClose={close} title="Change status">
        {(["active", "archived"] as CaseStatus[]).map((s) => (
          <button
            key={s}
            onClick={async () => {
              try {
                await caseRepo.setStatus(c.id, s);
                close();
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
            className="flex min-h-14 w-full items-center justify-between border-t border-line px-5 active:bg-surface"
          >
            <StatusPill status={s} />
            <span className="text-xs text-ink-muted">{s === "active" ? "Accepts captures" : "Read only"}</span>
            {c.status === s ? <Check size={18} strokeWidth={SW} className="text-amber" /> : <span className="w-[18px]" />}
          </button>
        ))}
      </Sheet>
      <SealSheet c={c} open={open && mode === "seal"} onClose={close} />
      <ConfirmSheet
        open={open && mode === "delete"}
        onClose={close}
        title="Delete case"
        body={`This permanently removes ${c.codename} and every note, subject and piece of evidence in it from this device.`}
        requireText={c.codename}
        confirmLabel="Delete case"
        onConfirm={async () => {
          await caseRepo.remove(c.id);
          toast("Case deleted.");
          onDeleted?.();
        }}
      />
    </>
  );
}

/** One line, never wrapped. */
export function CaseCardMeta({ c }: { c: CaseRec }) {
  return <span className="block truncate text-[12.5px] text-ink-muted">Last activity: {relative(c.lastActivityAt)}</span>;
}

// ---------- Timeline filter ----------
export type DatePreset = "today" | "7d" | "30d" | "custom";
export interface TimelineFilter {
  subjects: string[];
  date: DatePreset | null;
  /** Custom range, as date input values (YYYY-MM-DD, local time) */
  from: string;
  to: string;
}
export const NO_FILTER: TimelineFilter = { subjects: [], date: null, from: "", to: "" };

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "custom", label: "Custom" },
];

const dayStart = (ts: number, back = 0) => {
  const d = new Date(ts);
  d.setDate(d.getDate() - back);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const dayEnd = (ts: number) => {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
};
const inputDay = (v: string) => new Date(`${v}T00:00`).getTime();

/** Inclusive bounds in local days: "Last 7 days" is today and the six days before it. */
export function dateBounds(f: TimelineFilter, now = Date.now()): { from: number | null; to: number | null } {
  switch (f.date) {
    case "today":
      return { from: dayStart(now), to: dayEnd(now) };
    case "7d":
      return { from: dayStart(now, 6), to: dayEnd(now) };
    case "30d":
      return { from: dayStart(now, 29), to: dayEnd(now) };
    case "custom":
      return { from: f.from ? inputDay(f.from) : null, to: f.to ? dayEnd(inputDay(f.to)) : null };
    default:
      return { from: null, to: null };
  }
}

/** A note passes when it names any chosen subject and falls inside the date range. */
export function matchesTimeline(n: Pick<NoteRec, "subjectIds" | "createdAt">, f: TimelineFilter, now = Date.now()): boolean {
  if (f.subjects.length && !f.subjects.some((id) => n.subjectIds.includes(id))) return false;
  const { from, to } = dateBounds(f, now);
  return (from === null || n.createdAt >= from) && (to === null || n.createdAt <= to);
}

/** Active filters as removable chips; `next` is the filter without that chip. */
export function filterChips(f: TimelineFilter, subjects: Pick<SubjectRec, "id" | "name">[]): { key: string; label: string; next: TimelineFilter }[] {
  const chips = f.subjects.map((id) => ({ key: `subject:${id}`, label: subjects.find((s) => s.id === id)?.name ?? "Unknown subject", next: { ...f, subjects: f.subjects.filter((x) => x !== id) } }));
  const cleared = { ...f, date: null, from: "", to: "" };
  if (f.date && f.date !== "custom") chips.push({ key: "date", label: PRESETS.find((p) => p.key === f.date)!.label, next: cleared });
  if (f.date === "custom" && (f.from || f.to)) {
    const day = (v: string) => compactDate(inputDay(v));
    chips.push({ key: "date", label: f.from && f.to ? `${day(f.from)} to ${day(f.to)}` : f.from ? `From ${day(f.from)}` : `Until ${day(f.to)}`, next: cleared });
  }
  return chips;
}

/** Subjects (any of) and a date range for the case timeline. Changes apply as they are made. */
export function TimelineFilterSheet({ open, onClose, subjects, value, onChange }: { open: boolean; onClose: () => void; subjects: Pick<SubjectRec, "id" | "name">[]; value: TimelineFilter; onChange: (f: TimelineFilter) => void }) {
  const set = (p: Partial<TimelineFilter>) => onChange({ ...value, ...p });
  const active = value.subjects.length > 0 || value.date !== null;
  return (
    <Sheet open={open} onClose={onClose} title="Filter timeline">
      <div className="mono-label px-5 pb-2 text-ink-muted">Subjects</div>
      {subjects.length === 0 && <p className="px-5 pb-3 text-sm text-ink-muted">No subjects in this case.</p>}
      <div role="group" aria-label="Subjects">
        {subjects.map((s) => {
          const on = value.subjects.includes(s.id);
          return (
            <button
              key={s.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => set({ subjects: on ? value.subjects.filter((x) => x !== s.id) : [...value.subjects, s.id] })}
              className="flex min-h-12 w-full items-center gap-3.5 border-t border-line px-5 text-left active:bg-surface"
            >
              <span className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] border transition-colors", on ? "border-amber bg-amber-fill text-amber" : "border-line-strong")}>
                {on && <Check size={14} strokeWidth={2} />}
              </span>
              <span className={cn("flex-1 font-serif text-[18px] leading-tight", on ? "text-ink" : "text-ink-muted")}>{s.name}</span>
            </button>
          );
        })}
      </div>
      <div className="mono-label border-t border-line px-5 pt-4 pb-2.5 text-ink-muted">Date range</div>
      <div role="radiogroup" aria-label="Date range" className="grid grid-cols-2 gap-2 px-5">
        {PRESETS.map((p) => {
          const on = value.date === p.key;
          return (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => set({ date: on ? null : p.key })}
              className={cn("min-h-11 rounded-[10px] border px-3 font-mono text-[12px] uppercase tracking-[0.08em]", on ? "border-amber-line bg-amber-fill text-amber" : "border-line-strong text-ink-muted")}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {value.date === "custom" && (
        <div className="anim-fade grid grid-cols-2 gap-2 px-5 pt-3">
          <label className="block">
            <span className="mono-label mb-1 block text-ink-muted">From</span>
            <input type="date" className="field min-h-11 px-2 font-mono text-[13px]" value={value.from} max={value.to || undefined} onChange={(e) => set({ from: e.target.value })} />
          </label>
          <label className="block">
            <span className="mono-label mb-1 block text-ink-muted">To</span>
            <input type="date" className="field min-h-11 px-2 font-mono text-[13px]" value={value.to} min={value.from || undefined} onChange={(e) => set({ to: e.target.value })} />
          </label>
        </div>
      )}
      <div className="flex gap-3 px-5 pt-5">
        <button type="button" className="btn btn-ghost flex-1" disabled={!active} onClick={() => onChange(NO_FILTER)}>
          Clear
        </button>
        <button type="button" className="btn btn-primary flex-1" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
