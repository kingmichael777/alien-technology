import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AudioLines, FileText, MoreHorizontal, Pencil, RefreshCw, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AudioPlayer, usePlayer } from "@/components/AudioPlayer";
import { StatusLine, usePhase } from "@/components/Status";
import { BackLink, ConfirmSheet, PageHeader, Sheet, SheetRow, Spinner, SW, TextSheet } from "@/components/ui";
import type { Notes, Segment } from "@/lib/api";
import type { RecordingRow } from "@/lib/db";
import { length, longWhen, stamp } from "@/lib/format";
import { useRecording } from "@/lib/hooks";
import { audioBlob, deleteRecording, fetchRecording, renameRecording, renameSpeaker, rewriteNotes } from "@/lib/library";
import { displayTitle, extensionFor, fileName, fillSpeakers, hasRealTitle, shareText, speakerName, type Names } from "@/lib/notes";
import { shareFileOut, shareTextOut } from "@/lib/share";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/r/$id")({
  head: () => ({ meta: [{ title: "Recording · Alien Technology" }] }),
  component: RecordingScreen,
});

const say = (e: unknown) => toast(e instanceof Error ? e.message : "That didn't work. Try again.");

function RecordingScreen() {
  const { id } = Route.useParams();
  const row = useRecording(id);
  const [looked, setLooked] = useState(false);

  // A link to a recording this phone hasn't seen: ask the server for it.
  useEffect(() => {
    if (row === null && !looked) void fetchRecording(id).finally(() => setLooked(true));
  }, [row, looked, id]);

  if (row === undefined || (row === null && !looked)) {
    return (
      <div className="pb-safe">
        <PageHeader left={<BackLink />} title={null} />
      </div>
    );
  }
  if (row === null) {
    return (
      <div className="pb-safe">
        <PageHeader left={<BackLink />} title={null} />
        <div className="px-6 py-16 text-center">
          <p className="font-serif text-[22px] text-ink">This recording isn't here</p>
          <p className="mt-2 text-[14px] text-ink-muted">It may have been deleted, or this phone isn't connected to your server.</p>
        </div>
      </div>
    );
  }
  return <Recording row={row} />;
}

type Tab = "notes" | "transcript";

function Recording({ row }: { row: RecordingRow }) {
  const navigate = useNavigate();
  const phase = usePhase(row);
  const s = row.server;
  const names: Names = s?.speaker_names ?? {};
  const notes = s?.notes ?? null;
  const transcript = s?.transcript ?? null;
  const hasTranscript = !!transcript && transcript.segments.length > 0;
  const [tab, setTab] = useState<Tab>("notes");
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [speaker, setSpeaker] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sharingAudio, setSharingAudio] = useState(false);
  const durationMs = (transcript?.duration ?? 0) * 1000 || row.durationMs;
  const speakers = transcript?.speakers ?? [];
  const title = displayTitle(row);
  const writingNotes = s?.status === "processing" && (s.stage === "notes" || s.stage === "queued_notes");

  const shareNotes = async (withTranscript: boolean) => {
    setMenu(false);
    const result = await shareTextOut(title, shareText(row, { transcript: withTranscript }));
    if (result === "copied") toast("Copied. Paste it wherever you like.");
    if (result === "downloaded") toast("Saved as a text file.");
  };

  const shareAudio = async () => {
    setMenu(false);
    setSharingAudio(true);
    try {
      const blob = await audioBlob(row);
      if (!blob) {
        toast("The audio isn't available right now.");
        return;
      }
      const type = blob.type || row.mimeType;
      const result = await shareFileOut(new File([blob], fileName(row, extensionFor(type)), { type }));
      if (result === "downloaded") toast("The audio file was saved.");
    } catch (e) {
      say(e);
    } finally {
      setSharingAudio(false);
    }
  };

  return (
    <div className="pb-safe">
      <PageHeader
        left={<BackLink />}
        title={null}
        right={
          <button type="button" aria-label="More" onClick={() => setMenu(true)} className="tap inline-flex items-center justify-center text-ink-muted active:text-amber">
            {sharingAudio ? <Spinner /> : <MoreHorizontal size={24} strokeWidth={SW} />}
          </button>
        }
      />

      <div className="px-4 pt-5">
        <button type="button" onClick={() => setRenaming(true)} className="group block w-full text-left" aria-label="Rename recording">
          <h1 className="font-serif text-[28px] leading-[1.1] text-ink">
            {title}
            <Pencil size={15} strokeWidth={SW} className="ml-2 inline-block -translate-y-1 text-ink-faint" />
          </h1>
        </button>
        <p className="mt-2 text-[13px] text-ink-muted">
          {longWhen(row.recordedAt)} · {length(durationMs)}
          {speakers.length > 0 ? ` · ${speakers.length} ${speakers.length === 1 ? "speaker" : "speakers"}` : ""}
        </p>

        {phase.kind !== "ready" && (
          <div className="card-at mt-4 px-4 py-3">
            <StatusLine row={row} />
            {phase.kind === "working" && (
              <p className="mt-2 text-[13px] leading-relaxed text-ink-faint">
                You can leave this screen or close the app. Your server finishes on its own.
              </p>
            )}
            {phase.kind === "local" && phase.progress !== undefined && (
              <p className="mt-2 text-[13px] leading-relaxed text-ink-faint">Keep the app open until the upload finishes.</p>
            )}
          </div>
        )}

        <div className="mt-4">
          <AudioPlayer row={row} durationMs={durationMs} />
        </div>

        {(notes || hasTranscript) && (
          <div role="tablist" className="mt-6 grid grid-cols-2 rounded-[12px] border border-line bg-surface p-1">
            {(["notes", "transcript"] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "h-10 rounded-[9px] text-[14px] font-medium transition-colors",
                  tab === t ? "bg-surface-raised text-amber" : "text-ink-muted",
                )}
              >
                {t === "notes" ? "Notes" : "Transcript"}
              </button>
            ))}
          </div>
        )}

        <div className="mt-6 pb-10">
          {tab === "notes" ? (
            notes ? (
              <NotesView notes={notes} names={names} rewriting={writingNotes} />
            ) : writingNotes ? (
              <Waiting text="Writing the notes. They'll appear here in a moment." />
            ) : null
          ) : hasTranscript ? (
            <TranscriptView segments={transcript!.segments} speakers={speakers} names={names} onSpeaker={setSpeaker} />
          ) : null}
        </div>
      </div>

      <Sheet open={menu} onClose={() => setMenu(false)}>
        <SheetRow icon={<Share2 size={20} strokeWidth={SW} />} label="Share notes" disabled={!notes} onClick={() => void shareNotes(false)} />
        <SheetRow
          icon={<FileText size={20} strokeWidth={SW} />}
          label="Share notes and transcript"
          disabled={!notes && !hasTranscript}
          onClick={() => void shareNotes(true)}
        />
        <SheetRow icon={<AudioLines size={20} strokeWidth={SW} />} label="Share the audio" onClick={() => void shareAudio()} />
        <SheetRow
          icon={<Pencil size={20} strokeWidth={SW} />}
          label="Rename"
          onClick={() => {
            setMenu(false);
            setRenaming(true);
          }}
        />
        <SheetRow
          icon={<RefreshCw size={20} strokeWidth={SW} />}
          label="Rewrite the notes"
          hint="Writes them again from the transcript."
          disabled={!hasTranscript || s?.status === "processing"}
          onClick={async () => {
            setMenu(false);
            try {
              await rewriteNotes(row);
            } catch (e) {
              say(e);
            }
          }}
        />
        <SheetRow
          icon={<Trash2 size={20} strokeWidth={SW} />}
          label="Delete"
          danger
          onClick={() => {
            setMenu(false);
            setDeleting(true);
          }}
        />
      </Sheet>

      <TextSheet
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename"
        label="Name"
        initial={s?.title ?? (hasRealTitle(row) ? title : "")}
        placeholder={s?.ai_title ?? "Recording"}
        hint={s?.ai_title ? "Leave it empty to use the suggested name." : undefined}
        submitLabel="Save"
        onSubmit={async (v) => {
          try {
            await renameRecording(row, v);
            setRenaming(false);
          } catch (e) {
            say(e);
          }
        }}
      />

      <TextSheet
        open={speaker !== null}
        onClose={() => setSpeaker(null)}
        title="Who is this?"
        label={speaker ? `Name for ${speakerName(speaker, {})}` : "Name"}
        initial={speaker ? (names[speaker] ?? "") : ""}
        placeholder="Name"
        hint="The transcript and notes use this name everywhere."
        submitLabel="Save"
        onSubmit={async (v) => {
          if (!speaker) return;
          try {
            await renameSpeaker(row, speaker, v);
            setSpeaker(null);
          } catch (e) {
            say(e);
          }
        }}
      />

      <ConfirmSheet
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete this recording?"
        body="The audio, transcript and notes are removed from this phone and from your server. This can't be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await deleteRecording(row);
            void navigate({ to: "/", replace: true });
          } catch (e) {
            say(e);
          }
        }}
      />
    </div>
  );
}

function Waiting({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 text-[14px] text-ink-muted">
      <Spinner />
      {text}
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="section-label mb-3">{label}</h2>
      {children}
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((t, i) => (
        <li key={i} className="flex gap-3 text-[15.5px] leading-relaxed text-ink">
          <span className="mt-[0.7em] size-1.5 shrink-0 rounded-full bg-amber" aria-hidden />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

function NotesView({ notes, names, rewriting }: { notes: Notes; names: Names; rewriting: boolean }) {
  const f = (t: string) => fillSpeakers(t, names);
  const empty =
    !notes.key_points.length && !notes.follow_ups.length && !notes.details.length && !notes.open_questions.length;
  return (
    <div className="space-y-8">
      {rewriting && <Waiting text="Rewriting the notes." />}
      {notes.summary && (
        <Section label="Summary">
          <p className="text-[16.5px] leading-relaxed text-ink">{f(notes.summary)}</p>
        </Section>
      )}
      {notes.key_points.length > 0 && (
        <Section label="Key points">
          <Bullets items={notes.key_points.map(f)} />
        </Section>
      )}
      {notes.follow_ups.length > 0 && (
        <Section label="Follow-ups">
          <ul className="space-y-3">
            {notes.follow_ups.map((x, i) => (
              <li key={i} className="card-at px-4 py-3">
                <p className="text-[15.5px] leading-snug text-ink">{f(x.task)}</p>
                {(x.who || x.when) && (
                  <p className="mt-1 text-[13px] text-ink-muted">{[x.who && f(x.who), x.when].filter(Boolean).join(" · ")}</p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {notes.details.length > 0 && (
        <Section label="Details">
          <dl className="card-at divide-y divide-line">
            {notes.details.map((d, i) => (
              <div key={i} className="px-4 py-2.5">
                <dt className="text-[12.5px] text-ink-muted">{f(d.label)}</dt>
                <dd className="mt-0.5 text-[15px] text-ink select-text">{f(d.value)}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
      {notes.open_questions.length > 0 && (
        <Section label="Open questions">
          <Bullets items={notes.open_questions.map(f)} />
        </Section>
      )}
      {empty && !notes.summary && <p className="text-[14px] text-ink-muted">There wasn't enough said to write notes.</p>}
    </div>
  );
}

function TranscriptView({
  segments,
  speakers,
  names,
  onSpeaker,
}: {
  segments: Segment[];
  speakers: string[];
  names: Names;
  onSpeaker: (id: string) => void;
}) {
  const time = usePlayer((s) => s.time);
  const playing = usePlayer((s) => s.playing);
  const seek = usePlayer((s) => s.seek);
  const order = useMemo(() => new Map(speakers.map((id, i) => [id, i])), [speakers]);
  let active = -1;
  if (playing || time > 0) {
    for (let i = 0; i < segments.length; i++) if (segments[i].start <= time + 0.25) active = i;
  }

  return (
    <div>
      {speakers.length > 0 && (
        <div className="mb-5">
          <div className="flex flex-wrap gap-2">
            {speakers.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => onSpeaker(id)}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong px-3.5 text-[14px] text-ink active:border-amber-line"
              >
                <span className={cn("size-2 rounded-full", (order.get(id) ?? 0) % 2 === 0 ? "bg-amber" : "bg-ink")} />
                {speakerName(id, names)}
                <Pencil size={13} strokeWidth={SW} className="text-ink-faint" />
              </button>
            ))}
          </div>
          <p className="mt-2.5 text-[12.5px] text-ink-muted">Tap a name to change it. Tap a time to listen from there.</p>
        </div>
      )}
      <ol className="space-y-1">
        {segments.map((seg, i) => {
          const even = (order.get(seg.speaker) ?? 0) % 2 === 0;
          return (
            <li key={i} className={cn("border-l-2 py-2 pl-3.5 transition-colors", i === active ? "border-amber" : "border-transparent")}>
              <div className="flex items-baseline gap-2.5">
                <button
                  type="button"
                  onClick={() => onSpeaker(seg.speaker)}
                  className={cn("text-[13.5px] font-medium", even ? "text-amber" : "text-ink")}
                >
                  {speakerName(seg.speaker, names)}
                </button>
                <button type="button" onClick={() => seek(seg.start)} className="font-mono text-[12px] text-ink-muted underline-offset-2 active:underline">
                  {stamp(seg.start)}
                </button>
              </div>
              <p className="mt-1 text-[15.5px] leading-relaxed text-ink/90 select-text">{seg.text}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
