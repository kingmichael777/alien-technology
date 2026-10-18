import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FileAudio, Phone } from "lucide-react";
import { toast } from "sonner";
import { addFile } from "@/lib/library";
import { Sheet, Spinner, SW } from "./ui";

const ACCEPT = "audio/*,.m4a,.mp3,.wav,.aac,.ogg,.opus,.webm";

/** "Add a file" and "Record a call", under the big record button. */
export function AddRecording() {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [callHelp, setCallHelp] = useState(false);

  const pick = () => input.current?.click();

  return (
    <>
      <div className="mt-7 flex w-full max-w-[340px] gap-2.5">
        <button type="button" onClick={pick} disabled={busy} className="btn btn-ghost h-11 flex-1 rounded-full px-3 text-[14px]">
          {busy ? <Spinner /> : <FileAudio size={18} strokeWidth={SW} className="text-amber" />}
          Add a file
        </button>
        <button type="button" onClick={() => setCallHelp(true)} className="btn btn-ghost h-11 flex-1 rounded-full px-3 text-[14px]">
          <Phone size={18} strokeWidth={SW} className="text-amber" />
          Record a call
        </button>
      </div>

      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-label="Add an audio file"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setCallHelp(false);
          setBusy(true);
          try {
            const id = await addFile(file);
            toast("Added. It's uploading to your server now.");
            void navigate({ to: "/r/$id", params: { id } });
          } catch (err) {
            toast(err instanceof Error ? err.message : "That file couldn't be added.");
          } finally {
            setBusy(false);
          }
        }}
      />

      <Sheet open={callHelp} onClose={() => setCallHelp(false)} title="Record a phone call">
        <div className="space-y-5 px-5 pb-2">
          <p className="text-[14.5px] leading-relaxed text-ink-muted">
            Alien can't hear a call on the same iPhone. Your iPhone records the call itself, then Alien turns that recording into a
            transcript and notes.
          </p>
          <ol className="space-y-4">
            {[
              "During the call, tap More, then Call Recording. Everyone on the call hears a notice that it's being recorded.",
              "After the call, open Notes and go to the Call Recordings folder. Open the recording, tap the three dots and save the audio to Files.",
              "Come back here, tap Add the recording and pick that file.",
            ].map((text, i) => (
              <li key={i} className="flex gap-3.5">
                <span className="grid size-7 shrink-0 place-items-center rounded-full border border-amber-line font-mono text-[13px] text-amber">
                  {i + 1}
                </span>
                <span className="pt-0.5 text-[15px] leading-relaxed text-ink">{text}</span>
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn-primary w-full" onClick={pick} disabled={busy}>
            Add the recording
          </button>
        </div>
      </Sheet>
    </>
  );
}
