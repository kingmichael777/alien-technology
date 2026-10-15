import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { LocateFixed } from "lucide-react";
import { toast } from "sonner";
import type { MapOptions, Map as MapLibreMap, Marker, PaddingOptions, StyleSpecification } from "maplibre-gl";
import type { CaseRec } from "@/data/db";
import { useCaseNotes, useEvidenceList, useSubjects } from "@/data/hooks";
import { EmptyState, IconButton, Sheet, SW } from "@/components/at/ui";
import { getFixNow } from "@/lib/location";
import { cn } from "@/lib/utils";
import { useMapFocus } from "@/store/map";
import { boundsOf, buildItems, clusterItems, initialCamera, sheetOrder, spanMeters, SAME_PLACE_M, type Camera, type Cluster, type MapItem } from "./model";
import { createDeviceElement, createMarkerElement, shapeOf } from "./markers";
import { MapSheetBody, sheetTitle } from "./MapSheet";

type Engine = typeof import("./maplibre");

const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const STYLE_TIMEOUT_MS = 8000;
/** Height of the floating capsule nav plus its gap above the bottom edge (CapsuleBar). */
const NAV_CLEAR_CSS = "calc(60px + max(env(safe-area-inset-bottom), 14px))";
const FIT_MAX_ZOOM = 15;
const EXPAND_MAX_ZOOM = 17;
const DETAIL_ZOOM = 15;

/** Map for one case: pins for located notes and evidence, rings for subjects. */
export function CaseMapTab({ c }: { c: CaseRec }) {
  return <CaseMap key={c.id} c={c} />;
}

function CaseMap({ c }: { c: CaseRec }) {
  const notes = useCaseNotes(c.id);
  const evidence = useEvidenceList(c.id);
  const subjects = useSubjects(c.id);
  const items = useMemo(() => (notes && evidence && subjects ? buildItems(notes, evidence, subjects) : undefined), [notes, evidence, subjects]);
  const byKey = useMemo(() => new Map((items ?? []).map((i) => [i.key, i])), [items]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const anchorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const top = useDocumentTop(anchorRef, c.status);

  const [attempt, setAttempt] = useState(0);
  const [engine, setEngine] = useState<{ lib: Engine; style: StyleSpecification | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  /** "fallback": the local background style is up because the basemap style could not be fetched */
  const [basemap, setBasemap] = useState<"remote" | "fallback">("remote");
  /** Tiles failed to load while the device was offline */
  const [tilesLost, setTilesLost] = useState(false);
  const [zoomTick, setZoomTick] = useState(0);
  const [sheetKeys, setSheetKeys] = useState<string[] | null>(null);
  const [locating, setLocating] = useState(false);
  const [located, setLocated] = useState(false);
  const markers = useRef(new Map<string, Marker>());
  const device = useRef<Marker | null>(null);

  // MapLibre (a separate chunk) and the basemap style load together.
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    setFailed(false);
    Promise.all([import("./maplibre"), fetchStyle(ac.signal)]).then(
      ([lib, style]) => !cancelled && setEngine({ lib, style }),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [attempt]);

  // The map is created once, when MapLibre and the case records are both ready.
  const ready = items !== undefined;
  useEffect(() => {
    const el = containerRef.current;
    if (!engine || !ready || !el) return;
    const { lib, style } = engine;
    let m: MapLibreMap;
    try {
      m = new lib.MapLibreMap({
        container: el,
        style: style ?? fallbackStyle(),
        ...cameraOptions(initialCamera(itemsRef.current ?? []), fitPadding(el)),
        attributionControl: { compact: false },
        maxZoom: 19,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxPitch: 0,
        boxZoom: false,
        fadeDuration: 150,
      });
    } catch {
      setFailed(true);
      return;
    }
    m.touchZoomRotate.disableRotation();
    m.keyboard.disableRotation();
    // The dark style asks for "circle-11" while its sprite ships "circle_11": draw the small place dot it
    // intends, and give any other missing icon an empty pixel rather than a console warning.
    m.setMissingStyleImageResolver((id) => {
      if (!m.hasImage(id)) m.addImage(id, id === "circle-11" ? placeDot() : EMPTY_ICON, { pixelRatio: 2 });
    });
    m.addControl(new lib.NavigationControl({ showCompass: false, visualizePitch: false }), "top-right");
    m.on("zoomend", () => setZoomTick((t) => t + 1));
    m.on("error", (ev) => {
      // Tiles that fail in a dead zone are expected; the pins do not depend on them.
      if (!navigator.onLine) setTilesLost(true);
      if (import.meta.env.DEV) console.warn("Map:", ev.error?.message);
    });
    setBasemap(style ? "remote" : "fallback");
    setMap(m);
    return () => {
      // The marker effect swaps this Map on every pass, so read it at teardown.
      for (const mk of markers.current.values()) mk.remove();
      markers.current = new Map();
      device.current = null;
      m.remove();
      setMap(null);
    };
  }, [engine, ready]);

  // Back online after starting on the local style: bring in the basemap.
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;
  useEffect(() => {
    if (!map) return;
    let alive = true;
    const onOnline = async () => {
      setTilesLost(false);
      if (basemapRef.current !== "fallback") return;
      const style = await fetchStyle();
      if (!alive || !style) return;
      map.setStyle(style, { diff: false });
      setBasemap("remote");
    };
    window.addEventListener("online", onOnline);
    return () => {
      alive = false;
      window.removeEventListener("online", onOnline);
    };
  }, [map]);

  // Tapping a marker: one record or a stack at one spot opens the sheet; a spread group zooms in.
  const onTap = useRef<(keys: string[]) => void>(() => {});
  onTap.current = (keys) => {
    const hit = keys.map((k) => byKey.get(k)).filter((i): i is MapItem => !!i);
    if (!map || hit.length === 0) return;
    const b = boundsOf(hit)!;
    if (hit.length === 1 || spanMeters(b) < SAME_PLACE_M) {
      setSheetKeys(sheetOrder(hit).map((i) => i.key));
      return;
    }
    map.fitBounds(
      [
        [b.west, b.south],
        [b.east, b.north],
      ],
      { padding: fitPadding(map.getContainer()), maxZoom: EXPAND_MAX_ZOOM, duration: 600 },
    );
  };

  // Markers follow the records and regroup after each zoom.
  useEffect(() => {
    if (!map || !engine || !items) return;
    const next = new Map<string, Marker>();
    for (const cl of clusterItems(items, map.getZoom())) {
      const sig = signature(cl);
      const kept = markers.current.get(sig);
      if (kept) {
        markers.current.delete(sig);
        next.set(sig, kept);
        continue;
      }
      const el = createMarkerElement(cl);
      const keys = cl.items.map((i) => i.key);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onTap.current(keys);
      });
      const mk = new engine.lib.Marker({ element: el, anchor: shapeOf(cl) === "pin" ? "bottom" : "center" }).setLngLat([cl.lng, cl.lat]).addTo(map);
      next.set(sig, mk);
    }
    for (const mk of markers.current.values()) mk.remove();
    markers.current = next;
  }, [map, engine, items, zoomTick]);

  // A dossier Map link asked to show one record: fly there, then open its sheet.
  const focus = useMapFocus((s) => s.focus);
  useEffect(() => {
    if (!map || !items || !focus) return;
    const f = useMapFocus.getState().take(c.id);
    const it = f ? items.find((i) => i.key === `${f.kind}:${f.id}`) : undefined;
    if (!it) return;
    setSheetKeys(null);
    // Registered first: with reduced motion the move is a jump and ends synchronously.
    map.once("moveend", () => setSheetKeys([it.key]));
    map.flyTo({ center: [it.lng, it.lat], zoom: Math.max(map.getZoom(), DETAIL_ZOOM), offset: [0, -Math.round(map.getContainer().clientHeight * 0.2)], duration: 1400 });
  }, [map, items, focus, c.id]);

  const locate = async () => {
    if (!map || !engine || locating) return;
    setLocating(true);
    try {
      const p = await getFixNow(10_000);
      if (!device.current) device.current = new engine.lib.Marker({ element: createDeviceElement(), anchor: "center" }).setLngLat([p.lng, p.lat]).addTo(map);
      else device.current.setLngLat([p.lng, p.lat]);
      map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), DETAIL_ZOOM), duration: 1200 });
      setLocated(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLocating(false);
    }
  };

  const sheetItems = useMemo(() => (sheetKeys ?? []).map((k) => byKey.get(k)).filter((i): i is MapItem => !!i), [sheetKeys, byKey]);
  const closeSheet = useCallback(() => setSheetKeys(null), []);
  const empty = items !== undefined && items.length === 0;
  const tilesOut = map !== null && (basemap === "fallback" || tilesLost);

  return (
    <>
      {/* Zero height in the page flow: the map hangs from the header down to the bottom edge, so the page never scrolls. */}
      <div ref={anchorRef} className="relative -mx-4 -mt-4 h-0">
        <div className="absolute inset-x-0 top-0 overflow-hidden bg-bg" style={{ height: `calc(100dvh - ${top}px)` }}>
          {/* Inline geometry: MapLibre's unlayered .maplibregl-map rule would override Tailwind's layered utilities. */}
          <div ref={containerRef} className="at-map" style={{ position: "absolute", inset: 0 }} />

          {!map && !failed && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center" style={{ paddingBottom: NAV_CLEAR_CSS }}>
              <span className="anim-fade font-mono text-[11px] tracking-[0.14em] text-ink-faint uppercase">Loading map</span>
            </div>
          )}

          {failed && (
            <div className="absolute inset-0 z-10 grid place-items-center" style={{ paddingBottom: NAV_CLEAR_CSS }}>
              <EmptyState
                title="The map did not load."
                body="Your records are untouched. Check the connection and try again."
                action={
                  <button className="btn btn-outline" onClick={() => setAttempt((a) => a + 1)}>
                    Try again
                  </button>
                }
              />
            </div>
          )}

          {empty && map && (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center" style={{ paddingBottom: NAV_CLEAR_CSS }}>
              <div className="relative">
                <div aria-hidden className="absolute -inset-x-12 -inset-y-4" style={{ background: "radial-gradient(closest-side, color-mix(in srgb, var(--bg) 94%, transparent) 68%, transparent)" }} />
                <div className="relative">
                  <EmptyState title="No locations recorded in this case." body="Captures with GPS, location pings and subject coordinates appear here." />
                </div>
              </div>
            </div>
          )}

          {tilesOut && (
            <div role="status" className="pointer-events-none absolute top-3 left-3 z-10 flex h-11 max-w-[calc(100%-5.5rem)] items-center">
              <span className="anim-fade truncate rounded-full border border-line bg-bg/85 px-3 py-1.5 font-mono text-[11px] text-ink-muted backdrop-blur-md">
                Map tiles unavailable offline.
              </span>
            </div>
          )}

          <div className="absolute top-3 right-3 z-10">
            <IconButton
              label="Locate me"
              onClick={locate}
              disabled={!map || locating}
              aria-busy={locating}
              className={cn("size-11 border border-line-strong bg-surface/90 backdrop-blur-md disabled:opacity-40", (locating || located) && "text-amber")}
            >
              <LocateFixed size={20} strokeWidth={SW} />
            </IconButton>
          </div>
        </div>
      </div>

      <Sheet open={sheetItems.length > 0} onClose={closeSheet} title={sheetItems.length > 0 ? sheetTitle(sheetItems) : undefined}>
        {sheetItems.length > 0 && <MapSheetBody items={sheetItems} caseId={c.id} notes={notes ?? []} evidence={evidence ?? []} />}
      </Sheet>
    </>
  );
}

/** Top of an element in page coordinates, kept current on resize and when the content above it changes. */
function useDocumentTop(ref: RefObject<HTMLElement | null>, dep: unknown): number {
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setTop(Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY)));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [ref, dep]);
  return top;
}

/** Room around fitted pins: clear of the controls at the top right and the nav capsule below. */
function fitPadding(el: HTMLElement): PaddingOptions {
  const probe = document.createElement("div");
  probe.style.cssText = `position:absolute;visibility:hidden;height:${NAV_CLEAR_CSS}`;
  el.appendChild(probe);
  const nav = probe.offsetHeight || 74;
  probe.remove();
  const h = el.clientHeight;
  const w = el.clientWidth;
  // Never ask for more padding than the map has room for.
  const v = (px: number) => Math.min(px, Math.max(0, h / 2 - 40));
  const x = (px: number) => Math.min(px, Math.max(0, w / 2 - 40));
  return { top: v(84), bottom: v(nav + 28), left: x(56), right: x(68) };
}

function cameraOptions(cam: Camera, padding: PaddingOptions): Partial<MapOptions> {
  if (cam.kind === "world") return { center: [0, 25], zoom: 1 };
  if (cam.kind === "point") return { center: [cam.center.lng, cam.center.lat], zoom: cam.zoom };
  const b = cam.bounds;
  return {
    bounds: [
      [b.west, b.south],
      [b.east, b.north],
    ],
    fitBoundsOptions: { padding, maxZoom: FIT_MAX_ZOOM },
  };
}

/** Same members at the same place with the same labels keep their marker. */
function signature(cl: Cluster): string {
  return `${cl.key}@${cl.lat.toFixed(6)},${cl.lng.toFixed(6)}#${cl.items.map((i) => i.title).join("\u0001")}`;
}

function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

const EMPTY_ICON = { width: 1, height: 1, data: new Uint8Array(4) };

/** Small round place marker, 11 px at pixel ratio 2, in the muted ink tone. */
function placeDot(): ImageData | typeof EMPTY_ICON {
  const c = document.createElement("canvas");
  c.width = c.height = 22;
  const ctx = c.getContext("2d");
  if (!ctx) return EMPTY_ICON;
  ctx.fillStyle = token("--text-muted", "#8c8c8a");
  ctx.beginPath();
  ctx.arc(11, 11, 9, 0, Math.PI * 2);
  ctx.fill();
  return ctx.getImageData(0, 0, 22, 22);
}

/** No network: one background layer in the vault's own color, so the pins still have a ground. */
function fallbackStyle(): StyleSpecification {
  return { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": token("--bg", "#0a0b0c") } }] };
}

/** The OpenFreeMap dark style, or null when offline, slow or unreachable. */
async function fetchStyle(signal?: AbortSignal): Promise<StyleSpecification | null> {
  if (!navigator.onLine) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), STYLE_TIMEOUT_MS);
  const stop = () => ac.abort();
  signal?.addEventListener("abort", stop);
  try {
    const res = await fetch(STYLE_URL, { signal: ac.signal, credentials: "omit" });
    if (!res.ok) return null;
    const style = (await res.json()) as StyleSpecification;
    if (style?.version !== 8 || !Array.isArray(style.layers)) return null;
    // Match the ground to the vault background so the map edge disappears into the screen.
    const bg = token("--bg", "#0a0b0c");
    return { ...style, layers: style.layers.map((l) => (l.type === "background" ? { ...l, paint: { ...l.paint, "background-color": bg } } : l)) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}
