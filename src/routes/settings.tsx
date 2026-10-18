import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Download, HardDrive, Share, SquarePlus } from "lucide-react";
import { toast } from "sonner";
import type { DisplayMode } from "@/components/AppShell";
import { ConnectCard } from "@/components/ConnectCard";
import { BackLink, ConfirmSheet, PageHeader, SW } from "@/components/ui";
import { setCode } from "@/lib/api";
import { setSetting } from "@/lib/db";
import { earlierNotesFile } from "@/lib/earlier";
import { bytes } from "@/lib/format";
import { useConnected, useSetting, useStorageUse } from "@/lib/hooks";
import { removeLocalAudio } from "@/lib/library";
import { isStandalone } from "@/lib/pwa";
import { downloadBlob } from "@/lib/share";
import { useSync } from "@/lib/sync";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings · Alien Technology" }] }),
  component: SettingsScreen,
});

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="section-label mb-3 px-1">{label}</h2>
      {children}
    </section>
  );
}

const MODES: { id: DisplayMode; label: string }[] = [
  { id: "standard", label: "Standard" },
  { id: "contrast", label: "High contrast" },
  { id: "night", label: "Night" },
];

function SettingsScreen() {
  const connected = useConnected();
  const codeRefused = useSync((s) => s.codeRefused);
  const mode = useSetting<DisplayMode>("displayMode", "standard");
  const use = useStorageUse();
  const [disconnecting, setDisconnecting] = useState(false);
  const [freeing, setFreeing] = useState(false);
  const [earlier, setEarlier] = useState<{ count: number; text: string } | null>(null);

  useEffect(() => {
    void earlierNotesFile().then(setEarlier);
  }, []);

  return (
    <div className="pb-safe">
      <PageHeader left={<BackLink />} title={<span className="font-serif text-[22px] text-ink">Settings</span>} />
      <div className="px-4 pb-12">
        <Group label="Your server">
          {connected && !codeRefused ? (
            <div className="card-at p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 size={20} strokeWidth={SW} className="mt-0.5 shrink-0 text-amber" />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] text-ink">This phone is connected</p>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">
                    Recordings upload to your private server, which writes the transcript and the notes.
                  </p>
                </div>
              </div>
              <button className="btn btn-ghost mt-4 w-full" onClick={() => setDisconnecting(true)}>
                Disconnect this phone
              </button>
            </div>
          ) : (
            <>
              {codeRefused && connected && (
                <p className="mb-3 px-1 text-[13.5px] text-pin">Your server stopped accepting the code saved here. Enter the current one.</p>
              )}
              <ConnectCard />
            </>
          )}
        </Group>

        <Group label="Display">
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => void setSetting("displayMode", m.id)}
                className={cn(
                  "h-11 rounded-[12px] border text-[13.5px] transition-colors",
                  mode === m.id ? "border-amber-line bg-amber-fill text-amber" : "border-line-strong text-ink-muted",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </Group>

        <Group label="This phone">
          <div className="card-at p-4">
            <div className="flex items-start gap-3">
              <HardDrive size={20} strokeWidth={SW} className="mt-0.5 shrink-0 text-amber" />
              <p className="text-[14px] leading-relaxed text-ink-muted">
                {use === undefined
                  ? " "
                  : use.count === 0
                    ? "No audio is stored on this phone."
                    : `Audio for ${use.count} ${use.count === 1 ? "recording is" : "recordings is"} on this phone (${bytes(use.bytes)}). Everything uploaded is also kept on your server.`}
              </p>
            </div>
            {connected && (use?.count ?? 0) > 0 && (
              <button className="btn btn-ghost mt-4 w-full" onClick={() => setFreeing(true)}>
                Free up space
              </button>
            )}
          </div>
          {!isStandalone() && (
            <div className="card-at mt-3 p-4">
              <div className="flex items-start gap-3">
                <SquarePlus size={20} strokeWidth={SW} className="mt-0.5 shrink-0 text-amber" />
                <p className="text-[14px] leading-relaxed text-ink-muted">
                  Put the app on your Home Screen so it opens like any other app and keeps your recordings safe. In Safari, tap
                  <Share size={14} strokeWidth={SW} className="mx-1 inline-block -translate-y-0.5 text-ink" />
                  then Add to Home Screen. You'll paste your access code once more there.
                </p>
              </div>
            </div>
          )}
        </Group>

        {earlier && (
          <Group label="Earlier version">
            <div className="card-at p-4">
              <p className="text-[14px] leading-relaxed text-ink-muted">
                {earlier.count} {earlier.count === 1 ? "note" : "notes"} you wrote in the earlier version of this app {earlier.count === 1 ? "is" : "are"} still on this phone.
              </p>
              <button
                className="btn btn-ghost mt-4 w-full"
                onClick={() => downloadBlob(new Blob([earlier.text], { type: "text/plain;charset=utf-8" }), "Earlier notes.txt")}
              >
                <Download size={18} strokeWidth={SW} />
                Save them as a text file
              </button>
            </div>
          </Group>
        )}

        <Group label="How it works">
          <div className="space-y-3 px-1 text-[14px] leading-relaxed text-ink-muted">
            <p>Each recording is saved on this phone while you record, then uploaded to your own private server.</p>
            <p>
              Your server sends the audio to ElevenLabs, which writes the transcript and tells the voices apart. Then it sends the
              transcript to OpenAI, which writes the notes. Both run on your own accounts. Only a phone with your access code can open
              your recordings.
            </p>
            <p>
              Get everyone's agreement before you record. In California and several other states, recording a private conversation
              without the consent of everyone in it is against the law.
            </p>
          </div>
        </Group>
      </div>

      <ConfirmSheet
        open={disconnecting}
        onClose={() => setDisconnecting(false)}
        title="Disconnect this phone?"
        body="Recordings stay on your server. New recordings will wait on this phone until you connect again."
        confirmLabel="Disconnect"
        onConfirm={() => {
          setCode(null);
          useSync.setState({ codeRefused: false });
          toast("This phone is disconnected.");
        }}
      />
      <ConfirmSheet
        open={freeing}
        onClose={() => setFreeing(false)}
        title="Free up space?"
        body="Removes this phone's copy of audio that's already on your server. You can still play it from the server when you're online."
        confirmLabel="Remove copies"
        onConfirm={async () => {
          const freed = await removeLocalAudio();
          toast(freed > 0 ? `Freed ${bytes(freed)}.` : "Nothing to remove yet.");
        }}
      />
    </div>
  );
}
