import { create } from "zustand";
import type { EvidenceRec, LinkRec, NoteRec, SubjectRec } from "@/data/db";

/** Decrypted contents of one sealed case, held in memory only. */
export interface Bundle {
  caseId: string;
  notes: NoteRec[];
  subjects: SubjectRec[];
  links: LinkRec[];
  evidence: EvidenceRec[];
  blobs: Map<string, Blob>;
}

export const useUnlocked = create<{ bundle: Bundle | null; set: (b: Bundle) => void; clear: () => void }>((set) => ({
  bundle: null,
  set: (bundle) => set({ bundle }),
  clear: () => set({ bundle: null }),
}));
