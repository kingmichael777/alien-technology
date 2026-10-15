import { create } from "zustand";
import type { EvidenceRec, LinkRec, NoteRec, SubjectRec } from "@/data/db";

/** Decrypted contents of one sealed case, held in memory only. Record arrays are in id order, like an index read. */
export interface Bundle {
  caseId: string;
  /** The case's encryptionKeyRef when it was opened; a different value means the bundle is stale. */
  keyRef: string;
  notes: NoteRec[];
  subjects: SubjectRec[];
  links: LinkRec[];
  evidence: EvidenceRec[];
  /** Decrypted media with their original MIME types, by blob id */
  blobs: Map<string, Blob>;
}

export const useUnlocked = create<{ bundle: Bundle | null; set: (b: Bundle) => void; clear: () => void }>((set) => ({
  bundle: null,
  set: (bundle) => set({ bundle }),
  clear: () => set({ bundle: null }),
}));
