import { create } from "zustand";
import type { EntityKind } from "@/data/db";

/** A request to show one record on a case map: set by a link, consumed once by the map. */
export interface MapFocus {
  caseId: string;
  kind: EntityKind;
  id: string;
  at: number;
}

/** Requests older than this are ignored, so an abandoned link never steers a later visit. */
const STALE_MS = 60_000;

interface MapFocusState {
  focus: MapFocus | null;
  /** Call right before navigating to /case/$id?tab=map. */
  focusOn: (f: Omit<MapFocus, "at">) => void;
  /** Returns the pending request for this case, if it is fresh, and clears it. */
  take: (caseId: string) => MapFocus | null;
}

export const useMapFocus = create<MapFocusState>((set, get) => ({
  focus: null,
  focusOn: (f) => set({ focus: { ...f, at: Date.now() } }),
  take: (caseId) => {
    const f = get().focus;
    if (!f || f.caseId !== caseId) return null;
    set({ focus: null });
    return Date.now() - f.at > STALE_MS ? null : f;
  },
}));
