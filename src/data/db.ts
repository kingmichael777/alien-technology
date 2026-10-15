import Dexie, { type Table } from "dexie";
import type { Sealed } from "@/lib/crypto";

export type CaseStatus = "active" | "sealed" | "archived";
export type NoteType = "text" | "voice" | "photo" | "location";
export type Threat = "undetermined" | "low" | "elevated" | "high";
export type EntityKind = "note" | "subject" | "evidence";
export type CustodyAction = "captured" | "imported" | "viewed" | "exported" | "edited" | "verified";

export interface CaseRec {
  id: string;
  codename: string;
  status: CaseStatus;
  createdAt: number;
  lastActivityAt: number;
  encryptionKeyRef: string | null;
  sample: boolean;
}

export interface GeoPoint {
  lat: number;
  lng: number;
  accuracy: number | null;
  source: "device" | "exif" | "manual";
}

export interface NoteRec {
  id: string;
  caseId: string;
  type: NoteType;
  title: string;
  body: string;
  transcript: string;
  durationMs: number;
  createdAt: number;
  updatedAt: number;
  location: GeoPoint | null;
  attachmentIds: string[];
  subjectIds: string[];
  flagged: boolean;
  /** Dismissed suggestion keys: "subject:<id>" or "coords:<lat>,<lng>" */
  dismissed?: string[];
  /** Ciphertext of the full record when its case is sealed */
  enc?: Sealed;
  sample: boolean;
}

export interface SubjectRec {
  id: string;
  caseId: string;
  name: string;
  aliases: string[];
  photoBlobId: string | null;
  lastSeen: { place: string; detail: string; at: number | null };
  coordinates: { lat: number; lng: number } | null;
  threatLevel: Threat;
  fields: { key: string; value: string }[];
  /** Keys shown as black bars: "alias:<index>", "field:<key>", "lastSeen.place", "lastSeen.detail" */
  redacted: string[];
  enc?: Sealed;
  sample: boolean;
}

export interface LinkRec {
  id: string;
  caseId: string;
  fromId: string;
  fromKind: EntityKind;
  toId: string;
  toKind: EntityKind;
  label: string;
  createdAt: number;
  enc?: Sealed;
  sample?: boolean;
}

export interface CustodyEntry {
  at: number;
  action: CustodyAction;
  detail: string;
}

export interface EvidenceRec {
  id: string;
  caseId: string;
  noteId: string | null;
  kind: "photo" | "audio" | "file";
  blobId: string;
  /** 480px JPEG preview for grids; the original blob is never altered */
  thumbBlobId?: string | null;
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  exif: Record<string, string>;
  gps: { lat: number; lng: number } | null;
  capturedAt: number;
  custody: CustodyEntry[];
  enc?: Sealed;
  sample: boolean;
}

export interface BoardPosRec {
  id: string;
  caseId: string;
  x: number;
  y: number;
  hidden?: boolean;
}

export interface BlobRec {
  id: string;
  data: Blob;
  /** Present when data is AES-GCM ciphertext */
  iv?: string;
}

export interface SettingRec {
  key: string;
  value: unknown;
}

class AlienDB extends Dexie {
  cases!: Table<CaseRec, string>;
  notes!: Table<NoteRec, string>;
  subjects!: Table<SubjectRec, string>;
  links!: Table<LinkRec, string>;
  evidence!: Table<EvidenceRec, string>;
  boardPositions!: Table<BoardPosRec, string>;
  blobs!: Table<BlobRec, string>;
  settings!: Table<SettingRec, string>;

  constructor() {
    super("alien-technology");
    this.version(1).stores({
      cases: "id, status, lastActivityAt",
      notes: "id, caseId, type, createdAt, *subjectIds",
      subjects: "id, caseId",
      links: "id, caseId, fromId, toId",
      evidence: "id, caseId, noteId, kind",
      boardPositions: "id, caseId",
      blobs: "id",
      settings: "key",
    });
  }
}

export const db = new AlienDB();
