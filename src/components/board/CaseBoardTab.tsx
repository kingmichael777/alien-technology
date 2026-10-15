import type { CaseRec } from "@/data/db";
import { QuietState } from "@/components/at/ui";

/** Evidence board for one case. Placeholder until the board lands. */
export function CaseBoardTab({ c }: { c: CaseRec }) {
  void c;
  return <QuietState label="Evidence board" />;
}
