import { describe, expect, it } from "vitest";
import { splitCodename } from "@/components/at/ui";
import { dateBounds, filterChips, matchesTimeline, NO_FILTER, type TimelineFilter } from "@/components/at/CaseSheets";
import { passcodeProblem, progressLabel, routeKeepsBundle, stageLabel } from "@/components/seal/logic";

const NOW = new Date(2026, 9, 15, 12, 0).getTime();
const at = (daysAgo: number, h = 12, m = 0) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

describe("case header codename", () => {
  it("splits at the first colon into a label and a name", () => {
    expect(splitCodename("OPERATION: NIGHTFALL")).toEqual({ label: "OPERATION", name: "NIGHTFALL" });
    expect(splitCodename("OPERATION: RED: DAWN")).toEqual({ label: "OPERATION", name: "RED: DAWN" });
  });
  it("keeps a codename whole without a colon or with an empty side", () => {
    expect(splitCodename("KESTREL WATCH")).toEqual({ label: null, name: "KESTREL WATCH" });
    expect(splitCodename("OPERATION:")).toEqual({ label: null, name: "OPERATION:" });
    expect(splitCodename(": NIGHTFALL")).toEqual({ label: null, name: ": NIGHTFALL" });
  });
});

describe("timeline filter", () => {
  const f = (p: Partial<TimelineFilter>): TimelineFilter => ({ ...NO_FILTER, ...p });

  it("presets cover whole local days ending today", () => {
    expect(dateBounds(f({ date: "today" }), NOW)).toEqual({ from: at(0, 0, 0), to: new Date(2026, 9, 15, 23, 59, 59, 999).getTime() });
    expect(dateBounds(f({ date: "7d" }), NOW).from).toBe(at(6, 0, 0));
    expect(dateBounds(f({ date: "30d" }), NOW).from).toBe(at(29, 0, 0));
    expect(dateBounds(NO_FILTER, NOW)).toEqual({ from: null, to: null });
  });

  it("custom ranges include both end days and may be open ended", () => {
    const b = dateBounds(f({ date: "custom", from: "2024-11-01", to: "2024-11-08" }), NOW);
    expect(b.from).toBe(new Date(2024, 10, 1).getTime());
    expect(b.to).toBe(new Date(2024, 10, 8, 23, 59, 59, 999).getTime());
    expect(dateBounds(f({ date: "custom", from: "2024-11-01" }), NOW).to).toBeNull();
  });

  it("matches any chosen subject and the date range together", () => {
    const n = { subjectIds: ["k"], createdAt: at(3) };
    expect(matchesTimeline(n, f({ subjects: ["m", "k"] }), NOW)).toBe(true);
    expect(matchesTimeline(n, f({ subjects: ["m"] }), NOW)).toBe(false);
    expect(matchesTimeline(n, f({ date: "7d" }), NOW)).toBe(true);
    expect(matchesTimeline(n, f({ date: "today" }), NOW)).toBe(false);
    expect(matchesTimeline({ subjectIds: [], createdAt: at(7, 0, 0) }, f({ date: "7d" }), NOW)).toBe(false);
  });

  it("turns active filters into removable chips", () => {
    const subjects = [{ id: "k", name: "Kaelin, E." }];
    const chips = filterChips(f({ subjects: ["k"], date: "7d" }), subjects);
    expect(chips.map((c) => c.label)).toEqual(["Kaelin, E.", "Last 7 days"]);
    expect(chips[0]!.next.subjects).toEqual([]);
    expect(chips[1]!.next.date).toBeNull();
    expect(filterChips(f({ date: "custom", from: "2024-11-01", to: "2024-11-08" }), subjects)[0]!.label).toBe("11.01.24 to 11.08.24");
    expect(filterChips(f({ date: "custom" }), subjects)).toEqual([]);
  });
});

describe("seal screens", () => {
  it("asks for six characters and a matching confirmation", () => {
    expect(passcodeProblem("abc12", "abc12")).toBe("Use at least 6 characters.");
    expect(passcodeProblem("fieldtest1", "fieldtest")).toBe("Passcodes do not match.");
    expect(passcodeProblem("fieldtest1", "fieldtest1")).toBeNull();
  });

  it("labels progress and stages", () => {
    expect(progressLabel(0, 40)).toBe("Deriving key");
    expect(progressLabel(12, 40)).toBe("Encrypting 12 of 40");
    expect(stageLabel("key")).toBe("Deriving key");
    expect(stageLabel("decrypt")).toBe("Decrypting");
  });

  it("keeps an open case in memory only on its own screens and evidence pages", () => {
    const b = { caseId: "c1", evidence: [{ id: "e1" }] };
    expect(routeKeepsBundle(b, "/case/c1")).toBe(true);
    expect(routeKeepsBundle(b, "/case/c1/")).toBe(true);
    expect(routeKeepsBundle(b, "/case/c1/subject/s1")).toBe(true);
    expect(routeKeepsBundle(b, "/evidence/e1")).toBe(true);
    expect(routeKeepsBundle(b, "/case/c10")).toBe(false);
    expect(routeKeepsBundle(b, "/evidence/e2")).toBe(false);
    expect(routeKeepsBundle(b, "/search")).toBe(false);
    expect(routeKeepsBundle(b, "/")).toBe(false);
  });
});
