import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import type { CaseRec } from "@/data/db";
import { useBoardPositions } from "@/data/board";
import { useCaseLinks, useCaseNotes, useEvidenceList, useSubjects } from "@/data/hooks";
import { EmptyState } from "@/components/at/ui";
import { BoardCanvas } from "./BoardCanvas";
import { buildBoard } from "./model";

/** Evidence board for one case: every capture, subject and photo as a card, every link as a red string. */
export function CaseBoardTab({ c }: { c: CaseRec }) {
  const notes = useCaseNotes(c.id);
  const evidence = useEvidenceList(c.id);
  const subjects = useSubjects(c.id);
  const links = useCaseLinks(c.id);
  const positions = useBoardPositions(c.id);

  const model = useMemo(
    () => (notes && evidence && subjects && links ? buildBoard(notes, evidence, subjects, links) : null),
    [notes, evidence, subjects, links],
  );
  const saved = useMemo(() => new Map((positions ?? []).map((p) => [p.id, p])), [positions]);

  if (!model || !positions) return <BoardSlot status={c.status} />;
  if (model.cards.length === 0) {
    if (model.sealedRecords > 0) return <EmptyState title="The board is sealed." body="Unseal the case to view its cards." />;
    return <EmptyState title="Nothing on the board yet." body="Captures filed to this case appear here as cards." />;
  }
  return (
    <BoardSlot status={c.status}>
      <ReactFlowProvider key={c.id}>
        <BoardCanvas c={c} model={model} saved={saved} />
      </ReactFlowProvider>
    </BoardSlot>
  );
}

/**
 * The board's box: the full column width (out of the tab's px-4 pt-4 padding) and the full height
 * below the sticky case header. The bottom margin cancels the shell's pb-28 so the page never scrolls
 * under the board; the capsule nav bar floats over the canvas instead.
 */
function BoardSlot({ status, children }: { status: CaseRec["status"]; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (el) setTop(Math.ceil(el.getBoundingClientRect().top + window.scrollY));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [status]);
  return (
    <div ref={ref} className="relative -mx-4 -mt-4 -mb-28 overflow-hidden" style={{ height: `calc(100dvh - ${top}px)` }}>
      {children}
    </div>
  );
}
