import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Download, HardDrive, Share, SquarePlus } from "lucide-react";
import { toast } from "sonner";
import type { DisplayMode } from "@/components/AppShell";
import { AccountsPanel } from "@/components/AccountsPanel";
import { SignInCard } from "@/components/SignInCard";
import { BackLink, ConfirmSheet, PageHeader, SW } from "@/components/ui";
import { signOut, waitingCount } from "@/lib/account";
import { setSetting } from "@/lib/db";
import { earlierNotesFile } from "@/lib/earlier";
import { bytes } from "@/lib/format";
import { useSession, useSetting, useStorageUse } from "@/lib/hooks";
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
  { id: "standard", label: "White" },
  { id: "contrast", label: "Black" },
  { id: "night", label: "Night" },
];

function SettingsScreen() {
  const session = useSession();
  const connected = session !== null;
  const paused = useSync((s) => s.paused);
  const [waiting, setWaiting] = useState(0);
  const mode = useSetting<DisplayMode>("displayMode", "standard");
  const use = useStorageUse();
  const [leaving, setLeaving] = useState(false);
  const [freeing, setFreeing] = useState(false);
  const [earlier, setEarlier] = useState<{ count: number; text: string } | null>(null);

  useEffect(() => {
    void earlierNotesFile().then(setEarlier);
  }, []);

  return (
    <div className="pb-safe">
      <PageHeader left={<BackLink />} title={<span className="font-display font-semibold tracking-tight text-[22px] text-ink">Settings</span>} />
      <div className="px-4 pb-12">
        <Group label="Your account">
          {session ? (
            <div className="card-at p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 size={20} strokeWidth={SW} className="mt-0.5 shrink-0 text-amber" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] text-ink">{session.email}</p>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">
                    {paused
                      ? "This account is paused. New recordings wait on this phone until the owner turns it back on."
                      : session.role === "master"
                        ? "Master account. Your recordings upload to the server, which writes the transcript and the notes."
                        : "Your recordings upload to the server, which writes the transcript and the notes. Only you can open them."}
                  </p>
                </div>
              </div>
              <button
                className="btn btn-ghost mt-4 w-full"
                onClick={async () => {
                  setWaiting(await waitingCount());
                  setLeaving(true);
                }}
              >
                Sign out
              </button>
            </div>
          ) : (
            <SignInCard />
          )}
        </Group>

        {session?.role === "master" && (
          <Group label="Accounts">
            <AccountsPanel />
          </Group>
        )}

        <Group label="Display">
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => void setSetting("displayMode", m.id)}
                className={cn(
                  "h-11 rounded-[12px] border text-[13.5px] transition-colors",
                  mode === m.id ? "border-amber bg-amber text-on-amber" : "border-line-strong text-ink-muted",
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
                    : `Audio for ${use.count} ${use.count === 1 ? "recording is" : "recordings is"} on this phone (${bytes(use.bytes)}). Everything uploaded is also kept on the server.`}
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
                  then Add to Home Screen. You'll sign in once more there.
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
            <p>Each recording is saved on this phone while you record, then uploaded to a private server.</p>
            <p>
              The server sends the audio to ElevenLabs, which writes the transcript and tells the voices apart. Then it sends the
              transcript to OpenAI, which writes the notes. Your recordings belong to your account. Nobody else who uses the app can
              open them.
            </p>
            <p>
              Get everyone's agreement before you record. In California and several other states, recording a private conversation
              without the consent of everyone in it is against the law.
            </p>
          </div>
        </Group>
      </div>

      <ConfirmSheet
        open={leaving}
        onClose={() => setLeaving(false)}
        title="Sign out of this phone?"
        body={
          waiting > 0
            ? `Your recordings stay on the server. ${waiting} ${waiting === 1 ? "recording hasn't" : "recordings haven't"} uploaded yet. ${waiting === 1 ? "It stays" : "They stay"} on this phone and ${waiting === 1 ? "uploads" : "upload"} when you sign in again.`
            : "Your recordings stay on the server. The copies on this phone are removed until you sign in again."
        }
        confirmLabel="Sign out"
        onConfirm={async () => {
          await signOut();
          toast("Signed out.");
        }}
      />
      <ConfirmSheet
        open={freeing}
        onClose={() => setFreeing(false)}
        title="Free up space?"
        body="Removes this phone's copy of audio that's already on the server. You can still play it from the server when you're online."
        confirmLabel="Remove copies"
        onConfirm={async () => {
          const freed = await removeLocalAudio();
          toast(freed > 0 ? `Freed ${bytes(freed)}.` : "Nothing to remove yet.");
        }}
      />
    </div>
  );
}
