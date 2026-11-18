// Talks to the alien-tech function on the server. A phone signs in once with
// an email and a 6-digit code; every call after that carries its session.

export const SERVER_ORIGIN = "https://nderxvalumzffjbziomd.supabase.co";
const FUNCTION_URL = `${SERVER_ORIGIN}/functions/v1/alien-tech`;
/** The function behind a recording's private link for Claude. */
const SHARE_URL = `${SERVER_ORIGIN}/functions/v1/alien-share`;

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

/** A private link to one recording, for pasting into Claude. */
export interface ClaudeLink {
  url: string;
  audio_url: string;
  expires_at: string;
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

// ---------------------------------------------------------------- session

export interface Session {
  token: string;
  email: string;
  role: "master" | "member";
}

const SESSION_KEY = "alien.session";
/** Where the shared access code lived before accounts. Cleared on sign-in. */
const OLD_CODE_KEY = "alien.accessCode";

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Session>;
    if (typeof s.token !== "string" || typeof s.email !== "string") return null;
    return { token: s.token, email: s.email, role: s.role === "master" ? "master" : "member" };
  } catch {
    return null;
  }
}

export function setSession(session: Session | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(OLD_CODE_KEY);
  } catch {
    // Storage blocked: the sign-in lasts only for this visit.
  }
  window.dispatchEvent(new Event("alien:session"));
}

export const signedIn = () => !!getSession();

// ---------------------------------------------------------------- calls

async function send<T>(action: string, body: Record<string, unknown>, token: string | null, url = FUNCTION_URL): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "x-alien-session": token } : {}) },
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    throw new ApiError(0, "Couldn't reach the server. Check the connection.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error || `The server answered with code ${res.status}.`);
  return data as T;
}

async function call<T>(action: string, body: Record<string, unknown> = {}, url = FUNCTION_URL): Promise<T> {
  const session = getSession();
  if (!session) throw new ApiError(401, "Sign in on this phone first.");
  return send<T>(action, body, session.token, url);
}

export interface AccountInfo {
  email: string;
  role: "master" | "member";
}

/** One account, as the master sees it. */
export interface AccountRow extends AccountInfo {
  id: string;
  status: "active" | "paused";
  created_at: string;
  last_seen_at: string | null;
  recordings: number;
  duration_ms: number;
}

export interface BeginResult extends ServerLight {
  uploads: { path: string; url: string }[];
  content_type?: string;
}

export const api = {
  /** Asks for a sign-in code. The answer is the same whether or not the email has an account. */
  authStart: (email: string) => send<{ ok: true }>("auth_start", { email }, null),
  authVerify: (email: string, code: string) => send<{ token: string; account: AccountInfo }>("auth_verify", { email, code }, null),
  /** What the sign-in screen offers. */
  authConfig: () => send<{ google_client_id: string | null }>("auth_config", {}, null),
  authGoogle: (idToken: string, nonce: string) =>
    send<{ token: string; account: AccountInfo }>("auth_google", { id_token: idToken, nonce }, null),
  signOut: () => call<{ ok: true }>("sign_out"),
  ping: () => call<{ ok: true; account: AccountInfo }>("ping"),
  accounts: () => call<{ accounts: AccountRow[] }>("accounts_list"),
  accountAdd: (email: string) => call<{ ok: true; emailed: boolean }>("account_add", { email }),
  accountUpdate: (id: string, status: "active" | "paused") => call<{ ok: true }>("account_update", { id, status }),
  accountRemove: (id: string) => call<{ ok: true }>("account_remove", { id }),
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
  shareOn: (id: string) => call<ClaudeLink>("share_on", { id }, SHARE_URL),
  shareOff: (id: string) => call<{ expires_at: null }>("share_off", { id }, SHARE_URL),
  shareStatus: (id: string) => call<{ expires_at: string | null }>("share_status", { id }, SHARE_URL),
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
