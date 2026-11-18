// alien-share: a private link to one Alien Technology recording, so its
// transcript, notes and audio can be handed to Claude.
//
// The owner turns the link on from the app (share_on) and can turn it off
// (share_off). Whoever holds the link can read that one recording as plain
// text and download its audio, with no sign-in:
//   GET .../c/<key>         the notes and the whole transcript
//   GET .../c/<key>/audio   the audio file
// The key names the recording and carries a proof made with the service key
// from a random value kept on the row. Turning the link off clears that
// value, so the old link can never work again. A link also stops by itself
// after a week, and when its owner's account is paused or removed.
//
// This is its own function so the recorder's function (alien-tech) is left
// untouched. It reads the same tables and the same private storage bucket.

import {
  audioFileName,
  hex,
  type Notes,
  parseShareKey,
  same,
  shareDocument,
  shareKey,
  type Transcript,
} from "./lib.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DB = `${SUPABASE_URL}/rest/v1`;
const STORAGE = `${SUPABASE_URL}/storage/v1`;
const BUCKET = "alien-recordings";
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/alien-share`;
const SITE_URL = "https://alientek.org";

const SHARE_DAYS = 7; // how long a link works
const SESSION_DAYS = 180; // the same limit alien-tech puts on a signed-in phone
const DAY_MS = 24 * 3600 * 1000;

// The same list alien-tech stores audio under.
const EXTENSIONS: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

type Row = {
  id: string;
  recorded_at: string;
  duration_ms: number;
  mime_type: string | null;
  size_bytes: number | null;
  parts: number;
  time_zone: string | null;
  status: string;
  title: string | null;
  transcript: Transcript | null;
  notes: Notes | null;
  speaker_names: Record<string, string> | null;
  owner_id: string | null;
  share_nonce: string | null;
  share_expires_at: string | null;
};
const ROW_FIELDS =
  "id,recorded_at,duration_ms,mime_type,size_bytes,parts,time_zone,status,title,transcript,notes,speaker_names,owner_id,share_nonce,share_expires_at";

// A problem the app can show to the person as it is.
class Problem extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-alien-session",
  "Access-Control-Max-Age": "86400",
};

// ---------------------------------------------------------------- requests

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method === "GET" || req.method === "HEAD") return await shared(req);
  if (req.method !== "POST") return reply(405, { error: "Use POST." });

  let action = "";
  try {
    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      body = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return reply(400, { error: "The request wasn't valid JSON." });
    }
    action = typeof body.action === "string" ? body.action : "";
    const ownerId = await signedInAccount(req);
    const id = uuid(body.id);

    switch (action) {
      case "share_on":
        return reply(200, await shareOn(id, ownerId));
      case "share_off":
        return reply(200, await shareOff(id, ownerId));
      case "share_status":
        return reply(200, await shareStatus(id, ownerId));
      default:
        return reply(400, { error: "Unknown action." });
    }
  } catch (e) {
    if (e instanceof Problem) return reply(e.status, { error: e.message });
    console.error("[alien-share]", action, e);
    return reply(500, { error: "Something went wrong on the server." });
  }
});

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------- database and storage

function serviceHeaders(): Record<string, string> {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
}

async function db<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${DB}/${path}`, {
    ...init,
    headers: {
      ...serviceHeaders(),
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) throw new Error(`database ${res.status}: ${await res.text()}`);
  const body = await res.text();
  return (body ? JSON.parse(body) : []) as T;
}

function uuid(value: unknown): string {
  if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return value.toLowerCase();
  }
  throw new Problem(400, "That recording id looks wrong.");
}

async function getRow(id: string): Promise<Row | null> {
  const rows = await db<Row[]>(`alien_recordings?id=eq.${id}&select=${ROW_FIELDS}`);
  return rows[0] ?? null;
}

// The recording, only when it belongs to this account. Someone else's
// recording answers exactly like one that doesn't exist.
async function mustOwn(id: string, ownerId: string): Promise<Row> {
  const row = await getRow(id);
  if (!row || row.owner_id !== ownerId) throw new Problem(404, "That recording wasn't found.");
  return row;
}

async function setShare(id: string, ownerId: string, nonce: string | null, expires: string | null): Promise<Row> {
  const rows = await db<Row[]>(`alien_recordings?id=eq.${id}&owner_id=eq.${ownerId}&select=${ROW_FIELDS}`, {
    method: "PATCH",
    body: JSON.stringify({ share_nonce: nonce, share_expires_at: expires }),
  });
  if (!rows[0]) throw new Problem(404, "That recording wasn't found.");
  return rows[0];
}

function partPaths(row: Pick<Row, "id" | "parts" | "mime_type">): string[] {
  const ext = EXTENSIONS[row.mime_type ?? ""] ?? "m4a";
  return Array.from({ length: Math.max(1, row.parts || 1) }, (_, i) => `${row.id}/part-${i}.${ext}`);
}

async function signDownload(path: string, expiresIn: number): Promise<string> {
  const res = await fetch(`${STORAGE}/object/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: { ...serviceHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) throw new Error(`sign download ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { signedURL?: string; signedUrl?: string };
  const signed = data.signedURL ?? data.signedUrl;
  if (!signed) throw new Error("sign download returned no url");
  return `${STORAGE}${signed}`;
}

// The stored object as a response, so it can be passed on without holding it in memory.
async function openObject(path: string): Promise<Response> {
  const res = await fetch(`${STORAGE}/object/authenticated/${BUCKET}/${path}`, { headers: serviceHeaders() });
  if (!res.ok || !res.body) throw new Error(`open ${res.status}: ${await res.text()}`);
  return res;
}

// ---------------------------------------------------------------- who is asking

// The account id behind the phone's session, checked the way alien-tech checks it.
async function signedInAccount(req: Request): Promise<string> {
  const token = req.headers.get("x-alien-session");
  if (!token) throw new Problem(401, "Sign in to continue.");
  const tokenHash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  const rows = await db<{ last_used_at: string; account: { id: string; status: string } | null }[]>(
    `alien_sessions?token_hash=eq.${tokenHash}&select=last_used_at,account:alien_accounts(id,status)`,
  );
  const session = rows[0];
  const account = session?.account;
  const age = session ? Date.now() - Date.parse(session.last_used_at) : Infinity;
  if (!account || age > SESSION_DAYS * DAY_MS) throw new Problem(401, "Sign in again to continue.");
  if (account.status !== "active") throw new Problem(403, "This account is paused. Ask the owner to turn it back on.");
  return account.id;
}

// ---------------------------------------------------------------- turning the link on and off

function shareIsOn(row: Pick<Row, "share_nonce" | "share_expires_at">): boolean {
  return !!row.share_nonce && !!row.share_expires_at && Date.parse(row.share_expires_at) > Date.now();
}

async function shareProof(id: string, nonce: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SERVICE_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`alien-share:${id}:${nonce}`));
  return hex(sig).slice(0, 40);
}

async function shareLinks(row: Row): Promise<{ url: string; audio_url: string }> {
  const key = shareKey(row.id, await shareProof(row.id, row.share_nonce ?? ""));
  return { url: `${SITE_URL}/c/${key}`, audio_url: `${FUNCTION_URL}/c/${key}/audio` };
}

// Turns the link on, or keeps the one already on and gives it a fresh week.
async function shareOn(id: string, ownerId: string) {
  const row = await mustOwn(id, ownerId);
  if (row.status === "uploading") throw new Problem(409, "This recording hasn't finished uploading.");
  const nonce = shareIsOn(row) && row.share_nonce
    ? row.share_nonce
    : hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const expires = new Date(Date.now() + SHARE_DAYS * DAY_MS).toISOString();
  const next = await setShare(id, ownerId, nonce, expires);
  return { ...(await shareLinks(next)), expires_at: expires };
}

async function shareOff(id: string, ownerId: string) {
  await setShare(id, ownerId, null, null);
  return { expires_at: null };
}

async function shareStatus(id: string, ownerId: string) {
  const row = await mustOwn(id, ownerId);
  return { expires_at: shareIsOn(row) ? row.share_expires_at : null };
}

// ---------------------------------------------------------------- opening a link

const PRIVATE: Record<string, string> = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function plain(status: number, body: string): Response {
  return new Response(body, { status, headers: { ...PRIVATE, "Content-Type": "text/plain; charset=utf-8" } });
}

// A wrong link, a link turned off and a link that ran out all answer the same.
const NO_LINK = "This link is off or has expired. Open the recording in Alien Technology and copy a new link.\n";

async function shared(req: Request): Promise<Response> {
  try {
    const m = new URL(req.url).pathname.match(/\/c\/([0-9a-fA-F]{72})(\/audio)?\/?$/);
    const parsed = m ? parseShareKey(m[1]) : null;
    if (!m || !parsed) return plain(404, NO_LINK);
    const row = await getRow(parsed.id);
    if (!row || !shareIsOn(row) || !same(parsed.proof, await shareProof(row.id, row.share_nonce ?? ""))) {
      return plain(404, NO_LINK);
    }
    const owners = await db<{ status: string }[]>(`alien_accounts?id=eq.${row.owner_id}&select=status`);
    if (owners[0]?.status !== "active") return plain(404, NO_LINK);

    const title = row.title?.trim() || row.notes?.title?.trim() || "Recording";
    const ext = EXTENSIONS[row.mime_type ?? ""] ?? "m4a";
    const name = audioFileName(title, row.recorded_at, ext);

    if (m[2]) {
      if (row.status === "uploading") return plain(409, "This recording hasn't finished uploading.\n");
      const paths = partPaths(row);
      if (paths.length === 1) {
        const url = await signDownload(paths[0], 3600);
        return new Response(null, {
          status: 302,
          headers: { ...PRIVATE, Location: `${url}&download=${encodeURIComponent(name)}` },
        });
      }
      const headers: Record<string, string> = {
        ...PRIVATE,
        "Content-Type": row.mime_type ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
      };
      if (row.size_bytes) headers["Content-Length"] = String(row.size_bytes);
      return new Response(req.method === "HEAD" ? null : joined(paths), { status: 200, headers });
    }

    const zoneName = row.time_zone || "America/Los_Angeles";
    const say = (iso: string) => {
      try {
        const when = new Date(iso).toLocaleString("en-US", { timeZone: zoneName, dateStyle: "full", timeStyle: "short" });
        return `${when} (${zoneName})`;
      } catch {
        return new Date(iso).toUTCString();
      }
    };
    const links = await shareLinks(row);
    const doc = shareDocument({
      title,
      recorded: say(row.recorded_at),
      seconds: row.transcript?.duration ?? row.duration_ms / 1000,
      status: row.status,
      transcript: row.transcript,
      notes: row.notes,
      names: row.speaker_names ?? {},
      audio: { url: links.audio_url, name, mime: row.mime_type ?? "audio", bytes: row.size_bytes },
      expires: say(row.share_expires_at ?? ""),
    });
    return plain(200, req.method === "HEAD" ? "" : doc);
  } catch (e) {
    console.error("[alien-share] link", e);
    return plain(500, "Something went wrong on the server. Try the link again.\n");
  }
}

// The parts of a long recording, passed on one after another as one file.
function joined(paths: string[]): ReadableStream<Uint8Array> {
  let next = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (!reader) {
          if (next >= paths.length) {
            controller.close();
            return;
          }
          reader = (await openObject(paths[next++])).body!.getReader();
        }
        const { done, value } = await reader.read();
        if (done) {
          reader = null;
          continue;
        }
        controller.enqueue(value);
        return;
      }
    },
    async cancel() {
      await reader?.cancel();
    },
  });
}
