import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, Settings, X } from "lucide-react";
import { ConnectCard } from "@/components/ConnectCard";
import { RecordButton } from "@/components/RecordButton";
import { StatusLine, usePhase } from "@/components/Status";
import { Hexagon, Highlight, OfflineChip, SW } from "@/components/ui";
import type { RecordingRow } from "@/lib/db";
import { length, when } from "@/lib/format";
import { useConnected, useRecordings } from "@/lib/hooks";
import { displayTitle, fillSpeakers, matches, searchTerms, snippet, speakerCount } from "@/lib/notes";
import { useSync } from "@/lib/sync";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Alien Technology" }] }),
  component: Home,
});

function Home() {
  const rows = useRecordings();
  const connected = useConnected();
  const codeRefused = useSync((s) => s.codeRefused);
  const [query, setQuery] = useState("");
  const terms = useMemo(() => searchTerms(query), [query]);
  const shown = useMemo(() => (rows ?? []).filter((r) => matches(r, terms)), [rows, terms]);
  const any = (rows?.length ?? 0) > 0;

  return (
    <div className="pb-safe">
      <header className="pt-safe px-4">
        <div className="flex h-14 items-center gap-2.5">
          <Hexagon className="size-7" />
          <span className="font-serif text-[22px] tracking-tight text-ink">Alien Technology</span>
          <span className="flex-1" />
          <OfflineChip />
          <Link to="/settings" aria-label="Settings" className="tap inline-flex items-center justify-center text-ink-muted active:text-amber">
            <Settings size={23} strokeWidth={SW} />
          </Link>
        </div>
      </header>

      <section className="flex flex-col items-center px-6 pt-7 pb-9">
        <RecordButton />
        <p className="mt-5 font-serif text-[24px] leading-none text-ink">Tap to record</p>
        <p className="mt-2.5 text-[13.5px] text-ink-muted">Let everyone know you're recording.</p>
      </section>

      {!connected && <ConnectCard className="mx-4 mb-7" />}
      {connected && codeRefused && (
        <Link to="/settings" className="card-at mx-4 mb-7 block border-pin/40 px-4 py-3 text-[14px] text-ink">
          Your server stopped accepting the access code on this phone. <span className="text-amber">Open Settings</span> to enter it
          again.
        </Link>
      )}

      <section className="px-4">
        {any && (
          <div className="relative mb-5">
            <Search size={18} strokeWidth={SW} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-faint" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search recordings"
              aria-label="Search recordings"
              className="field pr-10 pl-10 text-[15px]"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
                className="tap absolute top-1/2 right-0.5 grid -translate-y-1/2 place-items-center text-ink-muted"
              >
                <X size={18} strokeWidth={SW} />
              </button>
            )}
          </div>
        )}

        <div className="section-label mb-3">{terms.length ? `${shown.length} found` : "Recordings"}</div>

        {rows === undefined ? null : !any ? (
          <div className="card-at px-5 py-8 text-center">
            <p className="font-serif text-[20px] text-ink">No recordings yet</p>
            <p className="mx-auto mt-2 max-w-[30ch] text-[14px] leading-relaxed text-ink-muted">
              Record a conversation and it shows up here with a written transcript and notes.
            </p>
          </div>
        ) : shown.length === 0 ? (
          <p className="px-1 py-6 text-[14px] text-ink-muted">Nothing matches "{query.trim()}".</p>
        ) : (
          <ul className="space-y-3">
            {shown.map((r) => (
              <li key={r.id}>
                <RecordingItem row={r} terms={terms} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RecordingItem({ row, terms }: { row: RecordingRow; terms: string[] }) {
  const phase = usePhase(row);
  const names = row.server?.speaker_names ?? {};
  const summary = row.server?.summary ?? row.server?.notes?.summary ?? "";
  const speakers = speakerCount(row);
  const duration = (row.server?.transcript?.duration ?? 0) * 1000 || row.durationMs;
  const match = snippet(row, terms);
  const title = displayTitle(row);

  return (
    <Link to="/r/$id" params={{ id: row.id }} className="card-at block px-4 py-3.5 transition-colors active:bg-surface-raised">
      <div className="flex items-baseline gap-3">
        <h3 className="min-w-0 flex-1 truncate font-serif text-[19px] leading-tight text-ink">
          <Highlight text={title} terms={terms} />
        </h3>
        <span className="shrink-0 font-mono text-[12.5px] tabular-nums text-ink-muted">{length(duration)}</span>
      </div>
      <p className="mt-1 text-[12.5px] text-ink-muted">
        {when(row.recordedAt)}
        {speakers > 0 ? ` · ${speakers} ${speakers === 1 ? "speaker" : "speakers"}` : ""}
      </p>
      {match ? (
        <p className="mt-2 line-clamp-2 text-[14px] leading-snug text-ink/85">
          <Highlight text={match} terms={terms} />
        </p>
      ) : phase.kind === "ready" ? (
        summary && <p className="mt-2 line-clamp-2 text-[14px] leading-snug text-ink/85">{fillSpeakers(summary, names)}</p>
      ) : (
        <StatusLine row={row} className="mt-2.5" />
      )}
    </Link>
  );
}
