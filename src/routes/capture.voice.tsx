import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { BarChart3, Folder, FolderOpen, MicOff, MoreHorizontal, Trash2, X, Captions } from "lucide-react";
import { toast } from "sonner";
import { useCapture } from "@/store/capture";
import { useApp } from "@/store/app";
import { useCaptureTarget, useRecentNotes } from "@/data/hooks";
import { evidenceRepo, noteRepo } from "@/data/repo";
import { noteHeadline } from "@/data/rules";
import { createTranscriber, speechSupported, type Transcriber } from "@/lib/speech";
import { useTranscriptionSetting } from "@/hooks/use-transcription";
import { compact } from "@/lib/format";
import { FilingChip, CasePickerSheet } from "@/components/at/CaseSheets";
import { ConfirmSheet, Hexagon, OfflineChip, Sheet, SheetRow, SW } from "@/components/at/ui";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/capture/voice")({
  head: () => ({
    meta: [
      { title: "Quick capture · Alien Technology" },
      { name: "description", content: "One-tap voice capture for field observations, stored on this device." },
      { property: "og:title", content: "Quick capture · Alien Technology" },
      { property: "og:description", content: "One-tap voice capture for field observations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VoiceCapture,
});

const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");

function Timer() {
  const elapsed = useCapture((s) => s.elapsed);
  const status = useCapture((s) => s.status);
  const [ms, setMs] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setMs(elapsed());
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [elapsed, status]);
  const s = ms / 1000;
  return (
    <div className="text-center">
      <div className="font-mono font-medium text-amber tabular-nums" aria-live="off">
        <span className="text-[64px] leading-none tracking-tight">{pad(s / 60)}:{pad(s % 60)}</span>
        <span className="text-[38px]">.{pad((ms % 1000) / 10)}</span>
      </div>
      <div className="mt-2 font-mono text-[13px] tracking-[0.18em] text-ink-muted">{status === "paused" ? "PAUSED" : status === "starting" ? "STARTING" : status === "recording" ? "RECORDING" : "READY"}</div>
    </div>
  );
}

function Waveform() {
  const ref = useRef<HTMLCanvasElement>(null);
  const analyser = useCapture((s) => s.analyser);
  const status = useCapture((s) => s.status);
  const statusRef = useRef(status);
  statusRef.current = status;
  const hist = useRef<number[]>([]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const buf = new Uint8Array(analyser?.fftSize ?? 1024);
    const color = getComputedStyle(document.documentElement).getPropertyValue("--amber-bright").trim() || "#F0AC41";
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      const c = ref.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const step = 6;
      if (t - last > 50) {
        last = t;
        let v = 0;
        if (analyser && statusRef.current === "recording") {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const x = (buf[i]! - 128) / 128;
            sum += x * x;
          }
          v = Math.min(1, Math.sqrt(sum / buf.length) * 5);
        }
        if (statusRef.current !== "paused") hist.current.push(v);
        const max = Math.ceil(w / step) + 1;
        while (hist.current.length > max) hist.current.shift();
      }
      const g = c.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.fillStyle = color;
      g.shadowColor = color;
      g.shadowBlur = 6;
      const H = hist.current;
      const mid = h / 2;
      // Fill the left with quiet dots, newest bars enter at the right.
      for (let i = 0; i < Math.ceil(w / step); i++) {
        const v = H[H.length - 1 - i] ?? 0;
        const x = w - i * step - step / 2;
        if (v < 0.05) {
          g.beginPath();
          g.arc(x, mid, 1, 0, Math.PI * 2);
          g.fill();
        } else {
          const bh = Math.max(4, v * h * 0.95);
          g.fillRect(x - 0.9, mid - bh / 2, 1.8, bh);
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  return <canvas ref={ref} className="h-20 w-full" aria-hidden />;
}

function VoiceCapture() {
  const cap = useCapture();
  const navigate = useNavigate();
  const router = useRouter();
  const { target } = useCaptureTarget();
  const setOverride = useApp((s) => s.setFilingOverride);
  const ts = useTranscriptionSetting();
  const [finalText, setFinal] = useState("");
  const [interim, setInterim] = useState("");
  const [sttFailed, setSttFailed] = useState(false);
  const stt = useRef<Transcriber | null>(null);
  const [menu, setMenu] = useState(false);
  const [confirmClose, setConfirmClose] = useState<null | "close" | "notes">(null);
  const [history, setHistory] = useState(false);
  const [pickCase, setPickCase] = useState(false);
  const [saving, setSaving] = useState(false);
  const recent = useRecentNotes(20) ?? [];
  const live = cap.status === "recording" || cap.status === "paused" || cap.status === "starting";

  useEffect(() => () => setOverride(null), [setOverride]);
  // Leaving the screen without saving discards the session.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setTimeout(() => !mounted.current && useCapture.getState().discard(), 50);
    };
  }, []);

  useEffect(() => {
    if (!ts.enabled || cap.status !== "recording") {
      stt.current?.stop();
      stt.current = null;
      setInterim("");
      return;
    }
    if (!speechSupported()) {
      setSttFailed(true);
      return;
    }
    if (sttFailed) return;
    const t = createTranscriber((f, i) => { setFinal(f); setInterim(i); }, () => setSttFailed(true), finalText);
    stt.current = t;
    t?.start();
    return () => t?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ts.enabled, cap.status, sttFailed]);

  const leave = (to: "back" | "notes") => {
    useCapture.getState().discard();
    if (to === "notes" && target) navigate({ to: "/case/$id", params: { id: target.id }, search: { tab: "notes" } });
    else if (window.history.length > 1) router.history.back();
    else navigate({ to: "/" });
  };
  const guard = (to: "back" | "notes") => (live && cap.elapsed() > 2000 ? setConfirmClose(to === "back" ? "close" : "notes") : leave(to));

  const save = async (caseId: string | undefined = target?.id) => {
    if (!caseId) return setPickCase(true);
    if (cap.status !== "recording" && cap.status !== "paused") return;
    setSaving(true);
    try {
      stt.current?.stop();
      const { blob, durationMs, mimeType, fix } = await useCapture.getState().stop();
      const transcript = `${finalText} ${interim}`.trim();
      const nid = await noteRepo.create(caseId, { type: "voice", title: "", transcript, durationMs });
      const ext = mimeType.includes("mp4") ? "m4a" : "webm";
      const d = new Date();
      const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      const eid = await evidenceRepo.addMedia(caseId, blob, `VOICE_${stamp}.${ext}`, nid, "audio", { capturedAt: Date.now() - durationMs });
      await noteRepo.update(nid, { attachmentIds: [eid] });
      void fix?.then((p) => p && noteRepo.attachLocation(nid, p));
      toast.success("Voice note filed.");
      navigate({ to: "/case/$id/note/$nid", params: { id: caseId, nid }, replace: true });
    } catch (e) {
      toast.error((e as Error).message);
      setSaving(false);
    }
  };

  const toggleRec = () => {
    if (cap.status === "recording") cap.pause();
    else if (cap.status === "paused") cap.resume();
    else if (cap.status === "idle" || cap.status === "error") cap.start();
  };

  return (
    <div className="pt-safe pb-safe flex min-h-dvh flex-col px-5">
      <header className="flex items-start justify-between pt-2">
        <button aria-label="Close" onClick={() => guard("back")} className="inline-flex size-11 items-center justify-center rounded-full bg-surface-raised text-ink">
          <X size={22} strokeWidth={SW} />
        </button>
        <div className="flex flex-col items-center pt-1">
          <div className="flex items-center gap-2">
            <Hexagon className="size-6" />
            <span className="font-sans text-[19px] font-medium text-amber">Alien Technology</span>
          </div>
          <span className="mt-1 font-mono text-[12px] tracking-[0.14em] text-ink-muted">QUICK CAPTURE</span>
          <OfflineChip className="mt-1" />
        </div>
        <button aria-label="Capture options" onClick={() => setMenu(true)} className="inline-flex size-11 items-center justify-center rounded-full bg-surface-raised text-ink">
          <MoreHorizontal size={22} strokeWidth={SW} />
        </button>
      </header>

      <div className="mt-4 flex justify-center">
        <FilingChip />
      </div>

      {cap.status === "denied" ? (
        <div className="anim-fade mt-14 text-center">
          <MicOff size={40} strokeWidth={SW} className="mx-auto text-amber" />
          <p className="mt-5 font-serif text-2xl">Microphone access is off.</p>
          <p className="mx-auto mt-3 max-w-[32ch] text-sm leading-relaxed text-ink-muted">
            On iPhone open Settings, then Safari, then Microphone, and choose Allow. If you added Alien Technology to your Home Screen, also check Settings, then Privacy and Security, then Microphone. Then tap the record button again.
          </p>
          <button className="btn btn-outline mt-6" onClick={() => cap.start()}>Try again</button>
        </div>
      ) : cap.status === "unsupported" ? (
        <p className="mt-14 text-center font-serif text-xl text-ink-muted">This browser cannot record audio.</p>
      ) : (
        <>
          <div className="mt-8"><Timer /></div>
          <div className="mt-6"><Waveform /></div>
          <div className="-mx-5 mt-5 h-px bg-line" />
          <section className="mt-5 min-h-[150px]">
            <div className="flex items-center gap-2 font-mono text-[12px] tracking-[0.1em]">
              <span className="text-amber">LIVE TRANSCRIPTION</span>
              <span className="size-1.5 rounded-full bg-amber" />
              <span className="text-ink-muted">PREVIEW</span>
            </div>
            {!ts.enabled ? (
              <p className="mt-3 font-mono text-[13px] text-ink-muted">
                Live transcription is off.{" "}
                <button className="text-amber underline underline-offset-4" onClick={ts.enable}>Enable</button>
              </p>
            ) : sttFailed ? (
              <p className="mt-3 font-mono text-[13px] leading-relaxed text-ink-muted">Live transcription is not available here. Your recording is saved.</p>
            ) : (
              <>
                <p className="mt-3 font-mono text-[14px] leading-relaxed text-ink">
                  {finalText} <span className="text-ink-muted">{interim}</span>
                </p>
                <p className="mt-4 font-mono text-[13px] leading-relaxed text-ink-muted italic">
                  {cap.status === "paused" ? "Paused." : "Listening..."}
                  <br />
                  Tap to stop or save.
                </p>
              </>
            )}
          </section>

          <div>
            <button className="btn btn-outline h-12 rounded-[8px] bg-transparent px-5 font-mono tracking-[0.12em]" disabled={saving || (cap.status !== "recording" && cap.status !== "paused")} onClick={() => save()}>
              <Folder size={20} strokeWidth={SW} /> SAVE NOTE
            </button>
          </div>

          <div className="mt-auto flex items-end justify-between pt-6">
            <button className="tap flex flex-col items-center gap-1 text-amber" onClick={() => guard("notes")} disabled={!target}>
              <FolderOpen size={26} strokeWidth={SW} />
              <span className="font-mono text-[11px] tracking-[0.12em]">NOTES</span>
            </button>
            <button
              aria-label={cap.status === "recording" ? "Pause" : cap.status === "paused" ? "Resume" : "Record"}
              onClick={toggleRec}
              className="relative flex size-24 items-center justify-center rounded-full border-2 border-amber-bright"
              style={{ boxShadow: "0 0 28px -4px var(--amber-line), inset 0 0 18px -8px var(--amber-line)" }}
            >
              <span className={cn("block rounded-full bg-amber-bright transition-all duration-200 ease-out", cap.status === "paused" ? "size-10 rounded-[10px]" : "size-[72px]")} style={{ boxShadow: "0 0 24px -2px var(--amber-line)" }} />
            </button>
            <button className="tap flex flex-col items-center gap-1 text-amber" onClick={() => setHistory(true)}>
              <BarChart3 size={26} strokeWidth={SW} />
              <span className="font-mono text-[11px] tracking-[0.12em]">HISTORY</span>
            </button>
          </div>
        </>
      )}

      <Sheet open={menu} onClose={() => setMenu(false)} title="Quick capture">
        <SheetRow icon={<Captions size={20} strokeWidth={SW} />} label={ts.enabled ? "Turn live transcription off" : "Turn live transcription on"} hint="Uses the phone's speech service" onClick={() => { setMenu(false); if (ts.enabled) ts.disable(); else { setSttFailed(false); ts.enable(); } }} />
        <SheetRow icon={<Trash2 size={20} strokeWidth={SW} />} label="Discard" danger onClick={() => { setMenu(false); leave("back"); }} />
      </Sheet>
      {ts.sheet}
      <ConfirmSheet open={!!confirmClose} onClose={() => setConfirmClose(null)} title="Discard this recording?" body="The audio and transcript are not saved." confirmLabel="Discard" onConfirm={() => leave(confirmClose === "notes" ? "notes" : "back")} />
      <CasePickerSheet open={pickCase} onClose={() => setPickCase(false)} onPick={(id) => { setPickCase(false); setOverride(id); void save(id); }} />
      <Sheet open={history} onClose={() => setHistory(false)} title="Recent captures">
        {recent.length === 0 && <p className="px-5 pb-4 text-sm text-ink-muted">No captures yet.</p>}
        {recent.map(({ note, codename }) => (
          <button key={note.id} className="flex min-h-14 w-full flex-col items-start justify-center border-t border-line px-5 py-2 text-left" onClick={() => { setHistory(false); navigate({ to: "/case/$id/note/$nid", params: { id: note.caseId, nid: note.id } }); }}>
            <span className="w-full truncate font-mono text-[13px] text-ink">{noteHeadline(note)}</span>
            <span className="font-mono text-[11px] text-ink-muted">{codename} · {compact(note.createdAt)}</span>
          </button>
        ))}
      </Sheet>
    </div>
  );
}
