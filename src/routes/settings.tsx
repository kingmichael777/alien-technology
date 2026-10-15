import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { useLiveQuery } from "dexie-react-hooks";
import { useSetting } from "@/data/hooks";
import { settingsRepo, vaultRepo } from "@/data/repo";
import { db } from "@/data/db";
import { BackLink, ConfirmSheet, PageHeader, SectionLabel, SW } from "@/components/at/ui";
import type { DisplayMode } from "@/components/at/AppShell";
import { bytes } from "@/lib/format";
import { useTranscriptionSetting } from "@/hooks/use-transcription";
import { buildArchive, importArchive, reportText, shareOrDownload } from "@/data/archive";
import { startFix } from "@/lib/location";
import { isStandalone } from "@/lib/pwa";
import { useRef } from "react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings · Alien Technology" },
      { name: "description", content: "Display mode, grain, storage status and vault maintenance." },
      { property: "og:title", content: "Settings · Alien Technology" },
      { property: "og:description", content: "Display mode, grain, storage status and vault maintenance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Settings,
});

const MODES: { key: DisplayMode; label: string; hint: string }[] = [
  { key: "standard", label: "Standard dark", hint: "Default" },
  { key: "contrast", label: "High contrast", hint: "Bright daylight" },
  { key: "night", label: "Night vision", hint: "Green, preserves dark adaptation" },
];

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className={cn("relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:opacity-40", on ? "border-amber-line bg-amber-fill" : "border-line-strong bg-surface-raised")}>
      <span className={cn("absolute top-1 size-[18px] rounded-full transition-all duration-200 ease-out", on ? "left-[25px] bg-amber" : "left-1 bg-ink-faint")} />
    </button>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-14 items-center gap-4 border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex-1">
        <div className="text-[15px] text-ink">{title}</div>
        {hint && <div className="text-xs text-ink-muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Settings() {
  const mode = useSetting<DisplayMode>("displayMode", "standard");
  const grain = useSetting<boolean>("grain", true);
  const navigate = useNavigate();
  const ts = useTranscriptionSetting();
  const attach = useSetting<boolean | null>("attachLocation", null);
  const importRef = useRef<HTMLInputElement>(null);
  const [archiveBusy, setArchiveBusy] = useState<null | "export" | "import">(null);
  const [report, setReport] = useState<string | null>(null);
  const [standalone, setStandalone] = useState(true);
  useEffect(() => setStandalone(isStandalone()), []);
  const [confirm, setConfirm] = useState<null | "sample" | "erase">(null);
  const [est, setEst] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);
  const counts = useLiveQuery(async () => ({
    cases: await db.cases.count(),
    notes: await db.notes.count(),
    evidence: await db.evidence.count(),
    sample: (await db.cases.filter((c) => c.sample).count()) + (await db.notes.filter((n) => n.sample).count()),
  }), []);

  const refreshStorage = async () => {
    if (!navigator.storage?.estimate) return;
    const e = await navigator.storage.estimate();
    const persisted = (await navigator.storage.persisted?.()) ?? false;
    setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0, persisted });
  };
  useEffect(() => {
    void refreshStorage();
  }, [counts]);

  return (
    <div>
      <PageHeader back={<BackLink to="/" label="Vault" />} title={<h1 className="font-serif text-2xl font-semibold">Settings</h1>} />
      <div className="space-y-8 px-4 pt-5">
        <section>
          <SectionLabel className="mb-3 px-1">Display mode</SectionLabel>
          <div className="card-at overflow-hidden">
            {MODES.map((m) => (
              <button key={m.key} onClick={() => settingsRepo.set("displayMode", m.key)} className="flex min-h-14 w-full items-center gap-4 border-b border-line px-4 text-left last:border-b-0 active:bg-surface-raised">
                <span className="flex-1">
                  <span className="block text-[15px] text-ink">{m.label}</span>
                  <span className="block text-xs text-ink-muted">{m.hint}</span>
                </span>
                {mode === m.key && <Check size={20} strokeWidth={SW} className="text-amber" />}
              </button>
            ))}
          </div>
          <div className="card-at mt-3">
            <Row title="Film grain" hint="Fine static noise over the interface">
              <Toggle label="Film grain" on={grain} onChange={(v) => settingsRepo.set("grain", v)} />
            </Row>
          </div>
        </section>

        <section>
          <SectionLabel className="mb-3 px-1">Capture</SectionLabel>
          <div className="card-at">
            <Row title="Live transcription" hint="Uses the phone's speech service, which may process audio on Apple or Google servers">
              <Toggle label="Live transcription" on={ts.enabled} onChange={(v) => (v ? ts.enable() : ts.disable())} />
            </Row>
            <Row title="Attach location to captures" hint={attach === null ? "Asks for permission on first use" : "Saved with every voice, photo and text capture"}>
              <Toggle
                label="Attach location to captures"
                on={attach === true}
                onChange={async (v) => {
                  if (!v) return settingsRepo.set("attachLocation", false);
                  await settingsRepo.set("attachLocation", null);
                  const p = await startFix();
                  if (p) toast.success(`Location available. Accuracy ±${p.accuracy} m.`);
                  else {
                    await settingsRepo.set("attachLocation", false);
                    toast.error("Location permission was not granted.");
                  }
                }}
              />
            </Row>
          </div>
          {ts.sheet}
        </section>

        <section>
          <SectionLabel className="mb-3 px-1">Storage</SectionLabel>
          <div className="card-at">
            <Row title="Location" hint="Stored on this device only. Nothing is transmitted." />
            <Row title="Records" hint={counts ? `${counts.cases} cases · ${counts.notes} notes · ${counts.evidence} evidence items` : ""} />
            <Row title="Vault size" hint={est ? `${bytes(est.usage)} of ${bytes(est.quota)} available` : "Not reported by this browser"} />
            <Row title={`Persistent storage: ${est?.persisted ? "Granted" : "Not granted"}`} hint={est?.persisted ? "The browser will keep this data" : "The browser may clear data under storage pressure"}>
              {!est?.persisted && navigator.storage?.persist && (
                <button className="btn btn-outline min-h-9 px-3 text-xs" onClick={async () => { const ok = await navigator.storage.persist(); toast(ok ? "Persistent storage granted." : "The browser declined the request."); void refreshStorage(); }}>
                  Request
                </button>
              )}
            </Row>
          </div>
          {!standalone && (
            <p className="mt-3 px-1 text-[13px] leading-relaxed text-ink-muted">Add Alien Technology to your Home Screen so the browser keeps your vault. In Safari: Share, then Add to Home Screen.</p>
          )}
        </section>

        <section>
          <SectionLabel className="mb-3 px-1">Archive</SectionLabel>
          <div className="space-y-3">
            <button
              className="btn btn-outline w-full"
              disabled={!!archiveBusy || !counts?.cases}
              onClick={async () => {
                setArchiveBusy("export");
                try {
                  const { blob, name } = await buildArchive(null);
                  const r = await shareOrDownload(blob, name);
                  toast(r === "cancelled" ? "Export cancelled." : "Vault exported.");
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setArchiveBusy(null);
                }
              }}
            >
              {archiveBusy === "export" ? "Building archive" : "Export entire vault"}
            </button>
            <button className="btn btn-ghost w-full" disabled={!!archiveBusy} onClick={() => importRef.current?.click()}>
              {archiveBusy === "import" ? "Verifying and importing" : "Import vault"}
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              aria-label="Import archive"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setArchiveBusy("import");
                setReport(null);
                try {
                  const r = await importArchive(f);
                  setReport(reportText(r));
                } catch (err) {
                  toast.error((err as Error).message);
                } finally {
                  setArchiveBusy(null);
                }
              }}
            />
            {report && <p data-testid="import-report" className="card-at px-4 py-3 font-mono text-[12.5px] leading-relaxed text-amber">{report}</p>}
          </div>
        </section>

        <section>
          <SectionLabel className="mb-3 px-1">Maintenance</SectionLabel>
          <div className="space-y-3">
            <button className="btn btn-ghost w-full" disabled={!counts?.sample} onClick={() => setConfirm("sample")}>Clear sample data</button>
            <button className="btn btn-danger w-full" onClick={() => setConfirm("erase")}>Erase vault</button>
          </div>
        </section>
        <p className="px-1 text-[13px] leading-relaxed text-ink-muted">Map tiles load from OpenFreeMap. Only the map area you view is requested; your notes are never sent.</p>
        <p className="pb-4 text-center font-mono text-[10.5px] tracking-[0.12em] text-ink-faint">ALIEN TECHNOLOGY · PRIVATE INVESTIGATOR NOTES</p>
      </div>

      <ConfirmSheet open={confirm === "sample"} onClose={() => setConfirm(null)} title="Clear sample data" body="Removes the four sample cases and everything inside them. Your own records stay." confirmLabel="Clear sample data" onConfirm={async () => { await vaultRepo.clearSample(); toast("Sample data cleared."); }} />
      <ConfirmSheet open={confirm === "erase"} onClose={() => setConfirm(null)} title="Erase vault" body="Permanently deletes every case, note, subject and piece of evidence on this device. This cannot be undone." requireText="ERASE" confirmLabel="Erase vault" onConfirm={async () => { await vaultRepo.erase(); toast("Vault erased."); navigate({ to: "/" }); }} />
    </div>
  );
}
