// DOM for the HTML markers MapLibre positions. Colors come from map.css, which reads the theme tokens.
import { kindLabel, type Cluster } from "./model";

// A teardrop pin, tip at the bottom center of a 26 x 35 box.
const PIN_PATH =
  "M13 1C6.37 1 1 6.2 1 12.62c0 8.4 9.9 19.56 11.06 20.84a1.27 1.27 0 0 0 1.88 0C15.1 32.18 25 21.02 25 12.62 25 6.2 19.63 1 13 1Z";
const NOTE_MARK = '<circle class="at-pin-mark" cx="13" cy="12.6" r="4.6"/>';
const EVIDENCE_MARK = '<rect class="at-pin-mark" x="8.7" y="8.3" width="8.6" height="8.6" rx="1.2"/>';
const pinSvg = (mark: string) =>
  `<svg class="at-pin" viewBox="0 0 26 35" aria-hidden="true" focusable="false"><path class="at-pin-body" d="${PIN_PATH}"/>${mark}</svg>`;

export type MarkerShape = "pin" | "ring";

/** Notes and evidence are pins; a group of subjects only is a ring. */
export const shapeOf = (c: Cluster): MarkerShape => (c.items.some((i) => i.kind !== "subject") ? "pin" : "ring");

export function markerLabel(c: Cluster): string {
  if (c.items.length === 1) {
    const it = c.items[0]!;
    return `${kindLabel(it)}: ${it.title}`;
  }
  return `${c.items.length} records: ${c.items.map((i) => i.title).join("; ")}`;
}

export function createMarkerElement(c: Cluster): HTMLButtonElement {
  const el = document.createElement("button");
  const shape = shapeOf(c);
  el.type = "button";
  el.className = `at-marker at-marker--${shape}`;
  el.dataset["keys"] = c.key;
  const label = markerLabel(c);
  el.setAttribute("aria-label", label);
  el.title = label;
  if (shape === "pin") {
    el.innerHTML = pinSvg(c.items.every((i) => i.kind === "evidence") ? EVIDENCE_MARK : NOTE_MARK);
  } else {
    const ring = document.createElement("span");
    ring.className = "at-ring";
    el.append(ring);
  }
  if (c.items.length > 1) {
    const badge = document.createElement("span");
    badge.className = "at-badge";
    badge.textContent = c.items.length > 99 ? "99+" : String(c.items.length);
    el.append(badge);
  }
  return el;
}

/** The device position after Locate me. Not interactive. */
export function createDeviceElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "at-device";
  el.setAttribute("aria-hidden", "true");
  return el;
}
