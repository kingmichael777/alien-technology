import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, ChevronRight, History, Search as SearchIcon, X } from "lucide-react";
import { useSearchIndex, search, type HitKind } from "@/data/search";
import { useSetting } from "@/data/hooks";
import { settingsRepo } from "@/data/repo";
import { typeIcon } from "@/components/at/notes";
import { EmptyState, Highlight, OfflineChip, Redact, SW } from "@/components/at/ui";
import type { NoteType } from "@/data/db";

export const Route = createFileRoute("/search")({
  head: () => ({
    meta: [
      { title: "Search · Alien Technology" },
      { name: "description", content: "Search across every case, subject, note and piece of evidence on this device." },
      { property: "og:title", content: "Search · Alien Technology" },
      { property: "og:description", content: "Search across every case, subject and note on this device." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SearchScreen,
});

const GROUPS: { kind: HitKind; label: string }[] = [
  { kind: "case", label: "Cases" },
  { kind: "subject", label: "Subjects" },
  { kind: "note", label: "Notes" },
  { kind: "evidence", label: "Evidence" },
];

function snippet(text: string, terms: string[], len = 110) {
  if (!text) return "";
  const lower = text.toLowerCase();
  const at = Math.min(...terms.map((t) => lower.indexOf(t.toLowerCase())).filter((i) => i >= 0), Infinity);
  if (!isFinite(at) || at < 40) return text.slice(0, len) + (text.length > len ? "..." : "");
  const start = Math.max(0, at - 40);
  return "..." + text.slice(start, start + len) + (start + len < text.length ? "..." : "");
}

function SearchScreen() {
  const { index, sealedCount, ready } = useSearchIndex();
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const recent = useSetting<string[]>("recentSearches", []);
  useEffect(() => input.current?.focus(), []);

  const hits = useMemo(() => search(index, q), [index, q]);
  const remember = (term = q) => {
    const t = term.trim();
    if (t.length < 2) return;
    void settingsRepo.set("recentSearches", [t, ...recent.filter((r) => r.toLowerCase() !== t.toLowerCase())].slice(0, 8));
  };

  return (
    <div>
      <header className="pt-safe sticky top-0 z-30 border-b border-line bg-bg/92 px-4 pb-3 backdrop-blur-md">
        <div className="flex min-h-12 items-center justify-between">
          <h1 className="font-serif text-2xl font-semibold">Search</h1>
          <OfflineChip />
        </div>
        <form className="relative" onSubmit={(e) => { e.preventDefault(); remember(); input.current?.blur(); }}>
          <SearchIcon size={18} strokeWidth={SW} className="absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted" />
          <input
            ref={input}
            type="search"
            enterKeyHint="search"
            className="field pl-10 font-mono text-[14px]"
            style={{ caretColor: "var(--amber)" }}
            placeholder="Names, aliases, notes, files"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button type="button" aria-label="Clear" onClick={() => setQ("")} className="tap absolute top-0 right-0 inline-flex items-center justify-center text-ink-muted">
              <X size={18} strokeWidth={SW} />
            </button>
          )}
        </form>
      </header>

      <div className="px-4 pt-4">
        {!q.trim() && (
          <section>
            <div className="section-label mb-2">Recent searches</div>
            {recent.length === 0 ? (
              <p className="text-sm text-ink-muted">No recent searches.</p>
            ) : (
              <div className="card-at overflow-hidden">
                {recent.map((r) => (
                  <button key={r} onClick={() => setQ(r)} className="flex min-h-12 w-full items-center gap-3 border-b border-line px-4 text-left font-mono text-[13px] last:border-b-0">
                    <History size={16} strokeWidth={SW} className="text-ink-faint" />
                    <span className="flex-1 truncate">{r}</span>
                  </button>
                ))}
              </div>
            )}
            {recent.length > 0 && (
              <button className="mt-2 min-h-10 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-muted" onClick={() => settingsRepo.set("recentSearches", [])}>Clear recent</button>
            )}
          </section>
        )}

        {q.trim() && ready && hits.length === 0 && <EmptyState title="No matches." body="Try a shorter word or a different spelling." />}

        {GROUPS.map(({ kind, label }) => {
          const list = hits.filter((h) => h.kind === kind).slice(0, 25);
          if (!list.length) return null;
          return (
            <section key={kind} className="mb-6">
              <div className="section-label mb-2">{label}</div>
              <div className="card-at overflow-hidden">
                {list.map((h) => {
                  const Icon = kind === "note" ? typeIcon[(h.noteType ?? "text") as NoteType] : kind === "case" ? Box : null;
                  const inHidden = h.terms.some((t) => h.hidden.toLowerCase().includes(t)) && !h.terms.some((t) => `${h.title} ${h.text}`.toLowerCase().includes(t));
                  const body = (
                    <>
                      {Icon && <Icon size={18} strokeWidth={SW} className="mt-0.5 shrink-0 text-amber" />}
                      <span className="min-w-0 flex-1">
                        <span className={kind === "subject" ? "block font-serif text-lg font-semibold" : kind === "case" ? "codename block text-[15px]" : "block font-mono text-[13.5px]"}>
                          <Highlight text={h.title} terms={h.terms} />
                        </span>
                        {kind !== "case" && h.text && kind !== "evidence" && (
                          <span className="mt-0.5 block font-mono text-[11.5px] leading-relaxed text-ink-muted">
                            <Highlight text={snippet(h.text, h.terms)} terms={h.terms} />
                          </span>
                        )}
                        {inHidden && (
                          <span className="mt-1 flex items-center gap-2 font-mono text-[11px] text-ink-muted">
                            Match in a redacted value <Redact text="redacted" redacted />
                          </span>
                        )}
                        {kind !== "case" && <span className="mt-1 block font-mono text-[10.5px] tracking-[0.08em] text-ink-faint">{h.codename}</span>}
                      </span>
                      <ChevronRight size={16} strokeWidth={SW} className="mt-1 text-ink-faint" />
                    </>
                  );
                  const cls = "flex gap-3 border-b border-line px-4 py-3 last:border-b-0 active:bg-surface-raised";
                  const onClick = () => remember();
                  if (kind === "case") return <Link key={h.id} to="/case/$id" params={{ id: h.id }} onClick={onClick} className={cls}>{body}</Link>;
                  if (kind === "subject") return <Link key={h.id} to="/case/$id/subject/$sid" params={{ id: h.caseId, sid: h.id }} onClick={onClick} className={cls}>{body}</Link>;
                  if (kind === "note") return <Link key={h.id} to="/case/$id/note/$nid" params={{ id: h.caseId, nid: h.id }} onClick={onClick} className={cls}>{body}</Link>;
                  return <Link key={h.id} to="/evidence/$eid" params={{ eid: h.id }} onClick={onClick} className={cls}>{body}</Link>;
                })}
              </div>
            </section>
          );
        })}

        {sealedCount > 0 && <p className="py-4 text-center font-mono text-[11px] tracking-[0.08em] text-ink-faint">Sealed cases are not searched.</p>}
      </div>
    </div>
  );
}
