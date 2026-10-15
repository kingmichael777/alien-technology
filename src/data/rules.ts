import type { CaseRec, NoteRec, SubjectRec } from "./db";

/** Only Active cases accept captures. */
export function canCapture(c: CaseRec | null | undefined): boolean {
  return !!c && c.status === "active";
}

/** Active first, then most recent activity. */
export function sortCases(cases: CaseRec[]): CaseRec[] {
  return [...cases].sort((a, b) => {
    const aa = a.status === "active" ? 0 : 1;
    const bb = b.status === "active" ? 0 : 1;
    if (aa !== bb) return aa - bb;
    return b.lastActivityAt - a.lastActivityAt;
  });
}

/** The case a capture files into: the preferred (open or chosen) case, else the last Active case opened. */
export function resolveCaptureCase(
  cases: CaseRec[],
  preferredId: string | null,
  lastActiveId: string | null,
): CaseRec | null {
  const pref = cases.find((c) => c.id === preferredId);
  if (canCapture(pref)) return pref!;
  const last = cases.find((c) => c.id === lastActiveId);
  if (canCapture(last)) return last!;
  return null;
}

export function noteHeadline(n: NoteRec): string {
  if (n.title.trim()) return n.title.trim();
  const src = n.body || n.transcript;
  const first = src.split("\n").find((l) => l.trim());
  if (first) return first.replace(/^#+\s*/, "").trim().slice(0, 80);
  return { text: "Untitled note", voice: "Voice note", photo: "Photo", location: "Location ping" }[n.type];
}

export function normalizeCodename(s: string): string {
  return s.trim().replace(/\s+/g, " ").toUpperCase();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Case-insensitive whole-word match. */
export function mentions(text: string, term: string): boolean {
  const t = term.trim();
  if (t.length < 2) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t)}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

/** Names a subject can be mentioned by: full name, aliases, and the surname part of "Surname, X." */
export function subjectTerms(s: Pick<SubjectRec, "name" | "aliases">): string[] {
  const terms = [s.name, ...s.aliases];
  const surname = s.name.split(",")[0]?.trim();
  if (surname && surname !== s.name && surname.length >= 3) terms.push(surname);
  return terms.filter((t) => t.trim().length >= 2);
}

export interface Suggestions {
  subjectIds: string[];
  coords: { lat: number; lng: number }[];
}

const COORD_RE = /(-?\d{1,2}\.\d{3,})\s*°?\s*([NS])?\s*,\s*(-?\d{1,3}\.\d{3,})\s*°?\s*([EW])?/gi;

/** Rule-based entity suggestions. No AI, nothing leaves the device. */
export function suggestEntities(text: string, subjects: Pick<SubjectRec, "id" | "name" | "aliases">[]): Suggestions {
  const subjectIds = subjects.filter((s) => subjectTerms(s).some((t) => mentions(text, t))).map((s) => s.id);
  const coords: { lat: number; lng: number }[] = [];
  for (const m of text.matchAll(COORD_RE)) {
    let lat = parseFloat(m[1]!);
    let lng = parseFloat(m[3]!);
    if (m[2]?.toUpperCase() === "S") lat = -Math.abs(lat);
    if (m[4]?.toUpperCase() === "W") lng = -Math.abs(lng);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) coords.push({ lat, lng });
  }
  return { subjectIds, coords };
}
