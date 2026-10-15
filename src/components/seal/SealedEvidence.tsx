import { Link } from "@tanstack/react-router";
import { BackLink, PageHeader } from "@/components/at/ui";
import { SealMark } from "./SealMark";

/** /evidence/$eid for an encrypted case that is not open: no fields, only the way in. */
export function SealedEvidence({ caseId, codename }: { caseId: string; codename?: string | undefined }) {
  return (
    <div>
      <PageHeader
        back={<BackLink to="/case/$id" params={{ id: caseId }} label="Back to case" />}
        title={<div className="truncate font-mono text-[11.5px] uppercase tracking-[0.12em] text-ink-muted">{codename}</div>}
      />
      <div className="anim-fade flex flex-col items-center px-8 pt-[12vh] text-center">
        <SealMark />
        <p className="mt-5 font-serif text-2xl text-ink">This evidence is sealed.</p>
        <p className="mt-2 max-w-[30ch] text-sm text-ink-muted">It belongs to an encrypted case. Open the case with its passcode to view it.</p>
        <Link to="/case/$id" params={{ id: caseId }} search={{ tab: "evidence" }} className="btn btn-primary mt-7 min-w-[180px]">
          Open case
        </Link>
      </div>
    </div>
  );
}
