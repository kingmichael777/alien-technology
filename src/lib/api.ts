// Talks to the alien-tech function on your own Supabase server. Every call
// carries the access code saved on this phone; nothing else is needed.

export const SERVER_ORIGIN = "https://nderxvalumzffjbziomd.supabase.co";
const FUNCTION_URL = `${SERVER_ORIGIN}/functions/v1/alien-tech`;

export type ServerStatus = "uploading" | "uploaded" | "processing" | "ready" | "failed";

export interface Segment {
  speaker: string;
  start: number;
  end: number;
  text: string;
}
export interface Transcript {
  version: 1;
  segments: Segment[];
  speakers: string[];
  duration: number | null;
}
export interface FollowUp {
  task: string;
  who: string;
  when: string;
}
export interface Detail {
  label: string;
  value: string;
}
export interface Notes {
  version: 1;
  title: string;
  summary: string;
  key_points: string[];
  follow_ups: FollowUp[];
  details: Detail[];
  open_questions: string[];
  model?: string;
  written_at?: string;
}

/** What the list call returns for each recording. */
export interface ServerLight {
  id: string;
  recorded_at: string;
  duration_ms: number;
  status: ServerStatus;
  stage: string | null;
  error: string | null;
  title: string | null;
  ai_title: string | null;
  summary: string | null;
  speaker_names: Record<string, string>;
  updated_at: string;
  parts: number;
  mime_type: string | null;
  size_bytes: number | null;
}

/** A recording with its transcript and notes. */
export interface ServerFull extends ServerLight {
  language: string | null;
  transcript: Transcript | null;
  notes: Notes | null;
  time_zone: string | null;
}

export class ApiError extends Error {
  /** 0 means the server could not be reached at all. */
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- access code

const CODE_KEY = "alien.accessCode";

/** Accepts the code typed with or without dashes, spaces or capitals. */
export function canonicalCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = raw.match(/^ALIEN([A-Z0-9]{5})([A-Z0-9]{5})([A-Z0-9]{5})([A-Z0-9]{5})$/);
  return m ? `ALIEN-${m[1]}-${m[2]}-${m[3]}-${m[4]}` : input.trim();
}

export function looksLikeCode(input: string): boolean {
  return /^ALIEN-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(canonicalCode(input));
}

export function getCode(): string | null {
  try {
    return localStorage.getItem(CODE_KEY);
  } catch {
    return null;
  }
}

export function setCode(code: string | null) {
  try {
    if (code) localStorage.setItem(CODE_KEY, code);
    else localStorage.removeItem(CODE_KEY);
  } catch {
    // Storage blocked: the code lasts only for this visit.
  }
  window.dispatchEvent(new Event("alien:code"));
}

// ---------------------------------------------------------------- calls

async function call<T>(action: string, body: Record<string, unknown> = {}, code = getCode()): Promise<T> {
  if (!code) throw new ApiError(401, "This phone isn't connected to your server yet.");
  let res: Response;
  try {
    res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-alien-key": code },
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    throw new ApiError(0, "Couldn't reach your server. Check the connection.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error || `Your server answered with code ${res.status}.`);
  return data as T;
}

export interface BeginResult extends ServerLight {
  uploads: { path: string; url: string }[];
  content_type?: string;
}

export const api = {
  ping: (code?: string) => call<{ ok: true }>("ping", {}, code ?? getCode()),
  begin: (body: {
    id: string;
    recorded_at: string;
    duration_ms: number;
    mime_type: string;
    size_bytes: number;
    parts: number;
    time_zone: string;
  }) => call<BeginResult>("begin", body),
  uploaded: (id: string) => call<ServerLight>("uploaded", { id }),
  retry: (id: string) => call<ServerLight>("process", { id }),
  renote: (id: string) => call<ServerLight>("renote", { id }),
  list: () => call<{ recordings: ServerLight[] }>("list"),
  get: (id: string) => call<{ recording: ServerFull }>("get", { id }),
  getMany: (ids: string[]) => call<{ recordings: ServerFull[] }>("get_many", { ids }),
  update: (id: string, changes: { title?: string | null; speaker_names?: Record<string, string> }) =>
    call<{ recording: ServerFull }>("update", { id, ...changes }),
  audio: (id: string) => call<{ urls: string[]; mime_type: string | null }>("audio", { id }),
  remove: (id: string) => call<{ ok: true }>("delete", { id }),
};

/** PUT a file to a private upload link, reporting progress as bytes sent. */
export function putFile(url: string, body: Blob, type: string, onProgress: (sent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", type);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else if (xhr.status === 413) reject(new ApiError(413, "This recording is too large to upload."));
      else reject(new ApiError(xhr.status, `The upload was refused (code ${xhr.status}). It will try again.`));
    };
    xhr.onerror = () => reject(new ApiError(0, "The upload was interrupted. It will try again."));
    xhr.onabort = () => reject(new ApiError(0, "The upload was interrupted. It will try again."));
    xhr.send(body);
  });
}
