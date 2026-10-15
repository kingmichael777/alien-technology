import type { CaseRec } from "@/data/db";
import { QuietState } from "@/components/at/ui";

/** Map for one case. Placeholder until the map lands. */
export function CaseMapTab({ c }: { c: CaseRec }) {
  void c;
  return <QuietState label="Map" />;
}
