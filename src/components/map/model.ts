// Pure data for the case map: which records get a pin, how pins group, where the camera opens.
// No MapLibre imports here, so this stays in the case route chunk and is unit tested.
import type { EvidenceRec, GeoPoint, NoteRec, SubjectRec } from "@/data/db";
import { noteHeadline } from "@/data/rules";

export interface LatLng {
  lat: number;
  lng: number;
}

interface ItemBase extends LatLng {
  /** "<kind>:<id>", stable across renders */
  key: string;
  id: string;
  title: string;
  /** Capture time for notes and evidence, last seen time for subjects */
  time: number | null;
}
export interface NoteItem extends ItemBase {
  kind: "note";
  accuracy: number | null;
  source: GeoPoint["source"];
  note: NoteRec;
}
export interface EvidenceItem extends ItemBase {
  kind: "evidence";
  evidence: EvidenceRec;
}
export interface SubjectItem extends ItemBase {
  kind: "subject";
  subject: SubjectRec;
}
export type MapItem = NoteItem | EvidenceItem | SubjectItem;

export function isLatLng<T extends LatLng>(p: T | null | undefined): p is T {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

/**
 * Every record in a case that has a position.
 * Evidence is pinned only when its parent note has no location, so one capture never shows twice.
 */
export function buildItems(notes: NoteRec[], evidence: EvidenceRec[], subjects: SubjectRec[]): MapItem[] {
  const items: MapItem[] = [];
  const located = new Set<string>();
  for (const n of notes) {
    if (!isLatLng(n.location)) continue;
    located.add(n.id);
    items.push({
      kind: "note", key: `note:${n.id}`, id: n.id, lat: n.location.lat, lng: n.location.lng,
      title: noteHeadline(n), time: n.createdAt, accuracy: n.location.accuracy, source: n.location.source, note: n,
    });
  }
  for (const e of evidence) {
    if (!isLatLng(e.gps)) continue;
    if (e.noteId && located.has(e.noteId)) continue;
    items.push({ kind: "evidence", key: `evidence:${e.id}`, id: e.id, lat: e.gps.lat, lng: e.gps.lng, title: e.fileName, time: e.capturedAt, evidence: e });
  }
  for (const s of subjects) {
    if (!isLatLng(s.coordinates)) continue;
    items.push({ kind: "subject", key: `subject:${s.id}`, id: s.id, lat: s.coordinates.lat, lng: s.coordinates.lng, title: s.name, time: s.lastSeen.at, subject: s });
  }
  return items;
}

const NOTE_LABEL: Record<NoteRec["type"], string> = { text: "Text note", voice: "Voice note", photo: "Photo note", location: "Location ping" };
const EVIDENCE_LABEL: Record<EvidenceRec["kind"], string> = { photo: "Photo evidence", audio: "Audio evidence", file: "File evidence" };

export function kindLabel(it: MapItem): string {
  if (it.kind === "note") return NOTE_LABEL[it.note.type];
  if (it.kind === "evidence") return EVIDENCE_LABEL[it.evidence.kind];
  return "Subject";
}

/** Subjects first, then captures newest first. */
export function sheetOrder(items: MapItem[]): MapItem[] {
  return [...items].sort((a, b) => {
    const ka = a.kind === "subject" ? 0 : 1;
    const kb = b.kind === "subject" ? 0 : 1;
    if (ka !== kb) return ka - kb;
    return (b.time ?? 0) - (a.time ?? 0);
  });
}

// ---------- Geometry ----------

const EARTH_M = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function metersBetween(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** West may exceed east by crossing 180°; then east is expressed above 180 so the box stays narrow. */
export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function boundsOf(points: LatLng[]): Bounds | null {
  if (points.length === 0) return null;
  let south = 90, north = -90, west = 180, east = -180, west2 = 360, east2 = 0;
  for (const p of points) {
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lng);
    east = Math.max(east, p.lng);
    const shifted = p.lng < 0 ? p.lng + 360 : p.lng;
    west2 = Math.min(west2, shifted);
    east2 = Math.max(east2, shifted);
  }
  // Points on both sides of the antimeridian: keep the narrower box.
  if (west < 0 && east >= 0 && east2 - west2 < east - west - 1e-9) return { west: west2, south, east: east2, north };
  return { west, south, east, north };
}

const wrapLng = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;

export function centerOf(b: Bounds): LatLng {
  return { lat: (b.south + b.north) / 2, lng: wrapLng((b.west + b.east) / 2) };
}

/** Diagonal of a box in meters. */
export function spanMeters(b: Bounds): number {
  return metersBetween({ lat: b.south, lng: b.west }, { lat: b.north, lng: b.east });
}

/** Records closer together than this are treated as one place. */
export const SAME_PLACE_M = 30;
/** Zoom for a case whose records sit at one place. */
export const SINGLE_ZOOM = 13;

export type Camera =
  | { kind: "world" }
  | { kind: "point"; center: LatLng; zoom: number }
  | { kind: "bounds"; bounds: Bounds };

/** Where the map opens: every pin in view, or one place at street-district zoom. */
export function initialCamera(points: LatLng[]): Camera {
  const b = boundsOf(points);
  if (!b) return { kind: "world" };
  if (spanMeters(b) < SAME_PLACE_M) return { kind: "point", center: centerOf(b), zoom: SINGLE_ZOOM };
  return { kind: "bounds", bounds: b };
}

// ---------- Grouping pins that would overlap on screen ----------

const TILE = 512;

/** Web Mercator world pixel at a zoom (512 px tiles, as MapLibre draws them). */
export function worldPoint(p: LatLng, zoom: number): [number, number] {
  const scale = TILE * 2 ** zoom;
  const lat = Math.max(-85.051129, Math.min(85.051129, p.lat));
  const s = Math.sin(rad(lat));
  return [((p.lng + 180) / 360) * scale, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale];
}

export interface Cluster extends LatLng {
  /** Member keys, sorted and joined */
  key: string;
  items: MapItem[];
}

/** Pins closer than this on screen merge into one pin with a count. */
export const CLUSTER_PX = 30;

/** Greedy grouping on a grid; deterministic for the same items and zoom. */
export function clusterItems(items: MapItem[], zoom: number, radiusPx = CLUSTER_PX): Cluster[] {
  const sorted = [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const pts = sorted.map((it) => {
    const [x, y] = worldPoint(it, zoom);
    return { it, x, y };
  });
  const cellOf = (v: number) => Math.floor(v / radiusPx);
  const grid = new Map<string, number[]>();
  pts.forEach((p, i) => {
    const k = `${cellOf(p.x)}:${cellOf(p.y)}`;
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  const taken = new Uint8Array(pts.length);
  const r2 = radiusPx * radiusPx;
  const out: Cluster[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (taken[i]) continue;
    taken[i] = 1;
    const seed = pts[i]!;
    const members = [seed.it];
    const cx = cellOf(seed.x);
    const cy = cellOf(seed.y);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const j of grid.get(`${gx}:${gy}`) ?? []) {
          if (taken[j]) continue;
          const p = pts[j]!;
          const dx = p.x - seed.x;
          const dy = p.y - seed.y;
          if (dx * dx + dy * dy <= r2) {
            taken[j] = 1;
            members.push(p.it);
          }
        }
      }
    }
    const center = members.length === 1 ? members[0]! : centerOf(boundsOf(members)!);
    out.push({ key: members.map((m) => m.key).sort().join("|"), items: members, lat: center.lat, lng: center.lng });
  }
  return out;
}

// ---------- Coordinate entry ----------

/** "47.6062", "-122.3321", "122.3321° W", "47.6062 N". Null when not a valid value for the axis. */
export function parseCoordinate(raw: string, axis: "lat" | "lng"): number | null {
  const m = raw.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*°?\s*([NSEW])?$/i);
  if (!m) return null;
  let v = parseFloat(m[1]!);
  const h = m[2]?.toUpperCase();
  if (h) {
    if ((axis === "lat") !== (h === "N" || h === "S")) return null;
    if (v < 0) return null;
    if (h === "S" || h === "W") v = -v;
  }
  const max = axis === "lat" ? 90 : 180;
  return Number.isFinite(v) && Math.abs(v) <= max ? v : null;
}

/** "47.6062, -122.3321" or "47.6062° N, 122.3321° W". */
export function parseCoordinatePair(raw: string): LatLng | null {
  const parts = raw.split(",");
  if (parts.length !== 2) return null;
  const lat = parseCoordinate(parts[0]!, "lat");
  const lng = parseCoordinate(parts[1]!, "lng");
  return lat === null || lng === null ? null : { lat, lng };
}
