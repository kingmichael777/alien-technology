import type { EntityKind, EvidenceRec, LinkRec, NoteRec, SubjectRec } from "@/data/db";
import { noteHeadline } from "@/data/rules";

// ---------- Cards and strings ----------

export type CardKind = "photo" | "location" | "text" | "voice" | "subject";

export interface BoardCard {
  /** Board id: the id of the record the card stands for. Positions are saved under it. */
  id: string;
  kind: CardKind;
  /** The record that new strings attach to and that Open shows. */
  entity: { id: string; kind: EntityKind };
  /** Ordering inside its layout column. */
  order: number | string;
  note?: NoteRec;
  evidence?: EvidenceRec;
  subject?: SubjectRec;
}

/** One red string between two cards. Several links between the same two cards share one string. */
export interface BoardString {
  id: string;
  source: string;
  target: string;
  links: LinkRec[];
}

export interface BoardModel {
  cards: BoardCard[];
  strings: BoardString[];
  /** Record id (note, evidence or subject) to the id of the card that represents it. */
  cardOf: Map<string, string>;
  /** Records that are still encrypted and cannot be drawn. */
  sealedRecords: number;
}

export const KIND_LABEL: Record<CardKind, string> = {
  photo: "Photo evidence",
  location: "Location",
  text: "Text note",
  voice: "Voice note",
  subject: "Subject",
};

const plain = <T extends { enc?: unknown }>(rows: T[]) => rows.filter((r) => !r.enc);

/**
 * Maps a case's records onto board cards.
 * A photo is one card keyed by its evidence record; links to the photo note or to the photo
 * evidence both land on it. Audio has no card of its own: it maps onto its voice note.
 */
export function buildBoard(notes: NoteRec[], evidence: EvidenceRec[], subjects: SubjectRec[], links: LinkRec[]): BoardModel {
  const sealedRecords = notes.length + evidence.length + subjects.length - plain(notes).length - plain(evidence).length - plain(subjects).length;
  const ns = plain(notes);
  const evs = plain(evidence);
  const ss = plain(subjects);
  const ls = plain(links);
  const cards: BoardCard[] = [];
  const cardOf = new Map<string, string>();
  const noteById = new Map(ns.map((n) => [n.id, n]));

  const photos = evs.filter((e) => e.kind === "photo").sort((a, b) => a.capturedAt - b.capturedAt || a.id.localeCompare(b.id));
  for (const e of photos) {
    const n = e.noteId ? noteById.get(e.noteId) : undefined;
    cards.push({ id: e.id, kind: "photo", entity: { id: e.id, kind: "evidence" }, order: e.capturedAt, evidence: e, note: n });
    cardOf.set(e.id, e.id);
    if (n && n.type === "photo" && !cardOf.has(n.id)) cardOf.set(n.id, e.id);
  }
  for (const n of ns) {
    if (cardOf.has(n.id)) continue;
    cards.push({ id: n.id, kind: n.type, entity: { id: n.id, kind: "note" }, order: n.createdAt, note: n });
    cardOf.set(n.id, n.id);
  }
  for (const e of evs) {
    if (e.kind === "photo" || !e.noteId) continue;
    const card = cardOf.get(e.noteId);
    if (card) cardOf.set(e.id, card);
  }
  for (const s of ss) {
    cards.push({ id: s.id, kind: "subject", entity: { id: s.id, kind: "subject" }, order: s.name.toLowerCase(), subject: s });
    cardOf.set(s.id, s.id);
  }

  const byPair = new Map<string, BoardString>();
  for (const l of ls) {
    const a = cardOf.get(l.fromId);
    const b = cardOf.get(l.toId);
    if (!a || !b || a === b) continue;
    const id = a < b ? `${a}|${b}` : `${b}|${a}`;
    const s = byPair.get(id);
    if (s) s.links.push(l);
    else byPair.set(id, { id, source: a, target: b, links: [l] });
  }
  return { cards, strings: [...byPair.values()], cardOf, sealedRecords };
}

/** Human name of a card, for sheets and labels. */
export function cardTitle(k: BoardCard): string {
  if (k.subject) return k.subject.name;
  if (k.evidence) return k.evidence.fileName;
  if (k.note) return noteHeadline(k.note);
  return KIND_LABEL[k.kind];
}

/** Plain text excerpt of Markdown: no heading marks, emphasis, list bullets or code ticks. */
export function excerpt(md: string): string {
  return md
    .split("\n")
    .map((l) => l.replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, ""))
    .join(" ")
    .replace(/[*_`~]+/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- Geometry ----------

export interface XY {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const center = (r: Rect): XY => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Where the line from the center of `r` toward `to` crosses the edge of `r`.
 * Returns null when `to` lies inside `r`.
 */
export function exitPoint(r: Rect, to: XY): XY | null {
  const c = center(r);
  const dx = to.x - c.x;
  const dy = to.y - c.y;
  const sx = dx === 0 ? Infinity : r.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : r.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  if (!(s < 1)) return null;
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/** The visible part of a string: from the edge of card `a` to the edge of card `b` along the center line. */
export function stringEnds(a: Rect, b: Rect): [XY, XY] | null {
  const ca = center(a);
  const cb = center(b);
  const p = exitPoint(a, cb);
  const q = exitPoint(b, ca);
  if (!p || !q) return null;
  if (dist(ca, p) + dist(cb, q) >= dist(ca, cb)) return null;
  return [p, q];
}

export function distToSegment(p: XY, a: XY, b: XY): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len = vx * vx + vy * vy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

export const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** Whether segment p-q passes through rectangle r (Liang-Barsky clipping). */
export function segmentHitsRect(p: XY, q: XY, r: Rect): boolean {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, p.x - r.x],
    [dx, r.x + r.w - p.x],
    [-dy, p.y - r.y],
    [dy, r.y + r.h - p.y],
  ];
  for (const [pk, qk] of edges) {
    if (pk === 0) {
      if (qk < 0) return false;
      continue;
    }
    const t = qk / pk;
    if (pk < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

// ---------- Layout ----------

export const CARD_W = 200;
const COL_GAP = 40;
const ROW_GAP = 32;
/** A column longer than this continues in a new column beside it, so big cases stay roughly square. */
const MAX_COLUMN = 1240;
/** Vertical start of each group, so neighbouring cards sit offset like pinned cards, not a grid. */
const STAGGER = [0, 88, 40];
/** Start offsets tried for the middle and right groups when strings are known. */
const STAGGER_MIDDLE = [56, 128, 200];
const STAGGER_RIGHT = [0, 72, 144];
/** Above this size the layout keeps the plain order: the search would cost more than it saves. */
const SEARCH_LIMIT = 40;

/** Upper bounds of each card's rendered height; used before a card has been measured. */
export function estimateHeight(k: BoardCard): number {
  switch (k.kind) {
    case "photo":
      return 236;
    case "location":
      return 214;
    case "subject":
      return 140;
    case "voice":
      return k.note?.title.trim() ? 224 : 182;
    case "text":
      return k.note?.title.trim() && (k.note.body.trim() || k.note.transcript.trim()) ? 196 : 170;
  }
}

const GROUP: Record<CardKind, 0 | 1 | 2> = { photo: 0, subject: 0, text: 1, voice: 1, location: 2 };
const RANK: Record<CardKind, number> = { photo: 0, subject: 1, text: 0, voice: 0, location: 0 };

const byOrder = (a: BoardCard, b: BoardCard) =>
  RANK[a.kind] - RANK[b.kind] ||
  (typeof a.order === "number" && typeof b.order === "number" ? a.order - b.order : String(a.order).localeCompare(String(b.order))) ||
  a.id.localeCompare(b.id);

/** Stacks each group top to bottom, wrapping into a further column when a group grows too tall. */
function stack(groups: BoardCard[][], stagger: number[], heightOf: (k: BoardCard) => number): Map<string, XY> {
  const out = new Map<string, XY>();
  let x = 0;
  groups.forEach((g, gi) => {
    if (g.length === 0) return;
    const top = stagger[gi] ?? 0;
    let y = top;
    let sub = 0;
    for (const k of g) {
      const h = Math.ceil(heightOf(k));
      if (y > top && y + h > top + MAX_COLUMN) {
        sub += 1;
        x += CARD_W + COL_GAP;
        y = top + (sub % 2) * 56;
      }
      out.set(k.id, { x, y });
      y += h + ROW_GAP;
    }
    x += CARD_W + COL_GAP;
  });
  return out;
}

/**
 * Photos and subjects on the left, text and voice notes in the middle, locations on the right.
 * Cards are stacked with fixed gaps using an upper bound of their height, so they never overlap.
 * When the strings are given, the order inside each group and the stagger of the groups are chosen
 * so that strings run between cards rather than through them.
 */
export function autoLayout(cards: BoardCard[], heightOf: (k: BoardCard) => number = estimateHeight, links: [string, string][] = []): Map<string, XY> {
  const groups: BoardCard[][] = [[], [], []];
  for (const k of cards) groups[GROUP[k.kind]].push(k);
  for (const g of groups) g.sort(byOrder);
  const ids = new Set(cards.map((k) => k.id));
  const live = links.filter(([a, b]) => ids.has(a) && ids.has(b) && a !== b);
  if (live.length === 0 || cards.length > SEARCH_LIMIT) return stack(groups, STAGGER, heightOf);
  const order = searchOrder(groups, heightOf, live);
  return stack(order.groups, order.stagger, heightOf);
}

/**
 * Chooses group stagger and the order inside each group by local search. Cost: every string that passes
 * through another card, then total string length, then how far cards move from their plain order.
 */
function searchOrder(groups: BoardCard[][], heightOf: (k: BoardCard) => number, links: [string, string][]) {
  const all = groups.flat();
  const n = all.length;
  const index = new Map(all.map((k, i) => [k.id, i]));
  const H = Float64Array.from(all, (k) => Math.ceil(heightOf(k)));
  const L = links.map(([a, b]) => [index.get(a)!, index.get(b)!] as const);
  const linked = new Set(L.flat());
  const plain = new Int32Array(n);
  groups.forEach((g) => g.forEach((k, i) => (plain[index.get(k.id)!] = i)));
  const X = new Float64Array(n);
  const Y = new Float64Array(n);

  const place = (order: number[][], st: number[]) => {
    let x = 0;
    for (let gi = 0; gi < order.length; gi++) {
      const g = order[gi]!;
      if (g.length === 0) continue;
      const top = st[gi] ?? 0;
      let y = top;
      let sub = 0;
      for (const i of g) {
        if (y > top && y + H[i]! > top + MAX_COLUMN) {
          sub += 1;
          x += CARD_W + COL_GAP;
          y = top + (sub % 2) * 56;
        }
        X[i] = x;
        Y[i] = y;
        y += H[i]! + ROW_GAP;
      }
      x += CARD_W + COL_GAP;
    }
  };
  // Allocation-free geometry: this runs thousands of times per layout.
  const half = CARD_W / 2;
  /** Fraction of the way from the center of card i toward (dx, dy) at which the line leaves the card. */
  const exitScale = (i: number, dx: number, dy: number) => Math.min(dx === 0 ? Infinity : half / Math.abs(dx), dy === 0 ? Infinity : H[i]! / 2 / Math.abs(dy));
  const score = (order: number[][], st: number[]) => {
    place(order, st);
    let cost = 0;
    for (const [a, b] of L) {
      const ax = X[a]! + half;
      const ay = Y[a]! + H[a]! / 2;
      const dx = X[b]! + half - ax;
      const dy = Y[b]! + H[b]! / 2 - ay;
      const sa = exitScale(a, dx, dy);
      const sb = exitScale(b, dx, dy);
      if (!(sa + sb < 1)) {
        cost += 5000;
        continue;
      }
      const px = ax + dx * sa;
      const py = ay + dy * sa;
      const qx = ax + dx * (1 - sb);
      const qy = ay + dy * (1 - sb);
      const ex = qx - px;
      const ey = qy - py;
      const x0 = Math.min(px, qx) - 10;
      const x1 = Math.max(px, qx) + 10;
      const y0 = Math.min(py, qy) - 10;
      const y1 = Math.max(py, qy) + 10;
      for (let i = 0; i < n; i++) {
        if (i === a || i === b) continue;
        const rx0 = X[i]! - 10;
        const rx1 = X[i]! + CARD_W + 10;
        const ry0 = Y[i]! - 10;
        const ry1 = Y[i]! + H[i]! + 10;
        if (rx0 > x1 || rx1 < x0 || ry0 > y1 || ry1 < y0) continue;
        // Liang-Barsky clip of p-q against the padded card.
        let t0 = 0;
        let t1 = 1;
        let hit = true;
        for (let e = 0; e < 4 && hit; e++) {
          const pk = e === 0 ? -ex : e === 1 ? ex : e === 2 ? -ey : ey;
          const qk = e === 0 ? px - rx0 : e === 1 ? rx1 - px : e === 2 ? py - ry0 : ry1 - py;
          if (pk === 0) {
            if (qk < 0) hit = false;
          } else {
            const t = qk / pk;
            if (pk < 0) t0 = Math.max(t0, t);
            else t1 = Math.min(t1, t);
            if (t0 > t1) hit = false;
          }
        }
        if (hit) cost += 1000;
      }
      cost += Math.hypot(ex, ey);
    }
    for (const g of order) for (let pos = 0; pos < g.length; pos++) cost += 12 * Math.abs(pos - plain[g[pos]!]!);
    return cost;
  };

  const base = groups.map((g) => g.map((k) => index.get(k.id)!));
  // Rank every stagger with the plain order; climb from the two most promising. Each pass may change
  // the stagger as well as swap cards, so order and stagger improve together.
  const staggers = STAGGER_MIDDLE.flatMap((m) => STAGGER_RIGHT.map((r) => [0, m, r]));
  const ranked = staggers.map((st) => ({ st, cost: score(base, st) })).sort((a, b) => a.cost - b.cost);
  let best = { cost: Infinity, order: base, stagger: ranked[0]!.st };
  for (const start of ranked.slice(0, 2)) {
    const order = base.map((g) => [...g]);
    let st = start.st;
    let cost = start.cost;
    for (let pass = 0; pass < 5; pass++) {
      let improved = false;
      for (const s of staggers) {
        if (s === st) continue;
        const c = score(order, s);
        if (c < cost - 0.5) {
          cost = c;
          st = s;
          improved = true;
        }
      }
      for (const g of order) {
        for (let i = 0; i < g.length; i++) {
          for (let j = i + 1; j < g.length; j++) {
            if (!linked.has(g[i]!) && !linked.has(g[j]!)) continue;
            [g[i], g[j]] = [g[j]!, g[i]!];
            const c = score(order, st);
            if (c < cost - 0.5) {
              cost = c;
              improved = true;
            } else {
              [g[i], g[j]] = [g[j]!, g[i]!];
            }
          }
        }
      }
      if (!improved) break;
    }
    if (cost < best.cost - 0.5) best = { cost, order, stagger: st };
  }
  return { groups: best.order.map((g) => g.map((i) => all[i]!)), stagger: best.stagger };
}

/** The free spot nearest to `c` (a center point) for a card of size w by h. */
export function freeSpot(taken: Rect[], w: number, h: number, c: XY, gap = 24): XY {
  const x0 = Math.round(c.x - w / 2);
  const y0 = Math.round(c.y - h / 2);
  const fits = (x: number, y: number) => taken.every((r) => !overlaps({ x, y, w, h }, r, gap));
  if (fits(x0, y0)) return { x: x0, y: y0 };
  const step = 36;
  for (let ring = 1; ring <= 60; ring++) {
    const cand: XY[] = [];
    for (let i = -ring; i <= ring; i++) {
      cand.push({ x: i, y: -ring }, { x: i, y: ring });
      if (i > -ring && i < ring) cand.push({ x: -ring, y: i }, { x: ring, y: i });
    }
    cand.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
    for (const d of cand) {
      const x = x0 + d.x * step;
      const y = y0 + d.y * step;
      if (fits(x, y)) return { x, y };
    }
  }
  return { x: x0, y: y0 };
}
