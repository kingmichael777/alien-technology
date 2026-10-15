import { describe, expect, it } from "vitest";
import type { EvidenceRec, NoteRec, SubjectRec } from "@/data/db";
import { boundsOf, buildItems, clusterItems, initialCamera, parseCoordinate, parseCoordinatePair, SINGLE_ZOOM, type MapItem } from "./model";

const note = (id: string, p: Partial<NoteRec> = {}): NoteRec => ({
  id, caseId: "c", type: "text", title: id, body: "", transcript: "", durationMs: 0, createdAt: 1, updatedAt: 1,
  location: null, attachmentIds: [], subjectIds: [], flagged: false, sample: false, ...p,
});
const ev = (id: string, p: Partial<EvidenceRec> = {}): EvidenceRec => ({
  id, caseId: "c", noteId: null, kind: "photo", blobId: "b", fileName: `${id}.jpg`, mimeType: "image/jpeg", size: 1, sha256: "",
  exif: {}, gps: null, capturedAt: 1, custody: [], sample: false, ...p,
});
const subj = (id: string, p: Partial<SubjectRec> = {}): SubjectRec => ({
  id, caseId: "c", name: id, aliases: [], photoBlobId: null, lastSeen: { place: "", detail: "", at: null }, coordinates: null,
  threatLevel: "undetermined", fields: [], redacted: [], sample: false, ...p,
});
const PINE = { lat: 39.7425, lng: -105.1786 };

describe("map items", () => {
  it("pins located notes and subject coordinates", () => {
    const items = buildItems([note("n1", { location: { ...PINE, accuracy: 12, source: "device" } }), note("n2")], [], [subj("s1", { coordinates: { lat: 47.6062, lng: -122.3321 } }), subj("s2")]);
    expect(items.map((i) => i.key)).toEqual(["note:n1", "subject:s1"]);
  });

  it("shows evidence GPS only when the parent note has no location", () => {
    const located = note("n1", { location: { ...PINE, accuracy: 8, source: "exif" } });
    const bare = note("n2");
    const items = buildItems([located, bare], [ev("e1", { noteId: "n1", gps: PINE }), ev("e2", { noteId: "n2", gps: PINE }), ev("e3", { gps: PINE }), ev("e4", { noteId: "gone", gps: PINE })], []);
    expect(items.map((i) => i.key)).toEqual(["note:n1", "evidence:e2", "evidence:e3", "evidence:e4"]);
  });

  it("ignores impossible coordinates", () => {
    const items = buildItems([note("n1", { location: { lat: 91, lng: 0, accuracy: null, source: "manual" } }), note("n2", { location: { lat: NaN, lng: 0, accuracy: null, source: "manual" } })], [], []);
    expect(items).toEqual([]);
  });
});

describe("initial camera", () => {
  it("opens on the world when nothing is located", () => {
    expect(initialCamera([])).toEqual({ kind: "world" });
  });
  it("centers one place at zoom 13", () => {
    const cam = initialCamera([PINE, { lat: 39.74251, lng: -105.17861 }]);
    expect(cam).toMatchObject({ kind: "point", zoom: SINGLE_ZOOM });
  });
  it("fits several places", () => {
    expect(initialCamera([PINE, { lat: 47.6062, lng: -122.3321 }])).toEqual({ kind: "bounds", bounds: { west: -122.3321, south: 39.7425, east: -105.1786, north: 47.6062 } });
  });
  it("keeps a narrow box across the antimeridian", () => {
    const b = boundsOf([{ lat: 0, lng: 179 }, { lat: 1, lng: -179 }])!;
    expect(b.east - b.west).toBeCloseTo(2);
  });
});

describe("grouping", () => {
  const items = buildItems(
    [note("photo", { location: { ...PINE, accuracy: 8, source: "exif" } }), note("ping", { location: { ...PINE, accuracy: 12, source: "device" } })],
    [],
    [subj("kaelin", { coordinates: { lat: 47.6062, lng: -122.3321 } })],
  );
  it("stacks records at one spot and keeps distant ones apart", () => {
    const clusters = clusterItems(items, 4);
    expect(clusters.map((c) => c.items.length).sort()).toEqual([1, 2]);
    expect(clusters.find((c) => c.items.length === 2)!.key).toBe("note:photo|note:ping");
  });
  it("merges everything at world zoom when pins would overlap", () => {
    const near: MapItem[] = buildItems([note("a", { location: { lat: 39.74, lng: -105.17, accuracy: null, source: "manual" } }), note("b", { location: { lat: 39.9, lng: -105.0, accuracy: null, source: "manual" } })], [], []);
    expect(clusterItems(near, 3)).toHaveLength(1);
    expect(clusterItems(near, 12)).toHaveLength(2);
  });
});

describe("coordinate entry", () => {
  it("reads signed decimals and hemispheres", () => {
    expect(parseCoordinate("47.6062", "lat")).toBe(47.6062);
    expect(parseCoordinate(" -122.3321 ", "lng")).toBe(-122.3321);
    expect(parseCoordinate("122.3321° W", "lng")).toBe(-122.3321);
    expect(parseCoordinate("39.7425 S", "lat")).toBe(-39.7425);
  });
  it("rejects out of range values and wrong hemispheres", () => {
    expect(parseCoordinate("95", "lat")).toBeNull();
    expect(parseCoordinate("181", "lng")).toBeNull();
    expect(parseCoordinate("47.6 E", "lat")).toBeNull();
    expect(parseCoordinate("abc", "lat")).toBeNull();
    expect(parseCoordinate("", "lat")).toBeNull();
  });
  it("splits a pasted pair, including the app's own format", () => {
    expect(parseCoordinatePair("47.6062, -122.3321")).toEqual({ lat: 47.6062, lng: -122.3321 });
    expect(parseCoordinatePair("39.7425° N, 105.1786° W")).toEqual(PINE);
    expect(parseCoordinatePair("47.6062")).toBeNull();
  });
});
