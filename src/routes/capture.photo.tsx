import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Camera, ImageUp } from "lucide-react";
import { toast } from "sonner";
import { CaptureFrame } from "@/components/at/CaptureFrame";
import { CasePickerSheet } from "@/components/at/CaseSheets";
import { SW } from "@/components/at/ui";
import { useCaptureTarget, useSubjects } from "@/data/hooks";
import type { GeoPoint } from "@/data/db";
import { evidenceRepo, noteRepo } from "@/data/repo";
import { useApp } from "@/store/app";
import { bytes } from "@/lib/format";
import { makeThumb, readExif } from "@/lib/image";
import { startFix } from "@/lib/location";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/capture/photo")({
  head: () => ({
    meta: [
      { title: "Photo capture · Alien Technology" },
      { name: "description", content: "Photograph evidence and file it to a case with a SHA-256 hash and chain of custody." },
      { property: "og:title", content: "Photo capture · Alien Technology" },
      { property: "og:description", content: "Photograph evidence and file it to a case." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PhotoCapture,
});

function PhotoCapture() {
  const pending = useApp((s) => s.pendingPhoto);
  const setPending = useApp((s) => s.setPendingPhoto);
  const setOverride = useApp((s) => s.setFilingOverride);
  const [file, setFile] = useState<File | null>(pending);
  const [url, setUrl] = useState<string>();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(false);
  const { target } = useCaptureTarget();
  const subjects = useSubjects(target?.id ?? "") ?? [];
  const navigate = useNavigate();
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);
  const fix = useRef<Promise<GeoPoint | null> | null>(null);

  useEffect(() => {
    setPending(null);
  }, [setPending]);
  useEffect(() => {
    if (!file) {
      setUrl(undefined);
      return;
    }
    fix.current = startFix();
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const choose = (f?: File) => f && setFile(f);

  const save = async (caseId: string | undefined = target?.id) => {
    if (!file) return;
    if (!caseId) return setPick(true);
    setBusy(true);
    try {
      const [meta, thumb] = await Promise.all([readExif(file), makeThumb(file)]);
      const fileName = file.name || `IMG_${Date.now()}.jpg`;
      const location: GeoPoint | null = meta.gps ? { ...meta.gps, accuracy: null, source: "exif" } : null;
      const nid = await noteRepo.create(caseId, { type: "photo", title: title.trim() || fileName, body: body.trim(), subjectIds, location });
      const eid = await evidenceRepo.addMedia(caseId, file, fileName, nid, "photo", {
        exif: meta.exif,
        gps: meta.gps,
        thumb,
        capturedAt: meta.capturedAt ?? (file.lastModified || Date.now()),
      });
      await noteRepo.update(nid, { attachmentIds: [eid] });
      if (!meta.gps) void fix.current?.then((p) => p && noteRepo.attachLocation(nid, p));
      toast.success("Photo filed.");
      navigate({ to: "/case/$id/note/$nid", params: { id: caseId, nid }, replace: true });
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <CaptureFrame label="Photo capture">
      {url ? (
        <div className="space-y-4">
          <img src={url} alt="Captured" className="photo -mx-5 block w-[calc(100%+2.5rem)] max-w-none border-y border-line object-contain" />
          <div className="font-mono text-[11px] text-ink-muted">{file?.name} · {bytes(file?.size ?? 0)}</div>
          <input className="w-full bg-transparent font-serif text-[26px] font-semibold text-ink outline-none placeholder:text-ink-faint" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="field min-h-[90px] font-mono text-[13px]" placeholder="Note (optional)" value={body} onChange={(e) => setBody(e.target.value)} />
          {subjects.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {subjects.map((s) => {
                const on = subjectIds.includes(s.id);
                return (
                  <button key={s.id} onClick={() => setSubjectIds(on ? subjectIds.filter((x) => x !== s.id) : [...subjectIds, s.id])} className={cn("min-h-9 rounded-full border px-3 font-mono text-[12px]", on ? "border-amber-line bg-amber-fill text-amber" : "border-line-strong text-ink-muted")}>
                    {s.name}
                  </button>
                );
              })}
            </div>
          )}
          <button className="btn btn-primary w-full font-mono tracking-[0.12em]" disabled={busy} onClick={() => save()}>
            {busy ? "HASHING" : "SAVE TO CASE"}
          </button>
          <div className="flex gap-3">
            <button className="btn btn-ghost flex-1" onClick={() => cam.current?.click()}>Retake</button>
            <button className="btn btn-ghost flex-1" onClick={() => lib.current?.click()}>Library</button>
          </div>
          <p className="font-mono text-[10.5px] leading-relaxed text-ink-faint">The original file is stored untouched. Its SHA-256 hash and EXIF data are recorded on save.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <button className="card-at flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 text-amber" onClick={() => cam.current?.click()}>
            <Camera size={40} strokeWidth={SW} />
            <span className="font-mono text-[12px] uppercase tracking-[0.12em]">Open camera</span>
          </button>
          <button className="btn btn-ghost w-full" onClick={() => lib.current?.click()}>
            <ImageUp size={18} strokeWidth={SW} /> Choose from library
          </button>
        </div>
      )}
      <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={lib} type="file" accept="image/*" className="hidden" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
      <CasePickerSheet open={pick} onClose={() => setPick(false)} onPick={(id) => { setPick(false); setOverride(id); void save(id); }} />
    </CaptureFrame>
  );
}
