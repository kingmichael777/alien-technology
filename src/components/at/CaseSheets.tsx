import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Box, Check, FileText, MapPin, UserPlus, FolderPlus, Pencil, Download, Trash2, Layers } from "lucide-react";
import { toast } from "sonner";
import type { CaseRec, CaseStatus } from "@/data/db";
import { caseRepo, noteRepo, subjectRepo } from "@/data/repo";
import { buildArchive, shareOrDownload } from "@/data/archive";
import { getFixNow } from "@/lib/location";
import { useCaptureTarget, useCases } from "@/data/hooks";
import { canCapture } from "@/data/rules";
import { useApp } from "@/store/app";
import { relative } from "@/lib/format";
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

/** Rename, Change status, Export, Delete. */
export function CaseActionsSheet({ c, open, onClose, onDeleted }: { c: CaseRec | null; open: boolean; onClose: () => void; onDeleted?: () => void }) {
  const [mode, setMode] = useState<null | "rename" | "status" | "delete">(null);
  const close = () => {
    setMode(null);
    onClose();
  };
  if (!c) return null;
  return (
    <>
      <Sheet open={open && !mode} onClose={close} title={c.codename}>
        <SheetRow icon={<Pencil size={20} strokeWidth={SW} />} label="Rename" onClick={() => setMode("rename")} />
        <SheetRow icon={<Layers size={20} strokeWidth={SW} />} label="Change status" hint={`Currently ${c.status}`} onClick={() => setMode("status")} />
        <SheetRow
          icon={<Download size={20} strokeWidth={SW} />}
          label="Export case"
          hint="Zip with Markdown, media and hashes"
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
        {(["active", "sealed", "archived"] as CaseStatus[]).map((s) => (
          <button key={s} onClick={async () => { await caseRepo.setStatus(c.id, s); close(); }} className="flex min-h-14 w-full items-center justify-between border-t border-line px-5 active:bg-surface">
            <StatusPill status={s} />
            <span className="text-xs text-ink-muted">{s === "active" ? "Accepts captures" : "Read only"}</span>
            {c.status === s ? <Check size={18} strokeWidth={SW} className="text-amber" /> : <span className="w-[18px]" />}
          </button>
        ))}
      </Sheet>
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

export function CaseCardMeta({ c }: { c: CaseRec }) {
  return <span className="text-[12.5px] text-ink-muted">Last activity: {relative(c.lastActivityAt)}</span>;
}
