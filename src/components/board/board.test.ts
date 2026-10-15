import { describe, expect, it } from "vitest";
import type { EvidenceRec, LinkRec, NoteRec, SubjectRec } from "@/data/db";
import { autoLayout, buildBoard, CARD_W, distToSegment, estimateHeight, excerpt, freeSpot, overlaps, segmentHitsRect, stringEnds, type Rect } from "./model";

const note = (id: string, type: NoteRec["type"], p: Partial<NoteRec> = {}): NoteRec => ({
  id, caseId: "c", type, title: "", body: "", transcript: "", durationMs: 0, createdAt: 1, updatedAt: 1, location: null,
  attachmentIds: [], subjectIds: [], flagged: false, sample: false, ...p,
});
const ev = (id: string, kind: EvidenceRec["kind"], noteId: string | null, p: Partial<EvidenceRec> = {}): EvidenceRec => ({
  id, caseId: "c", noteId, kind, blobId: `b-${id}`, fileName: `${id}.jpg`, mimeType: "image/jpeg", size: 1, sha256: "", exif: {},
  gps: null, capturedAt: 1, custody: [], sample: false, ...p,
});
const subj = (id: string, name: string): SubjectRec => ({
  id, caseId: "c", name, aliases: [], photoBlobId: null, lastSeen: { place: "", detail: "", at: null }, coordinates: null,
  threatLevel: "undetermined", fields: [], redacted: [], sample: false,
});
const link = (id: string, fromId: string, fromKind: LinkRec["fromKind"], toId: string, toKind: LinkRec["toKind"], label = ""): LinkRec => ({
  id, caseId: "c", fromId, fromKind, toId, toKind, label, createdAt: 1,
});

describe("board cards", () => {
  const notes = [note("pn", "photo"), note("vn", "voice"), note("tn", "text"), note("ln", "location"), note("orphan-photo", "photo")];
  const evidence = [ev("pe", "photo", "pn"), ev("ae", "audio", "vn")];
  const subjects = [subj("s1", "Kaelin, E.")];

  it("draws a photo once, keyed by its evidence, and skips audio as a card", () => {
    const b = buildBoard(notes, evidence, subjects, []);
    const ids = b.cards.map((c) => c.id).sort();
    expect(ids).toEqual(["ln", "orphan-photo", "pe", "s1", "tn", "vn"].sort());
    expect(b.cards.find((c) => c.id === "pe")).toMatchObject({ kind: "photo", entity: { id: "pe", kind: "evidence" } });
    expect(b.cards.find((c) => c.id === "orphan-photo")).toMatchObject({ kind: "photo", entity: { id: "orphan-photo", kind: "note" } });
  });

  it("maps links on the photo note, the photo evidence and the audio onto the right cards", () => {
    const links = [
      link("l1", "pn", "note", "ln", "note"),
      link("l2", "pe", "evidence", "tn", "note"),
      link("l3", "ae", "evidence", "s1", "subject"),
      link("l4", "pn", "note", "pe", "evidence"),
      link("l5", "missing", "note", "tn", "note"),
    ];
    const b = buildBoard(notes, evidence, subjects, links);
    const pairs = b.strings.map((s) => [s.source, s.target].sort().join("|")).sort();
    expect(pairs).toEqual(["ln|pe", "pe|tn", "s1|vn"]);
  });

  it("shares one string between two links on the same pair of cards", () => {
    const b = buildBoard(notes, evidence, subjects, [link("a", "pn", "note", "tn", "note"), link("b", "tn", "note", "pe", "evidence")]);
    expect(b.strings).toHaveLength(1);
    expect(b.strings[0]!.links.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("leaves encrypted records off the board", () => {
    const sealed = { ...note("x", "text"), enc: { iv: "", ct: "" } } as unknown as NoteRec;
    const b = buildBoard([sealed], [], [], []);
    expect(b.cards).toHaveLength(0);
    expect(b.sealedRecords).toBe(1);
  });
});

describe("auto layout", () => {
  it("puts photos and subjects left, notes in the middle, locations right, with no overlaps", () => {
    const notes = [
      ...Array.from({ length: 9 }, (_, i) => note(`t${i}`, i % 3 === 0 ? "voice" : "text", { title: i % 2 ? "Title" : "", body: "Body", createdAt: i })),
      note("l1", "location"),
      note("l2", "location"),
    ];
    const evidence = [ev("p1", "photo", null), ev("p2", "photo", null)];
    const subjects = [subj("s1", "B"), subj("s2", "A")];
    const b = buildBoard(notes, evidence, subjects, []);
    const pos = autoLayout(b.cards);
    expect(pos.size).toBe(b.cards.length);
    const xOf = (id: string) => pos.get(id)!.x;
    expect(xOf("p1")).toBe(0);
    expect(xOf("s1")).toBe(0);
    expect(xOf("t0")).toBeGreaterThan(xOf("p1"));
    expect(xOf("l1")).toBeGreaterThan(Math.max(...notes.filter((n) => n.type !== "location").map((n) => xOf(n.id))));
    // Photos come before subjects; subjects sort by name.
    expect(pos.get("p2")!.y).toBeLessThan(pos.get("s2")!.y);
    expect(pos.get("s2")!.y).toBeLessThan(pos.get("s1")!.y);
    const rects: Rect[] = b.cards.map((k) => ({ ...pos.get(k.id)!, w: CARD_W, h: estimateHeight(k) }));
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
  });

  it("keeps the sample case's strings out of other cards", () => {
    const notes = [
      note("n1", "text", { title: "Surveillance Excerpt // 04.17.25", body: "Subject observed meeting.", createdAt: 5 }),
      note("n2", "voice", { title: "Field Report // R. Delgado", transcript: "Biometrics partially scanned.", createdAt: 6 }),
      note("n3", "text", { title: "Internal Flag // AI Threat Matrix", body: "Non-standard patterns.", createdAt: 7 }),
      note("pale", "text", { title: "The Pale Signal", body: "Encrypted broadcast.", createdAt: 8 }),
      note("pn", "photo", { title: "IMG_0047.NV", createdAt: 1 }),
      note("ln", "location", { title: "PINE RIDGE, CO", createdAt: 2 }),
      note("tn", "text", { body: "Multiple reports of lights and humming sounds.", createdAt: 3 }),
    ];
    const subjects = [subj("k", "Kaelin, E."), subj("m", "L. Morrow"), subj("s", "V. Solis")];
    const links = [
      link("a", "k", "subject", "m", "subject"),
      link("b", "k", "subject", "s", "subject"),
      link("c", "k", "subject", "pale", "note"),
      link("d", "pe", "evidence", "ln", "note"),
      link("e", "pe", "evidence", "tn", "note"),
      link("f", "tn", "note", "ln", "note"),
    ];
    const b = buildBoard(notes, [ev("pe", "photo", "pn")], subjects, links);
    const pos = autoLayout(b.cards, estimateHeight, b.strings.map((s) => [s.source, s.target]));
    const rect = (id: string): Rect => {
      const k = b.cards.find((c) => c.id === id)!;
      return { ...pos.get(id)!, w: CARD_W, h: estimateHeight(k) };
    };
    for (const s of b.strings) {
      const ends = stringEnds(rect(s.source), rect(s.target))!;
      expect(ends).not.toBeNull();
      for (const k of b.cards) {
        if (k.id === s.source || k.id === s.target) continue;
        expect(segmentHitsRect(ends[0], ends[1], rect(k.id)), `${s.id} crosses ${k.id}`).toBe(false);
      }
    }
    const rects = b.cards.map((k) => rect(k.id));
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
  });

  it("finds a free spot near the requested center", () => {
    const taken: Rect[] = [{ x: -100, y: -100, w: 200, h: 200 }];
    const p = freeSpot(taken, 200, 150, { x: 0, y: 0 });
    expect(overlaps({ ...p, w: 200, h: 150 }, taken[0]!, 24)).toBe(false);
    expect(Math.hypot(p.x + 100, p.y + 75)).toBeLessThan(400);
    expect(freeSpot([], 200, 100, { x: 50, y: 50 })).toEqual({ x: -50, y: 0 });
  });
});

describe("string geometry", () => {
  it("runs from card edge to card edge", () => {
    const ends = stringEnds({ x: 0, y: 0, w: 100, h: 100 }, { x: 300, y: 0, w: 100, h: 100 });
    expect(ends).toEqual([{ x: 100, y: 50 }, { x: 300, y: 50 }]);
    const diag = stringEnds({ x: 0, y: 0, w: 200, h: 100 }, { x: 0, y: 300, w: 200, h: 100 })!;
    expect(diag[0]).toEqual({ x: 100, y: 100 });
    expect(diag[1]).toEqual({ x: 100, y: 300 });
  });
  it("draws nothing for overlapping cards", () => {
    expect(stringEnds({ x: 0, y: 0, w: 200, h: 100 }, { x: 50, y: 20, w: 200, h: 100 })).toBeNull();
  });
  it("tells whether a segment passes through a rectangle", () => {
    const r = { x: 10, y: 10, w: 20, h: 20 };
    expect(segmentHitsRect({ x: 0, y: 20 }, { x: 40, y: 20 }, r)).toBe(true);
    expect(segmentHitsRect({ x: 0, y: 0 }, { x: 40, y: 5 }, r)).toBe(false);
    expect(segmentHitsRect({ x: 0, y: 0 }, { x: 5, y: 5 }, r)).toBe(false);
    expect(segmentHitsRect({ x: 15, y: 15 }, { x: 16, y: 16 }, r)).toBe(true);
  });
  it("measures distance to a segment", () => {
    expect(distToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distToSegment({ x: -4, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
  });
});

describe("excerpts", () => {
  it("strips Markdown marks", () => {
    expect(excerpt("# Heading\n- **bold** item\n> quote with [link](http://x)")).toBe("Heading bold item quote with link");
  });
});
