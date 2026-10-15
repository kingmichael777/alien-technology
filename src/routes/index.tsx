import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Box } from "lucide-react";
import { useCases } from "@/data/hooks";
import type { CaseRec } from "@/data/db";
import { Card, EmptyState, Hexagon, SectionLabel, ShieldLink, StatusPill, useLongPress } from "@/components/at/ui";
import { CaseActionsSheet, CaseCardMeta } from "@/components/at/CaseSheets";
import { useApp } from "@/store/app";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Alien Technology · Case Vaults" },
      { name: "description", content: "Private Investigator Notes. Sealed case vaults stored on this device only." },
      { property: "og:title", content: "Alien Technology · Case Vaults" },
      { property: "og:description", content: "Private Investigator Notes. A phone-first field intelligence notebook." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Vault,
});

function CaseCard({ c, onActions }: { c: CaseRec; onActions: () => void }) {
  const navigate = useNavigate();
  const { handlers, fired } = useLongPress(onActions);
  return (
    <Card
      role="button"
      tabIndex={0}
      {...handlers}
      onClick={() => {
        if (fired.current) return;
        navigate({ to: "/case/$id", params: { id: c.id } });
      }}
      onKeyDown={(e) => e.key === "Enter" && navigate({ to: "/case/$id", params: { id: c.id } })}
      className="anim-fade flex min-h-[84px] cursor-pointer select-none items-center gap-4 px-4 py-3.5 transition-colors active:bg-surface-raised"
      style={{ WebkitTouchCallout: "none" }}
    >
      <Box size={34} strokeWidth={1.25} className="shrink-0 text-amber" />
      <div className="min-w-0 flex-1">
        <div className="codename text-[16px] leading-snug text-ink">{c.codename}</div>
        <CaseCardMeta c={c} />
      </div>
      <StatusPill status={c.status} />
    </Card>
  );
}

function Vault() {
  const cases = useCases();
  const setNewCase = useApp((s) => s.setNewCaseOpen);
  const [sel, setSel] = useState<CaseRec | null>(null);

  return (
    <div className="px-5">
      <header className="pt-safe flex items-start gap-3 pt-6">
        <Hexagon className="mt-1.5 size-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-[30px] leading-tight font-semibold text-ink">Alien Technology</h1>
          <p className="text-sm text-ink-muted">Private Investigator Notes</p>
        </div>
        <ShieldLink />
      </header>
      <p className="mt-4 font-mono text-[11px] tracking-[0.12em] text-ink-muted">STORED ON THIS DEVICE ONLY</p>

      <div className="mt-8 mb-3 flex items-center justify-between">
        <SectionLabel>Sealed Case Vaults</SectionLabel>
        {cases && cases.length > 0 && (
          <button className="tap -mr-2 px-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted active:text-amber" onClick={() => setNewCase(true)}>
            New case
          </button>
        )}
      </div>

      {cases && cases.length === 0 && (
        <EmptyState
          title="No case vaults yet."
          action={
            <button className="btn btn-outline" onClick={() => setNewCase(true)}>
              Open a case
            </button>
          }
        />
      )}
      <div className="space-y-3">
        {cases?.map((c) => <CaseCard key={c.id} c={c} onActions={() => setSel(c)} />)}
      </div>
      {cases && cases.length > 0 && <p className="mt-5 text-center font-mono text-[10.5px] tracking-[0.1em] text-ink-faint">PRESS AND HOLD A CASE FOR OPTIONS</p>}

      <CaseActionsSheet c={sel} open={!!sel} onClose={() => setSel(null)} />
    </div>
  );
}
