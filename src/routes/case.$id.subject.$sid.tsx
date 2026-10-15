import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { AlertTriangle, Camera, ChevronDown, ChevronRight, ChevronUp, EyeOff, FileText, ImageUp, Link2, MapPin, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useBlobUrl, useCase, useEntityLinks, useSubject, useSubjectNotes } from "@/data/hooks";
import type { SubjectRec, Threat } from "@/data/db";
import { subjectRepo } from "@/data/repo";
import { BackLink, ConfirmSheet, IconButton, PageHeader, Redact, Sheet, SheetRow, ShieldLink, Silhouette, SW, ThreatDot } from "@/components/at/ui";
import { LinkPickerSheet, MiniWave, UnlinkButton } from "@/components/at/notes";
import { parseCoordinate, parseCoordinatePair } from "@/components/map/model";
import { clock, compact, compactDate, toLocalInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMapFocus } from "@/store/map";

export const Route = createFileRoute("/case/$id/subject/$sid")({
  validateSearch: (s: Record<string, unknown>): { edit?: boolean | undefined } => ({ edit: s["edit"] === true || s["edit"] === "true" ? true : undefined }),
  head: () => ({
    meta: [
      { title: "Subject dossier · Alien Technology" },
      { name: "description", content: "Aliases, last known location, threat level and linked notes for a subject." },
      { property: "og:title", content: "Subject dossier · Alien Technology" },
      { property: "og:description", content: "Aliases, last known location, threat level and linked notes for a subject." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dossier,
});

function Dossier() {
  const { id, sid } = Route.useParams();
  const { edit } = Route.useSearch();
  const s = useSubject(sid);
  const c = useCase(id);
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [del, setDel] = useState(false);
  const readOnly = c?.status !== "active";

  if (s === undefined) return null;
  if (s === null)
    return (
      <div className="px-6 py-24 text-center">
        <p className="font-serif text-2xl">This subject is no longer on file.</p>
        <Link to="/case/$id" params={{ id }} search={{ tab: "subjects" }} className="btn btn-outline mt-6">Back to case</Link>
      </div>
    );

  const setEdit = (v: boolean) => navigate({ to: ".", search: { edit: v || undefined }, replace: true });

  return (
    <div>
      <PageHeader
        back={<BackLink to="/case/$id" params={{ id }} search={{ tab: "subjects" }} label="Back to case" />}
        title={<div className="codename text-center text-[17px] tracking-[0.12em] text-amber">ALIEN TECHNOLOGY</div>}
        right={
          <div className="flex">
            {!readOnly && !edit && (
              <IconButton label="Dossier options" onClick={() => setMenu(true)}>
                <MoreHorizontal size={22} strokeWidth={SW} />
              </IconButton>
            )}
            {(readOnly || edit) && <ShieldLink />}
          </div>
        }
      />
      {edit && !readOnly ? <DossierEdit s={s} onDone={() => setEdit(false)} /> : <DossierView s={s} readOnly={readOnly} />}

      <Sheet open={menu} onClose={() => setMenu(false)} title="Dossier">
        <SheetRow icon={<Pencil size={20} strokeWidth={SW} />} label="Edit dossier" onClick={() => { setMenu(false); setEdit(true); }} />
        <SheetRow icon={<EyeOff size={20} strokeWidth={SW} />} label="Visual redaction" hint="Set in edit mode. Hides values on screen only. Not encryption." onClick={() => { setMenu(false); setEdit(true); }} />
        <SheetRow icon={<Trash2 size={20} strokeWidth={SW} />} label="Delete subject" danger onClick={() => { setMenu(false); setDel(true); }} />
      </Sheet>
      <ConfirmSheet
        open={del}
        onClose={() => setDel(false)}
        title="Delete subject"
        body={`Removes the dossier for ${s.name} and its links. Notes stay in the case.`}
        confirmLabel="Delete subject"
        onConfirm={async () => {
          await subjectRepo.remove(s.id);
          navigate({ to: "/case/$id", params: { id }, search: { tab: "subjects" } });
        }}
      />
    </div>
  );
}

function Photo({ s }: { s: SubjectRec }) {
  const url = useBlobUrl(s.photoBlobId);
  return (
    <div className="aspect-[4/5] w-full overflow-hidden rounded-[6px] border border-amber/50">
      {url ? <img src={url} alt={s.name} className="photo size-full object-cover" /> : <Silhouette className="size-full" />}
    </div>
  );
}

function RuleEnd({ end }: { end: "slash" | "dot" }) {
  return (
    <div className="flex flex-1 items-center">
      <span className="h-px flex-1 bg-amber/70" />
      {end === "slash" ? <span className="ml-1 font-mono text-[11px] tracking-[-0.1em] text-amber">///</span> : <span className="size-1.5 rounded-full bg-amber" />}
    </div>
  );
}

function DossierView({ s, readOnly }: { s: SubjectRec; readOnly: boolean }) {
  const notes = useSubjectNotes(s.id) ?? [];
  const links = useEntityLinks(s.id) ?? [];
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState(false);
  const r = (k: string) => s.redacted.includes(k);
  const threat: Record<Threat, string> = { undetermined: "text-ink", low: "text-ink-muted", elevated: "text-amber", high: "text-pin" };

  return (
    <div className="anim-fade px-5 pt-5">
      <div className="section-label">Subject Dossier</div>
      <h1 className="mt-1 font-serif text-[40px] leading-[1.05] font-semibold text-ink">{s.name}</h1>
      <div className="mt-2 mb-5 flex w-3/4"><RuleEnd end="slash" /></div>

      <div className="grid grid-cols-[46%_1fr] gap-4">
        <Photo s={s} />
        <div className="min-w-0">
          <Field label="Aliases">
            {s.aliases.length === 0 ? <span className="text-ink-faint">None recorded</span> : (
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {s.aliases.map((a, i) => <Redact key={i} text={a} redacted={r(`alias:${i}`)} />)}
              </div>
            )}
          </Field>
          <Field label="Last seen location">
            {!s.lastSeen.place && !s.lastSeen.detail && !s.lastSeen.at && !s.coordinates ? <span className="text-ink-faint">Unknown</span> : (
              <>
                {s.lastSeen.place && <div><Redact text={s.lastSeen.place} redacted={r("lastSeen.place")} /></div>}
                {s.lastSeen.detail && <div><Redact text={s.lastSeen.detail} redacted={r("lastSeen.detail")} /></div>}
                {s.lastSeen.at && <div className="text-ink-muted">{compactDate(s.lastSeen.at)} / {clock(s.lastSeen.at)}</div>}
                {s.coordinates && (
                  <Link
                    to="/case/$id"
                    params={{ id: s.caseId }}
                    search={{ tab: "map" }}
                    onClick={() => useMapFocus.getState().focusOn({ caseId: s.caseId, kind: "subject", id: s.id })}
                    className="-my-2 flex min-h-11 w-fit items-center gap-1.5 font-mono text-[12px] uppercase tracking-[0.1em] text-amber"
                  >
                    <MapPin size={15} strokeWidth={SW} /> Map
                  </Link>
                )}
              </>
            )}
          </Field>
          {s.fields.map((f) => (
            <Field key={f.key} label={f.key}>
              <Redact text={f.value || " "} redacted={r(`field:${f.key}`)} />
            </Field>
          ))}
          <Field label="Threat level" last>
            <span className={cn("inline-flex items-center gap-2 uppercase", threat[s.threatLevel])}>
              {s.threatLevel} <ThreatDot level={s.threatLevel} />
            </span>
          </Field>
        </div>
      </div>

      <div className="mt-7 mb-3 flex items-center gap-3">
        <h2 className="codename text-[19px] text-ink">Linked Notes</h2>
        <RuleEnd end="dot" />
      </div>
      {notes.length === 0 && <p className="card-at px-4 py-5 text-sm text-ink-muted">No notes reference this subject. Link one from the note editor.</p>}
      <div className="space-y-2.5">
        {notes.map((n) => (
          <Link key={n.id} to="/case/$id/note/$nid" params={{ id: n.caseId, nid: n.id }} className="card-at anim-fade flex gap-3 px-4 py-3 active:bg-surface-raised">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[13.5px] text-ink">{n.title || compact(n.createdAt)}</div>
              <p className="mt-1.5 line-clamp-3 font-mono text-[12px] leading-relaxed text-ink-muted">{n.body || n.transcript || "No body text."}</p>
            </div>
            <div className="flex w-[68px] shrink-0 flex-col items-center justify-center gap-1.5 text-ink-muted">
              {n.flagged ? (
                <>
                  <AlertTriangle size={22} strokeWidth={SW} className="text-amber" />
                  <span className="font-mono text-[10.5px] tracking-[0.08em] text-amber">FLAGGED</span>
                </>
              ) : n.type === "voice" ? (
                <>
                  <MiniWave />
                  <span className="font-mono text-[11px]">{compactDate(n.createdAt)}</span>
                </>
              ) : (
                <>
                  <FileText size={22} strokeWidth={SW} />
                  <span className="font-mono text-[11px]">{clock(n.createdAt).replace(" ", "\u00a0")}</span>
                </>
              )}
            </div>
          </Link>
        ))}
      </div>

      <section className="-mx-5 mt-6 rounded-t-[20px] border border-b-0 border-line-strong bg-surface">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong" />
        <button className="flex min-h-14 w-full items-center gap-3 px-5" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Link2 size={20} strokeWidth={SW} className="text-amber" />
          <span className="section-label flex-1 text-left">Connected Entities ({links.length})</span>
          {open ? <ChevronUp size={20} strokeWidth={SW} className="text-ink-muted" /> : <ChevronDown size={20} strokeWidth={SW} className="text-ink-muted" />}
        </button>
        {open && (
          <div className="anim-fade pb-4">
            {links.length === 0 && <p className="border-t border-line px-5 py-4 text-sm text-ink-muted">No connections recorded.</p>}
            {links.map((l) => (
              <div key={l.linkId} className="flex items-center border-t border-line pl-5">
                <EntityLink kind={l.other.kind} id={l.other.id} caseId={s.caseId} className="flex min-h-14 flex-1 items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[13.5px] text-ink">{l.other.name}</span>
                    <span className="block truncate font-mono text-[11.5px] text-ink-muted">{l.label}</span>
                  </span>
                  <ChevronRight size={18} strokeWidth={SW} className="text-ink-muted" />
                </EntityLink>
                <UnlinkButton linkId={l.linkId} disabled={readOnly} />
              </div>
            ))}
            {!readOnly && (
              <div className="px-5 pt-3">
                <button className="btn btn-outline w-full" onClick={() => setPicker(true)}>
                  <Link2 size={18} strokeWidth={SW} /> Link
                </button>
              </div>
            )}
          </div>
        )}
      </section>
      <LinkPickerSheet open={picker} onClose={() => setPicker(false)} caseId={s.caseId} from={{ id: s.id, kind: "subject" }} />
    </div>
  );
}

export function EntityLink({ kind, id, caseId, className, children }: { kind: string; id: string; caseId: string; className?: string; children: React.ReactNode }) {
  if (kind === "subject") return <Link to="/case/$id/subject/$sid" params={{ id: caseId, sid: id }} className={className}>{children}</Link>;
  if (kind === "note") return <Link to="/case/$id/note/$nid" params={{ id: caseId, nid: id }} className={className}>{children}</Link>;
  return <Link to="/evidence/$eid" params={{ eid: id }} className={className}>{children}</Link>;
}

function Field({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={cn("pb-2.5", !last && "mb-2.5 border-b border-line")}>
      <div className="mono-label mb-1">{label}</div>
      <div className="font-mono text-[13px] leading-relaxed break-words text-ink">{children}</div>
    </div>
  );
}

type Row = { value: string; redacted: boolean };

function DossierEdit({ s, onDone }: { s: SubjectRec; onDone: () => void }) {
  const [name, setName] = useState(s.name);
  const [aliases, setAliases] = useState<Row[]>(s.aliases.map((a, i) => ({ value: a, redacted: s.redacted.includes(`alias:${i}`) })));
  const [place, setPlace] = useState<Row>({ value: s.lastSeen.place, redacted: s.redacted.includes("lastSeen.place") });
  const [detail, setDetail] = useState<Row>({ value: s.lastSeen.detail, redacted: s.redacted.includes("lastSeen.detail") });
  const [seenAt, setSeenAt] = useState(toLocalInput(s.lastSeen.at));
  const [lat, setLat] = useState(s.coordinates ? String(s.coordinates.lat) : "");
  const [lng, setLng] = useState(s.coordinates ? String(s.coordinates.lng) : "");
  const [fields, setFields] = useState<(Row & { key: string })[]>(s.fields.map((f) => ({ key: f.key, value: f.value, redacted: s.redacted.includes(`field:${f.key}`) })));
  const [threat, setThreat] = useState<Threat>(s.threatLevel);
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Enter a name.");
      return;
    }
    const cleanAliases = aliases.filter((a) => a.value.trim());
    const cleanFields = fields.filter((f) => f.key.trim());
    const keys = new Set<string>();
    for (const f of cleanFields) {
      const k = f.key.trim().toUpperCase();
      if (keys.has(k)) {
        toast.error(`Field ${k} appears twice.`);
        return;
      }
      keys.add(k);
    }
    let coordinates: SubjectRec["coordinates"] = null;
    if (lat.trim() || lng.trim()) {
      const la = parseCoordinate(lat, "lat");
      const lo = parseCoordinate(lng, "lng");
      if (la === null || lo === null) {
        toast.error("Enter a latitude from -90 to 90 and a longitude from -180 to 180.");
        return;
      }
      coordinates = { lat: la, lng: lo };
    }
    const redacted = [
      ...cleanAliases.flatMap((a, i) => (a.redacted ? [`alias:${i}`] : [])),
      ...cleanFields.flatMap((f) => (f.redacted ? [`field:${f.key.trim().toUpperCase()}`] : [])),
      ...(place.redacted ? ["lastSeen.place"] : []),
      ...(detail.redacted ? ["lastSeen.detail"] : []),
    ];
    try {
      await subjectRepo.update(s.id, {
        name: name.trim(),
        aliases: cleanAliases.map((a) => a.value.trim()),
        lastSeen: { place: place.value.trim(), detail: detail.value.trim(), at: seenAt ? new Date(seenAt).getTime() : null },
        coordinates,
        fields: cleanFields.map((f) => ({ key: f.key.trim().toUpperCase(), value: f.value.trim() })),
        threatLevel: threat,
        redacted,
      });
      toast.success("Dossier saved.");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onPhoto = async (f?: File) => {
    if (f) await subjectRepo.setPhoto(s.id, f);
  };

  return (
    <div className="anim-fade space-y-6 px-5 pt-5 pb-6">
      <div>
        <div className="section-label mb-1">Subject Dossier · Editing</div>
        <input className="w-full border-b border-amber/60 bg-transparent pb-1 font-serif text-[36px] font-semibold text-ink outline-none" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
      </div>

      <div className="grid grid-cols-[40%_1fr] items-end gap-4">
        <Photo s={s} />
        <div className="space-y-2">
          <button className="btn btn-ghost w-full" onClick={() => cam.current?.click()}><Camera size={18} strokeWidth={SW} /> Camera</button>
          <button className="btn btn-ghost w-full" onClick={() => lib.current?.click()}><ImageUp size={18} strokeWidth={SW} /> Library</button>
          <input ref={cam} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
          <input ref={lib} type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
        </div>
      </div>

      <EditGroup label="Aliases">
        {aliases.map((a, i) => (
          <RowEdit key={i} row={a} placeholder="Alias" onChange={(r) => setAliases(aliases.map((x, j) => (j === i ? r : x)))} onRemove={() => setAliases(aliases.filter((_, j) => j !== i))} />
        ))}
        <AddButton onClick={() => setAliases([...aliases, { value: "", redacted: false }])}>Add alias</AddButton>
      </EditGroup>

      <EditGroup label="Last seen location">
        <RowEdit row={place} placeholder="Place, e.g. New Seattle, P.N.W." onChange={setPlace} />
        <RowEdit row={detail} placeholder="Detail, e.g. Sector 7 / Perimeter 12" onChange={setDetail} />
        <input type="datetime-local" className="field font-mono text-[13px]" value={seenAt} onChange={(e) => setSeenAt(e.target.value)} aria-label="Last seen time" />
        <div className="grid grid-cols-2 gap-2">
          {([["Latitude", lat, setLat], ["Longitude", lng, setLng]] as const).map(([label, value, set]) => (
            <input
              key={label}
              className="field font-mono text-[13px]"
              placeholder={label}
              aria-label={label}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={value}
              onChange={(e) => set(e.target.value)}
              onPaste={(e) => {
                const pair = parseCoordinatePair(e.clipboardData.getData("text"));
                if (!pair) return;
                e.preventDefault();
                setLat(String(pair.lat));
                setLng(String(pair.lng));
              }}
            />
          ))}
        </div>
        <p className="font-mono text-[11px] leading-relaxed text-ink-faint">Decimal degrees, e.g. 47.6062 and -122.3321. Pasting a pair fills both.</p>
      </EditGroup>

      <EditGroup label="Fields">
        {fields.map((f, i) => (
          <div key={i} className="space-y-2 rounded-[10px] border border-line p-2">
            <input className="field min-h-10 font-mono text-[12px] uppercase" placeholder="LABEL, e.g. CITIZEN ID" value={f.key} onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
            <RowEdit row={f} placeholder="Value" onChange={(r) => setFields(fields.map((x, j) => (j === i ? { ...x, ...r } : x)))} onRemove={() => setFields(fields.filter((_, j) => j !== i))} />
          </div>
        ))}
        <AddButton onClick={() => setFields([...fields, { key: "", value: "", redacted: false }])}>Add field</AddButton>
      </EditGroup>

      <EditGroup label="Threat level">
        <div className="grid grid-cols-2 gap-2">
          {(["undetermined", "low", "elevated", "high"] as Threat[]).map((t) => (
            <button key={t} onClick={() => setThreat(t)} className={cn("flex min-h-11 items-center justify-center gap-2 rounded-[10px] border font-mono text-[12px] uppercase", threat === t ? "border-amber-line bg-amber-fill text-ink" : "border-line-strong text-ink-muted")}>
              <ThreatDot level={t} /> {t}
            </button>
          ))}
        </div>
      </EditGroup>

      <p className="font-mono text-[11px] leading-relaxed text-ink-faint">Visual redaction hides a value behind a black bar on screen. Press and hold to reveal. It is not encryption.</p>

      <div className="flex gap-3">
        <button className="btn btn-ghost flex-1" onClick={onDone}>Cancel</button>
        <button className="btn btn-primary flex-1" onClick={save}>Save dossier</button>
      </div>
    </div>
  );
}

function EditGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="mono-label">{label}</div>
      {children}
    </div>
  );
}

function RowEdit({ row, onChange, onRemove, placeholder }: { row: Row; onChange: (r: Row) => void; onRemove?: () => void; placeholder: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <input className="field font-mono text-[13px]" placeholder={placeholder} value={row.value} onChange={(e) => onChange({ ...row, value: e.target.value })} />
      <button
        type="button"
        aria-label={row.redacted ? "Remove visual redaction" : "Apply visual redaction"}
        aria-pressed={row.redacted}
        onClick={() => onChange({ ...row, redacted: !row.redacted })}
        className={cn("tap inline-flex shrink-0 items-center justify-center rounded-[10px] border", row.redacted ? "border-amber-line bg-amber-fill text-amber" : "border-line-strong text-ink-faint")}
      >
        <EyeOff size={18} strokeWidth={SW} />
      </button>
      {onRemove && (
        <button type="button" aria-label="Remove" onClick={onRemove} className="tap inline-flex shrink-0 items-center justify-center text-ink-faint active:text-pin">
          <X size={18} strokeWidth={SW} />
        </button>
      )}
    </div>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex min-h-11 items-center gap-2 font-mono text-[12px] uppercase tracking-[0.1em] text-amber">
      <Plus size={16} strokeWidth={SW} /> {children}
    </button>
  );
}
