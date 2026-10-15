import "@xyflow/react/dist/base.css";
import "./board.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, ViewportPortal, useReactFlow, useStoreApi, type NodeChange, type Viewport } from "@xyflow/react";
import { useNavigate } from "@tanstack/react-router";
import { Minus, MoreHorizontal, Plus, X } from "lucide-react";
import { toast } from "sonner";
import type { BoardPosRec, CaseRec } from "@/data/db";
import { boardRepo } from "@/data/board";
import { useSetting } from "@/data/hooks";
import { linkRepo, settingsRepo } from "@/data/repo";
import { Hexagon, IconButton, SW } from "@/components/at/ui";
import { cn } from "@/lib/utils";
import { BoardActions, CardNode, type CardNodeT, type Cue } from "./CardNode";
import { LiveString, rectOf, StringEdge, type StringEdgeT } from "./StringEdge";
import { BoardMenuSheet, CardMenuSheet, HiddenSheet, NewLinkSheet, StringSheet } from "./BoardSheets";
import { autoLayout, CARD_W, cardTitle, distToSegment, estimateHeight, freeSpot, stringEnds, type BoardCard, type BoardModel, type Rect, type XY } from "./model";

const nodeTypes = { card: CardNode };
const edgeTypes = { string: StringEdge };

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;
/** The first view of a large board never opens smaller than this; the rest is a pan away. */
const OPEN_MIN_ZOOM = 0.55;
const LONG_PRESS_MS = 450;
/** Movement in screen pixels that turns a press into a drag or a pan. */
const SLOP = 8;
const ZOOM_STEP = 1.3;
/** Controls that keep their own click behaviour and never start a board gesture. */
const UI = "button, a, input, textarea, select, [data-board-ui]";
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const ANIM = { duration: 200, ease: easeOut, interpolate: "linear" as const };
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Last view of each case's board in this session, restored when the board opens again. */
const views = new Map<string, Viewport>();

type Press = { t: "press"; id: number; x0: number; y0: number; card: string | null; edge: string | null };
type Gesture =
  | { t: "idle" }
  | Press
  | { t: "pan"; id: number; lx: number; ly: number }
  | { t: "drag"; id: number; card: string; x0: number; y0: number; start: XY }
  | { t: "link"; id: number; from: string }
  | { t: "pinch"; d0: number; z0: number; anchor: XY };

type Size = { width: number; height: number };

function union(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y) };
}

export function BoardCanvas({ c, model, saved }: { c: CaseRec; model: BoardModel; saved: Map<string, BoardPosRec> }) {
  const editable = c.status === "active";
  const rf = useReactFlow<CardNodeT, StringEdgeT>();
  const store = useStoreApi<CardNodeT, StringEdgeT>();
  const navigate = useNavigate();
  const night = useSetting<string>("displayMode", "standard") === "night";

  const [restored] = useState(() => views.get(c.id) ?? null);
  const [viewReady, setViewReady] = useState(false);
  const viewReadyRef = useRef(false);
  const [full, setFull] = useState(false);
  /** Positions not (yet) matched by a saved row: unsaved layouts, read-only layouts and writes in flight. */
  const [memPos, setMemPos] = useState<Map<string, XY>>(() => new Map());
  const [dims, setDims] = useState<Map<string, Size>>(() => new Map());
  /** Cards moved in this session, most recent last: a dropped card stays on top of the cards it covers. */
  const [raised, setRaised] = useState<string[]>([]);
  const [drag, setDragState] = useState<{ id: string; x: number; y: number } | null>(null);
  const [link, setLinkState] = useState<{ from: string; to: XY; over: string | null } | null>(null);
  const dragRef = useRef(drag);
  const linkRef = useRef(link);
  const setDrag = (v: typeof drag) => {
    dragRef.current = v;
    setDragState(v);
  };
  const setLink = (v: typeof link) => {
    linkRef.current = v;
    setLinkState(v);
  };

  const [menu, setMenu] = useState(false);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [cardMenu, setCardMenu] = useState<string | null>(null);
  const [stringId, setStringId] = useState<string | null>(null);
  const [pendingLink, setPendingLink] = useState<{ from: string; to: string } | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const capsuleRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, XY>());
  const gesture = useRef<Gesture>({ t: "idle" });
  const timer = useRef<number | null>(null);

  const cardById = useMemo(() => new Map(model.cards.map((k) => [k.id, k])), [model.cards]);
  const stringPairs = useMemo(() => model.strings.map((s): [string, string] => [s.source, s.target]), [model.strings]);
  const posOf = (id: string): XY | null => (drag?.id === id ? drag : (memPos.get(id) ?? saved.get(id) ?? null));
  const sizeOf = (k: BoardCard) => ({ w: dims.get(k.id)?.width ?? CARD_W, h: dims.get(k.id)?.height ?? estimateHeight(k) });
  const nameOf = useCallback((id: string) => {
    const k = cardById.get(id);
    return k ? cardTitle(k) : "";
  }, [cardById]);

  // ---------- Positions ----------

  // A position in memory is dropped once the saved row matches it.
  useEffect(() => {
    if (!editable) return;
    setMemPos((prev) => {
      let next: Map<string, XY> | null = null;
      for (const [id, p] of prev) {
        const s = saved.get(id);
        if (s && s.x === p.x && s.y === p.y) (next ??= new Map(prev)).delete(id);
      }
      return next ?? prev;
    });
  }, [saved, editable]);

  // Active cases save every placement that has no row yet.
  useEffect(() => {
    if (!editable) return;
    const pending = [...memPos].filter(([id]) => !saved.has(id) && cardById.has(id)).map(([id, p]) => ({ id, x: p.x, y: p.y }));
    if (pending.length) boardRepo.placeNew(c.id, pending).catch(() => {});
  }, [editable, memPos, saved, cardById, c.id]);

  // Items without a position: the whole board is laid out on first open; later arrivals go near the center of the view.
  useEffect(() => {
    const unplaced = model.cards.filter((k) => !saved.has(k.id) && !memPos.has(k.id));
    if (unplaced.length === 0) return;
    const anyPlaced = model.cards.some((k) => saved.has(k.id) || memPos.has(k.id));
    if (!anyPlaced) {
      const layout = autoLayout(model.cards, estimateHeight, stringPairs);
      setMemPos((prev) => new Map([...prev, ...layout]));
      return;
    }
    if (!viewReady) return;
    const taken: Rect[] = [];
    for (const k of model.cards) {
      const p = memPos.get(k.id) ?? saved.get(k.id);
      if (p && !saved.get(k.id)?.hidden) taken.push({ x: p.x, y: p.y, ...sizeOf(k) });
    }
    const at = viewCenterFlow();
    const next = new Map(memPos);
    for (const k of unplaced) {
      const h = estimateHeight(k);
      const p = freeSpot(taken, CARD_W, h, at);
      next.set(k.id, p);
      taken.push({ ...p, w: CARD_W, h });
    }
    setMemPos(next);
    // sizeOf and viewCenterFlow read the latest render; the effect re-runs whenever placements change.
  }, [model.cards, saved, memPos, viewReady]);

  // ---------- Nodes and edges ----------

  const nodeCache = useRef(new Map<string, CardNodeT>());
  const nodes = useMemo(() => {
    const out: CardNodeT[] = [];
    const seen = new Set<string>();
    for (const k of model.cards) {
      if (saved.get(k.id)?.hidden) continue;
      const p = drag?.id === k.id ? drag : (memPos.get(k.id) ?? saved.get(k.id));
      if (!p) continue;
      seen.add(k.id);
      const cue: Cue = link?.from === k.id ? "source" : link?.over === k.id ? "target" : drag?.id === k.id ? "drag" : null;
      const m = dims.get(k.id);
      const prev = nodeCache.current.get(k.id);
      if (
        prev &&
        prev.position.x === p.x &&
        prev.position.y === p.y &&
        prev.data.card === k &&
        prev.data.cue === cue &&
        prev.measured?.width === m?.width &&
        prev.measured?.height === m?.height
      ) {
        out.push(prev);
        continue;
      }
      const n: CardNodeT = {
        id: k.id,
        type: "card",
        position: { x: p.x, y: p.y },
        data: { card: k, cue },
        zIndex: cue ? 10 : 0,
        measured: m,
        selectable: false,
        draggable: false,
        connectable: false,
        focusable: false,
      };
      nodeCache.current.set(k.id, n);
      out.push(n);
    }
    for (const id of [...nodeCache.current.keys()]) if (!seen.has(id)) nodeCache.current.delete(id);
    if (raised.length) {
      const rank = new Map(raised.map((id, i) => [id, i]));
      out.sort((a, b) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1));
    }
    return out;
  }, [model.cards, saved, memPos, drag, link?.from, link?.over, dims, raised]);

  const shown = nodes.map((n) => n.id).join(",");
  const edgeCache = useRef(new Map<string, StringEdgeT>());
  const edges = useMemo(() => {
    const on = new Set(shown.split(","));
    const out: StringEdgeT[] = [];
    for (const s of model.strings) {
      if (!on.has(s.source) || !on.has(s.target)) continue;
      const active = stringId === s.id;
      const labels = s.links.map((l) => l.label).filter(Boolean).join(", ");
      const label = labels ? `Connection: ${labels}` : "Connection";
      const prev = edgeCache.current.get(s.id);
      if (prev && prev.source === s.source && prev.target === s.target && prev.data?.active === active && prev.ariaLabel === label) {
        out.push(prev);
        continue;
      }
      const e: StringEdgeT = {
        id: s.id,
        source: s.source,
        target: s.target,
        type: "string",
        zIndex: 1,
        data: { active },
        selectable: false,
        focusable: false,
        ariaLabel: label,
      };
      edgeCache.current.set(s.id, e);
      out.push(e);
    }
    const live = new Set(out.map((e) => e.id));
    for (const id of [...edgeCache.current.keys()]) if (!live.has(id)) edgeCache.current.delete(id);
    return out;
  }, [model.strings, shown, stringId]);

  const onNodesChange = useCallback((changes: NodeChange<CardNodeT>[]) => {
    setDims((prev) => {
      let next: Map<string, Size> | null = null;
      for (const ch of changes) {
        if (ch.type !== "dimensions" || !ch.dimensions) continue;
        const cur = prev.get(ch.id);
        if (cur && cur.width === ch.dimensions.width && cur.height === ch.dimensions.height) continue;
        (next ??= new Map(prev)).set(ch.id, { width: ch.dimensions.width, height: ch.dimensions.height });
      }
      return next ?? prev;
    });
  }, []);

  // ---------- Viewport ----------

  /** The canvas box and the strips covered by floating controls. */
  const frame = () => {
    const r = wrapRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 390, 600);
    const cap = capsuleRef.current?.getBoundingClientRect();
    const bottom = cap && cap.height ? Math.max(24, r.bottom - cap.top + 14) : 24;
    return { rect: r, w: r.width, h: r.height, top: 20, bottom, side: 16 };
  };
  /** Center of the uncovered part of the canvas, in canvas pixels. */
  const visibleCenter = (): XY => {
    const f = frame();
    return { x: f.w / 2, y: f.top + (f.h - f.top - f.bottom) / 2 };
  };
  const viewCenterFlow = (): XY => {
    const v = rf.getViewport();
    const p = visibleCenter();
    return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
  };
  const nodeRects = (): Rect[] => {
    const out: Rect[] = [];
    for (const n of store.getState().nodeLookup.values()) {
      const r = rectOf(n);
      if (r) out.push(r);
    }
    return out;
  };

  /** Fits rectangles in the uncovered area. On first open a large board shows its top left instead of shrinking past OPEN_MIN_ZOOM. */
  const fitTo = (rects: Rect[], opts: { opening?: boolean; animate?: boolean } = {}) => {
    if (rects.length === 0) return;
    const b = union(rects);
    const f = frame();
    const aw = Math.max(40, f.w - f.side * 2);
    const ah = Math.max(40, f.h - f.top - f.bottom);
    const fitW = aw / b.w;
    const fitH = ah / b.h;
    // Opening: the width always fits; the height only down to OPEN_MIN_ZOOM, below that the top shows.
    const z = Math.max(MIN_ZOOM, Math.min(1, fitW, opts.opening ? Math.max(fitH, OPEN_MIN_ZOOM) : fitH));
    let x = f.side + (aw - b.w * z) / 2 - b.x * z;
    let y = f.top + (ah - b.h * z) / 2 - b.y * z;
    if (opts.opening && b.w * z > aw) x = f.side - b.x * z;
    if (opts.opening && b.h * z > ah) y = f.top - b.y * z;
    void rf.setViewport({ x, y, zoom: z }, opts.animate ? ANIM : undefined);
  };

  const zoomBy = (factor: number) => {
    const v = rf.getViewport();
    const z = clampZoom(v.zoom * factor);
    if (Math.abs(z - v.zoom) < 0.001) return;
    const p = visibleCenter();
    const fx = (p.x - v.x) / v.zoom;
    const fy = (p.y - v.y) / v.zoom;
    void rf.setViewport({ x: p.x - fx * z, y: p.y - fy * z, zoom: z }, ANIM);
  };

  const centerOn = (r: Rect) => {
    const v = rf.getViewport();
    const p = visibleCenter();
    void rf.setViewport({ x: p.x - (r.x + r.w / 2) * v.zoom, y: p.y - (r.y + r.h / 2) * v.zoom, zoom: v.zoom }, ANIM);
  };

  const allMeasured = nodes.length > 0 && nodes.every((n) => dims.has(n.id));
  // The first view: the remembered one, else a fit once every card has been measured.
  useEffect(() => {
    if (viewReady) return;
    const ready = () => {
      viewReadyRef.current = true;
      setViewReady(true);
    };
    if (restored) return ready();
    if (nodes.length === 0) {
      const firstLayoutPending = !model.cards.some((k) => saved.has(k.id) || memPos.has(k.id));
      if (!firstLayoutPending) ready();
      return;
    }
    if (!allMeasured) return;
    fitTo(nodeRects(), { opening: true });
    ready();
  }, [viewReady, restored, nodes.length, allMeasured, model.cards, saved, memPos]);

  useEffect(
    () => () => {
      if (viewReadyRef.current) views.set(c.id, rf.getViewport());
    },
    [c.id, rf],
  );

  // Entering or leaving full canvas keeps the board's horizontal place on screen (the column widens on large
  // screens) and its distance from the top of the canvas, so cards sit right under whichever header shows.
  const keepOrigin = useRef<XY | null>(null);
  const showFull = (v: boolean) => {
    const r = wrapRef.current?.getBoundingClientRect();
    keepOrigin.current = r ? { x: r.left, y: r.top } : null;
    setFull(v);
  };
  useLayoutEffect(() => {
    const o = keepOrigin.current;
    const r = wrapRef.current?.getBoundingClientRect();
    keepOrigin.current = null;
    if (!o || !r) return;
    const v = rf.getViewport();
    void rf.setViewport({ x: v.x + o.x - r.left, y: v.y, zoom: v.zoom });
  }, [full]);

  useEffect(() => {
    if (!full) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector('[role="dialog"]')) showFull(false);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [full]);

  // ---------- Gestures ----------

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const capture = (id: number) => {
    try {
      wrapRef.current?.setPointerCapture(id);
    } catch {
      // The pointer is already gone.
    }
  };
  const flowAt = (x: number, y: number) => rf.screenToFlowPosition({ x, y });
  const grabbing = (on: boolean) => wrapRef.current?.classList.toggle("board-grabbing", on);

  /** Topmost card under a point in flow coordinates. */
  const cardAt = (p: XY, exclude?: string): string | null => {
    let hit: string | null = null;
    for (const n of store.getState().nodeLookup.values()) {
      if (n.id === exclude) continue;
      const r = rectOf(n);
      if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) hit = n.id;
    }
    return hit;
  };

  const startLink = (card: string, pid: number) => {
    timer.current = null;
    const g = gesture.current;
    if (g.t !== "press" || g.id !== pid || g.card !== card) return;
    gesture.current = { t: "link", id: pid, from: card };
    const p = pointers.current.get(pid);
    setLink({ from: card, to: p ? flowAt(p.x, p.y) : viewCenterFlow(), over: null });
    navigator.vibrate?.(8);
  };

  const beginPinch = () => {
    clearTimer();
    const g = gesture.current;
    if (g.t === "drag") setDrag(null);
    if (g.t === "link") setLink(null);
    grabbing(false);
    const [a, b] = [...pointers.current.values()];
    const el = wrapRef.current;
    if (!a || !b || !el) return;
    const r = el.getBoundingClientRect();
    const v = rf.getViewport();
    const mx = (a.x + b.x) / 2 - r.left;
    const my = (a.y + b.y) / 2 - r.top;
    gesture.current = { t: "pinch", d0: Math.max(24, Math.hypot(a.x - b.x, a.y - b.y)), z0: v.zoom, anchor: { x: (mx - v.x) / v.zoom, y: (my - v.y) / v.zoom } };
  };

  const movePinch = () => {
    const g = gesture.current;
    const [a, b] = [...pointers.current.values()];
    const el = wrapRef.current;
    if (g.t !== "pinch" || !a || !b || !el) return;
    const r = el.getBoundingClientRect();
    const z = clampZoom((g.z0 * Math.hypot(a.x - b.x, a.y - b.y)) / g.d0);
    const mx = (a.x + b.x) / 2 - r.left;
    const my = (a.y + b.y) / 2 - r.top;
    void rf.setViewport({ x: mx - g.anchor.x * z, y: my - g.anchor.y * z, zoom: z });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const target = e.target as Element;
    const onControl = !!target.closest(UI);
    if (e.isPrimary) {
      // A new gesture: forget pointers whose release never arrived.
      pointers.current.clear();
      clearTimer();
      if (gesture.current.t === "drag") setDrag(null);
      if (gesture.current.t === "link") setLink(null);
      gesture.current = { t: "idle" };
    }
    if (pointers.current.size >= 2) return;
    if (e.pointerType === "mouse" && !onControl) e.preventDefault();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      // Two fingers always pinch, even when one of them landed on a control.
      for (const id of pointers.current.keys()) capture(id);
      return beginPinch();
    }
    // A control keeps its own click; it only takes part in a pinch.
    if (onControl) return;
    capture(e.pointerId);
    const edge = target.closest(".react-flow__edge")?.getAttribute("data-id") ?? null;
    const card = target.closest(".react-flow__node")?.getAttribute("data-id") ?? (edge ? cardAt(flowAt(e.clientX, e.clientY)) : null);
    gesture.current = { t: "press", id: e.pointerId, x0: e.clientX, y0: e.clientY, card, edge };
    if (card && editable) {
      const pid = e.pointerId;
      timer.current = window.setTimeout(() => startLink(card, pid), LONG_PRESS_MS);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const pt = pointers.current.get(e.pointerId);
    if (!pt) return;
    pt.x = e.clientX;
    pt.y = e.clientY;
    let g = gesture.current;
    if (g.t === "pinch") return movePinch();
    if (g.t === "idle" || g.id !== e.pointerId) return;
    if (g.t === "press") {
      if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) <= SLOP) return;
      clearTimer();
      const start = g.card && editable ? posOf(g.card) : null;
      if (g.card && start) {
        gesture.current = { t: "drag", id: g.id, card: g.card, x0: g.x0, y0: g.y0, start: { x: start.x, y: start.y } };
        grabbing(true);
      } else {
        // Read-only cards and empty space move the board.
        gesture.current = { t: "pan", id: g.id, lx: g.x0, ly: g.y0 };
      }
      g = gesture.current;
    }
    if (g.t === "pan") {
      const v = rf.getViewport();
      void rf.setViewport({ x: v.x + e.clientX - g.lx, y: v.y + e.clientY - g.ly, zoom: v.zoom });
      g.lx = e.clientX;
      g.ly = e.clientY;
    } else if (g.t === "drag") {
      const z = rf.getViewport().zoom;
      setDrag({ id: g.card, x: g.start.x + (e.clientX - g.x0) / z, y: g.start.y + (e.clientY - g.y0) / z });
    } else if (g.t === "link") {
      const p = flowAt(e.clientX, e.clientY);
      setLink({ from: g.from, to: p, over: cardAt(p, g.from) });
    }
  };

  const tap = (g: Press, x: number, y: number) => {
    if (g.edge) {
      let onString = !g.card;
      const s = model.strings.find((t) => t.id === g.edge);
      if (!onString && s) {
        const { nodeLookup } = store.getState();
        const a = rectOf(nodeLookup.get(s.source));
        const b = rectOf(nodeLookup.get(s.target));
        const ends = a && b ? stringEnds(a, b) : null;
        // Over a card, only a tap right on the string counts as a tap on the string.
        if (ends) onString = distToSegment(flowAt(x, y), ends[0], ends[1]) <= 9 / rf.getViewport().zoom;
      }
      if (onString) return setStringId(g.edge);
    }
    if (g.card) openCard(g.card);
  };

  const commitDrag = () => {
    const d = dragRef.current;
    setDrag(null);
    if (!d) return;
    const x = Math.round(d.x);
    const y = Math.round(d.y);
    const before = memPos.get(d.id) ?? saved.get(d.id);
    if (before && before.x === x && before.y === y) return;
    setMemPos((prev) => new Map(prev).set(d.id, { x, y }));
    setRaised((r) => [...r.filter((id) => id !== d.id), d.id]);
    if (editable) boardRepo.move(c.id, d.id, x, y).catch((err: Error) => toast.error(err.message));
  };

  const connected = (a: string, b: string) => model.strings.some((s) => (s.source === a && s.target === b) || (s.source === b && s.target === a));

  const finishLink = () => {
    const l = linkRef.current;
    setLink(null);
    if (!l?.over) return;
    if (connected(l.from, l.over)) {
      toast("These items are already connected.");
      return;
    }
    setPendingLink({ from: l.from, to: l.over });
  };

  const endPointer = (e: React.PointerEvent, cancelled: boolean) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (g.t === "pinch") {
      const rest = [...pointers.current.entries()][0];
      gesture.current = rest ? { t: "pan", id: rest[0], lx: rest[1].x, ly: rest[1].y } : { t: "idle" };
      return;
    }
    if (g.t === "idle" || g.id !== e.pointerId) return;
    gesture.current = { t: "idle" };
    clearTimer();
    grabbing(false);
    if (g.t === "press" && !cancelled) tap(g, e.clientX, e.clientY);
    else if (g.t === "drag") {
      if (cancelled) setDrag(null);
      else commitDrag();
    } else if (g.t === "link") {
      if (cancelled) setLink(null);
      else finishLink();
    }
  };

  // Canvas touches are fully handled above: no synthetic click may follow them onto a sheet that just opened.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const end = (ev: TouchEvent) => {
      const t = ev.target as Element | null;
      if (ev.cancelable && !t?.closest?.(UI)) ev.preventDefault();
    };
    const gestureStart = (ev: Event) => ev.preventDefault();
    el.addEventListener("touchend", end, { passive: false });
    el.addEventListener("gesturestart", gestureStart);
    return () => {
      el.removeEventListener("touchend", end);
      el.removeEventListener("gesturestart", gestureStart);
    };
  }, []);

  useEffect(() => () => clearTimer(), []);

  // ---------- Actions ----------

  const openCard = (id: string) => {
    const e = cardById.get(id)?.entity;
    if (!e) return;
    if (e.kind === "subject") navigate({ to: "/case/$id/subject/$sid", params: { id: c.id, sid: e.id } });
    else if (e.kind === "note") navigate({ to: "/case/$id/note/$nid", params: { id: c.id, nid: e.id } });
    else navigate({ to: "/evidence/$eid", params: { eid: e.id } });
  };

  const hideCard = async (id: string) => {
    setCardMenu(null);
    const p = posOf(id);
    try {
      await boardRepo.setHidden(c.id, id, true, p ?? undefined);
    } catch (err) {
      toast.error((err as Error).message);
      return;
    }
    toast("Removed from the board.", {
      action: { label: "Undo", onClick: () => void boardRepo.setHidden(c.id, id, false).catch(() => {}) },
    });
  };

  const restoreCard = async (id: string) => {
    setHiddenOpen(false);
    try {
      await boardRepo.setHidden(c.id, id, false);
    } catch (err) {
      toast.error((err as Error).message);
      return;
    }
    const k = cardById.get(id);
    const p = posOf(id);
    if (k && p) centerOn({ x: p.x, y: p.y, ...sizeOf(k) });
  };

  const arrange = async () => {
    setMenu(false);
    const visible = model.cards.filter((k) => !saved.get(k.id)?.hidden);
    const layout = autoLayout(visible, (k) => dims.get(k.id)?.height ?? estimateHeight(k), stringPairs);
    setMemPos((prev) => new Map([...prev, ...layout]));
    fitTo(
      visible.map((k) => ({ ...layout.get(k.id)!, ...sizeOf(k) })),
      { animate: true },
    );
    try {
      await boardRepo.arrange(c.id, [...layout].map(([id, p]) => ({ id, x: p.x, y: p.y })));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const saveLink = async (label: string) => {
    const p = pendingLink;
    const a = p && cardById.get(p.from);
    const b = p && cardById.get(p.to);
    if (!a || !b) return setPendingLink(null);
    try {
      await linkRepo.create(c.id, a.entity, b.entity, label);
      setPendingLink(null);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const actions = useMemo(() => ({ openMenu: (id: string) => setCardMenu(id) }), []);
  const hiddenCards = model.cards.filter((k) => saved.get(k.id)?.hidden);
  const openString = model.strings.find((s) => s.id === stringId) ?? null;

  return (
    <BoardActions.Provider value={actions}>
      <div className={full ? "anim-fade fixed inset-0 z-[45] flex touch-none flex-col bg-bg" : "absolute inset-0 flex flex-col"}>
        {full ? <FullHeader onClose={() => showFull(false)} /> : <TopRow onMenu={() => setMenu(true)} />}
        <div
          ref={wrapRef}
          className={cn("board-flow relative min-h-0 flex-1", editable && "board-editable")}
          style={{ opacity: viewReady ? 1 : 0, transition: "opacity 180ms ease-out" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => endPointer(e, false)}
          onPointerCancel={(e) => endPointer(e, true)}
          onContextMenu={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
        >
          <ReactFlow<CardNodeT, StringEdgeT>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            defaultViewport={restored ?? { x: 0, y: 0, zoom: 1 }}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            panOnDrag={false}
            zoomOnPinch
            panOnScroll
            zoomOnScroll={false}
            zoomOnDoubleClick={false}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
            deleteKeyCode={null}
            disableKeyboardA11y
            attributionPosition="top-right"
            colorMode="dark"
          >
            {link && (
              <ViewportPortal>
                <LiveString from={link.from} to={link.to} over={link.over} />
              </ViewportPortal>
            )}
          </ReactFlow>
          {viewReady && nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-24">
              <div className="pointer-events-auto max-w-[30ch] text-center" data-board-ui>
                <p className="font-serif text-xl text-ink">No cards on the board.</p>
                <p className="mt-2 text-sm text-ink-muted">Items taken off the board are listed under Add to board.</p>
                {editable && hiddenCards.length > 0 && (
                  <button type="button" className="btn btn-outline mt-5" onClick={() => setHiddenOpen(true)}>
                    Add to board
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <ZoomCapsule ref={capsuleRef} full={full} onOut={() => zoomBy(1 / ZOOM_STEP)} onIn={() => zoomBy(ZOOM_STEP)} onFit={() => fitTo(nodeRects(), { animate: true })} />
      </div>

      <BoardMenuSheet
        open={menu}
        onClose={() => setMenu(false)}
        editable={editable}
        hiddenCount={hiddenCards.length}
        night={night}
        full={full}
        onAdd={() => {
          setMenu(false);
          setHiddenOpen(true);
        }}
        onArrange={() => void arrange()}
        onNight={() => void settingsRepo.set("displayMode", night ? "standard" : "night")}
        onFull={() => {
          setMenu(false);
          showFull(!full);
        }}
      />
      <HiddenSheet open={hiddenOpen} onClose={() => setHiddenOpen(false)} cards={hiddenCards} onRestore={(id) => void restoreCard(id)} />
      <CardMenuSheet
        card={cardMenu ? (cardById.get(cardMenu) ?? null) : null}
        onClose={() => setCardMenu(null)}
        editable={editable}
        onOpen={() => {
          const id = cardMenu;
          setCardMenu(null);
          if (id) openCard(id);
        }}
        onHide={() => cardMenu && void hideCard(cardMenu)}
      />
      <StringSheet string={openString} nameOf={nameOf} editable={editable} onClose={() => setStringId(null)} />
      <NewLinkSheet pending={pendingLink} nameOf={nameOf} onClose={() => setPendingLink(null)} onSave={saveLink} />
    </BoardActions.Provider>
  );
}

function TopRow({ onMenu }: { onMenu: () => void }) {
  return (
    <div className="flex h-11 shrink-0 touch-none items-center justify-between pr-1 pl-5" data-board-ui>
      <span className="font-mono text-[10px] tracking-[0.3em] text-ink-muted uppercase">Mobile evidence board</span>
      <IconButton label="Board options" onClick={onMenu}>
        <MoreHorizontal size={22} strokeWidth={SW} />
      </IconButton>
    </div>
  );
}

function FullHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="pt-safe shrink-0" data-board-ui>
      <div className="grid grid-cols-[52px_1fr_52px] items-center px-2 pb-3">
        <span className="flex size-11 items-center justify-center justify-self-center">
          <Hexagon className="size-8" />
        </span>
        <div className="min-w-0 text-center">
          <div className="truncate font-sans text-[26px] leading-tight font-medium tracking-[-0.01em]">
            <span className="text-ink">Alien</span> <span className="text-ink-muted">Technology</span>
          </div>
          <div className="mt-1 pl-[0.32em] font-mono text-[10px] tracking-[0.32em] text-ink-muted uppercase">Mobile evidence board</div>
        </div>
        <IconButton label="Close full canvas" className="justify-self-center" onClick={onClose}>
          <X size={22} strokeWidth={SW} />
        </IconButton>
      </div>
    </div>
  );
}

function ZoomCapsule({ ref, full, onIn, onOut, onFit }: { ref: React.Ref<HTMLDivElement>; full: boolean; onIn: () => void; onOut: () => void; onFit: () => void }) {
  return (
    <div
      ref={ref}
      data-board-ui
      className="absolute left-1/2 z-10 flex h-11 -translate-x-1/2 touch-none items-center rounded-full border border-line-strong bg-surface/92 px-1 backdrop-blur-xl"
      style={{ bottom: full ? "max(env(safe-area-inset-bottom), 16px)" : "calc(60px + max(env(safe-area-inset-bottom), 14px) + 12px)" }}
    >
      <button type="button" aria-label="Zoom out" className="tap inline-flex items-center justify-center rounded-full text-ink-muted transition-colors active:text-amber" onClick={onOut}>
        <Minus size={18} strokeWidth={SW} />
      </button>
      <button type="button" aria-label="Fit all cards" className="h-11 pl-0.5 font-mono text-[10px] tracking-[0.18em] whitespace-nowrap text-ink-muted uppercase transition-colors active:text-amber" onClick={onFit}>
        Pinch to zoom
      </button>
      <button type="button" aria-label="Zoom in" className="tap inline-flex items-center justify-center rounded-full text-ink-muted transition-colors active:text-amber" onClick={onIn}>
        <Plus size={18} strokeWidth={SW} />
      </button>
    </div>
  );
}
