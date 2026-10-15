import { memo } from "react";
import { useInternalNode, useStore, type Edge, type EdgeProps, type InternalNode } from "@xyflow/react";
import { exitPoint, stringEnds, type Rect, type XY } from "./model";

export type StringData = { active: boolean };
export type StringEdgeT = Edge<StringData, "string">;

/** A node's rectangle in flow coordinates, once it has been measured. */
export function rectOf(n: InternalNode | undefined): Rect | null {
  const w = n?.measured.width;
  const h = n?.measured.height;
  if (!n || !w || !h) return null;
  return { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w, h };
}

/** Strings, pins and hit areas keep the same size on screen at every zoom. */
const useScreenUnit = () => useStore((s) => 1 / s.transform[2]);

/** Pin at each end of a string; `r` is in screen pixels. */
const Pin = ({ at, r, unit }: { at: XY; r: number; unit: number }) => <circle cx={at.x} cy={at.y} r={r * unit} fill="var(--pin)" />;

/** A red string: straight, card edge to card edge, pinned at both ends, with a wide invisible hit area. */
export const StringEdge = memo(function StringEdge({ source, target, data }: EdgeProps<StringEdgeT>) {
  const unit = useScreenUnit();
  const a = rectOf(useInternalNode(source));
  const b = rectOf(useInternalNode(target));
  const ends = a && b ? stringEnds(a, b) : null;
  if (!ends) return null;
  const [p, q] = ends;
  const d = `M${p.x},${p.y}L${q.x},${q.y}`;
  const active = !!data?.active;
  return (
    <>
      <path d={d} fill="none" stroke="transparent" strokeWidth={22 * unit} style={{ pointerEvents: "stroke" }} />
      <path d={d} fill="none" strokeLinecap="round" style={{ stroke: active ? "var(--pin)" : "var(--string)", strokeWidth: (active ? 2 : 1.25) * unit }} />
      <Pin at={p} r={2.5} unit={unit} />
      <Pin at={q} r={2.5} unit={unit} />
    </>
  );
});

/** The string that follows the finger while a link is being made. Drawn in flow coordinates. */
export function LiveString({ from, to, over }: { from: string; to: XY; over: string | null }) {
  const unit = useScreenUnit();
  const a = rectOf(useInternalNode(from));
  const b = rectOf(useInternalNode(over ?? ""));
  if (!a) return null;
  let ends: [XY, XY] | null;
  if (b) ends = stringEnds(a, b);
  else {
    const p = exitPoint(a, to);
    ends = p ? [p, to] : null;
  }
  return (
    <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1} style={{ zIndex: 20 }} aria-hidden>
      {ends && (
        <>
          <line x1={ends[0].x} y1={ends[0].y} x2={ends[1].x} y2={ends[1].y} strokeLinecap="round" style={{ stroke: "var(--string)", strokeWidth: 1.5 * unit }} />
          <Pin at={ends[0]} r={2.5} unit={unit} />
          <Pin at={ends[1]} r={b ? 2.5 : 4} unit={unit} />
        </>
      )}
    </svg>
  );
}
