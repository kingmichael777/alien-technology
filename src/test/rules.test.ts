import { describe, expect, it } from "vitest";
import { coords, compact, relative } from "@/lib/format";
import { canCapture, resolveCaptureCase, sortCases } from "@/data/rules";
import type { CaseRec } from "@/data/db";

const at = (daysAgo: number, h: number, m: number) => {
  const d = new Date(2026, 9, 15, 12, 0);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};
const NOW = new Date(2026, 9, 15, 12, 0).getTime();

describe("dates and coordinates", () => {
  it("formats case card relative dates", () => {
    expect(relative(at(0, 2, 17), NOW)).toBe("Today, 02:17 AM");
    expect(relative(at(1, 23, 43), NOW)).toBe("Yesterday, 11:43 PM");
    expect(relative(at(3, 20, 9), NOW)).toBe("3 Days Ago, 08:09 PM");
    expect(relative(at(7, 16, 22), NOW)).toBe("1 Week Ago, 04:22 PM");
  });
  it("formats compact dates month first", () => {
    expect(compact(new Date(2024, 10, 8, 2, 17).getTime())).toBe("11.08.24 · 02:17 AM");
  });
  it("formats coordinates with hemispheres", () => {
    expect(coords(39.7425, -105.1786)).toBe("39.7425° N, 105.1786° W");
  });
});

const mk = (id: string, status: CaseRec["status"], t: number): CaseRec => ({ id, codename: id, status, createdAt: 0, lastActivityAt: t, encryptionKeyRef: null, sample: false });

describe("case rules", () => {
  it("sealed and archived cases never accept captures", () => {
    expect(canCapture(mk("a", "sealed", 1))).toBe(false);
    expect(canCapture(mk("a", "archived", 1))).toBe(false);
    expect(canCapture(mk("a", "active", 1))).toBe(true);
  });
  it("files into the open case only when it is active, else the last active case", () => {
    const cases = [mk("open-sealed", "sealed", 5), mk("last", "active", 1)];
    expect(resolveCaptureCase(cases, "open-sealed", "last")?.id).toBe("last");
    expect(resolveCaptureCase(cases, "open-sealed", null)).toBeNull();
  });
  it("orders active cases first, then most recent activity", () => {
    const order = sortCases([mk("s-new", "sealed", 9), mk("a-old", "active", 1), mk("x", "archived", 5)]).map((c) => c.id);
    expect(order).toEqual(["a-old", "s-new", "x"]);
  });
});

import { suggestEntities } from "@/data/rules";
describe("entity suggestions", () => {
  const subs = [{ id: "k", name: "Kaelin, E.", aliases: ["Elias Kane"] }, { id: "m", name: "L. Morrow", aliases: [] }];
  it("matches a surname case-insensitively as a whole word", () => {
    expect(suggestEntities("met kaelin near the gate", subs).subjectIds).toEqual(["k"]);
    expect(suggestEntities("Kaelinson arrived", subs).subjectIds).toEqual([]);
  });
  it("detects coordinates with hemispheres", () => {
    expect(suggestEntities("Fix at 39.7425° N, 105.1786° W", []).coords).toEqual([{ lat: 39.7425, lng: -105.1786 }]);
  });
});
