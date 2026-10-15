import { create } from "zustand";

interface AppState {
  /** Case currently open on screen */
  currentCaseId: string | null;
  /** Case chosen on a capture screen via the filing chip */
  filingOverride: string | null;
  plusOpen: boolean;
  newCaseOpen: boolean;
  /** Photo handed from the capsule camera button to the photo capture screen */
  pendingPhoto: File | null;
  setCurrentCase: (id: string | null) => void;
  setFilingOverride: (id: string | null) => void;
  setPlusOpen: (v: boolean) => void;
  setNewCaseOpen: (v: boolean) => void;
  setPendingPhoto: (f: File | null) => void;
}

export const useApp = create<AppState>((set) => ({
  currentCaseId: null,
  filingOverride: null,
  plusOpen: false,
  newCaseOpen: false,
  pendingPhoto: null,
  setCurrentCase: (currentCaseId) => set({ currentCaseId }),
  setFilingOverride: (filingOverride) => set({ filingOverride }),
  setPlusOpen: (plusOpen) => set({ plusOpen }),
  setNewCaseOpen: (newCaseOpen) => set({ newCaseOpen }),
  setPendingPhoto: (pendingPhoto) => set({ pendingPhoto }),
}));
