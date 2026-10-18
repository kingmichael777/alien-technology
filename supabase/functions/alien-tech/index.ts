// alien-tech: the server side of Alien Technology, the conversation recorder.
//
// How a recording moves through it:
//   begin      The phone says it has a new recording. The server makes a row
//              and returns private upload links, one per part (parts stay
//              under the 50 MB storage limit).
//   (upload)   The phone sends the audio straight to private storage.
//   uploaded   The phone says the upload finished. The server checks every
//              part arrived and starts processing in the background.
//   transcribe ElevenLabs Scribe turns the audio into text with speakers.
//   notes      OpenAI writes a title, summary, key points, follow-ups and
//              details from the transcript.
// The phone polls list/get to show progress. Each stage runs in its own
// background invocation, so a long recording gets the full time limit for
// each stage. A stage that dies is noticed and can be retried; the audio and
// any finished transcript are never thrown away by a failure.
//
// Every request from the app carries the access code in the x-alien-key
// header. Only the code's SHA-256 is kept on the server (ALIEN_TECH_KEY_SHA256).

import { config } from "./_shared/config.ts";
import { canonicalCode, noSpeechNotes } from "./lib.ts";
import { transcribe, writeNotes } from "./ai.ts";
import {
  baseMime,
  EXTENSIONS,
  full,
  getRow,
  int,
  isoDate,
  light,
  listObjects,
  mustGet,
  partPaths,
  patch,
  Problem,
  removeObjects,
  type Row,
  SERVICE_KEY,
  serviceHeaders,
  signDownload,
  signUpload,
  type Step,
  SUPABASE_URL,
  text,
  uuid,
  zone,
} from "./store.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/alien-tech`;
const REST = `${SUPABASE_URL}/rest/v1/alien_recordings`;

const MAX_PART_BYTES = 50 * 1024 * 1024; // the bucket's per-object limit
const MAX_TOTAL_BYTES = 200 * 1024 * 1024; // what one worker can join in memory
const MAX_PARTS = 8;
const STALE_MS = 8 * 60 * 1000; // longer than any worker can live
const VERSION = "2";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-alien-key",
  "Access-Control-Max-Age": "86400",
};

// ---------------------------------------------------------------- requests

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return reply(400, { error: "The request wasn't valid JSON." });
  }
  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "run") {
      const id = uuid(body.id);
      const step: Step = body.step === "notes" ? "notes" : "transcribe";
      const token = req.headers.get("x-alien-internal") ?? "";
      if (!same(token, await internalToken(id, step))) return reply(401, { error: "Not allowed." });
      EdgeRuntime.waitUntil(runStep(id, step));
      return reply(202, { ok: true });
    }

    if (!(await authorized(req))) return reply(401, { error: "That access code isn't right." });

    switch (action) {
      case "ping":
        return reply(200, { ok: true, version: VERSION });
      case "begin":
        return reply(200, await begin(body));
      case "uploaded":
        return reply(200, await uploaded(body));
      case "process":
        return reply(200, await retry(body));
      case "renote":
        return reply(200, await renote(body));
      case "list":
        return reply(200, await list());
      case "get":
        return reply(200, await getOne(body));
      case "get_many":
        return reply(200, await getMany(body));
      case "update":
        return reply(200, await update(body));
      case "audio":
        return reply(200, await audio(body));
      case "delete":
        return reply(200, await remove(body));
      default:
        return reply(400, { error: "Unknown action." });
    }
  } catch (e) {
    if (e instanceof Problem) return reply(e.status, { error: e.message });
    console.error("[alien-tech]", action, e);
    return reply(500, { error: "Something went wrong on the server." });
  }
});

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------- access

let keyHash: string | undefined;

async function authorized(req: Request): Promise<boolean> {
  const given = req.headers.get("x-alien-key");
  if (!given) return false;
  keyHash ??= (await config("ALIEN_TECH_KEY_SHA256"))?.trim().toLowerCase();
  if (!keyHash) return false;
  return same(await sha256(canonicalCode(given)), keyHash);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return hex(digest);
}

// Background hand-offs between stages are signed with the service key.
async function internalToken(id: string, step: Step): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SERVICE_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`alien-tech:${id}:${step}`)));
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------- actions

async function begin(body: Record<string, unknown>) {
  const id = uuid(body.id);
  const mime = baseMime(body.mime_type);
  const ext = EXTENSIONS[mime];
  if (!ext) throw new Problem(415, "This audio format isn't supported.");
  const size = int(body.size_bytes, 1, MAX_TOTAL_BYTES, "This recording is too large to process.");
  const parts = int(body.parts ?? 1, 1, MAX_PARTS, "Too many parts.");
  if (Math.ceil(size / MAX_PART_BYTES) > parts) throw new Problem(400, "Each part must be under 50 MB.");
  const recordedAt = isoDate(body.recorded_at);
  const durationMs = int(body.duration_ms ?? 0, 0, 24 * 3600 * 1000, "The length looks wrong.");
  const timeZone = zone(body.time_zone);

  const existing = await getRow(id);
  if (existing && existing.status !== "uploading") {
    return { ...light(existing), uploads: [] };
  }

  const res = await fetch(`${REST}?on_conflict=id`, {
    method: "POST",
    headers: {
      ...serviceHeaders(),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      id,
      recorded_at: recordedAt,
      duration_ms: durationMs,
      mime_type: mime,
      size_bytes: size,
      parts,
      time_zone: timeZone,
      audio_path: `${id}/part-0.${ext}`,
      status: "uploading",
      stage: null,
      error: null,
    }),
  });
  if (!res.ok) throw new Error(`insert ${res.status}: ${await res.text()}`);
  const [row] = (await res.json()) as Row[];

  const uploads = [];
  for (const path of partPaths(row)) uploads.push({ path, url: await signUpload(path) });
  return { ...light(row), uploads, content_type: mime };
}

async function uploaded(body: Record<string, unknown>) {
  const id = uuid(body.id);
  const row = await mustGet(id);
  if (row.status !== "uploading") return light(row);

  const objects = await listObjects(id);
  let total = 0;
  for (const path of partPaths(row)) {
    const name = path.slice(id.length + 1);
    const found = objects.find((o) => o.name === name);
    if (!found) throw new Problem(409, "The upload didn't finish. It will try again.");
    total += Number(found.metadata?.size ?? 0);
  }
  if (row.size_bytes && total !== Number(row.size_bytes)) {
    throw new Problem(409, "The upload was incomplete. It will try again.");
  }

  const next = await patch(id, { status: "uploaded", stage: null, error: null }, `&status=eq.uploading`);
  if (next) EdgeRuntime.waitUntil(runStep(id, "transcribe"));
  return light(next ?? (await mustGet(id)));
}

async function retry(body: Record<string, unknown>) {
  const id = uuid(body.id);
  const row = await reap(await mustGet(id));
  if (row.status === "uploading") throw new Problem(409, "This recording hasn't finished uploading.");
  if (row.status === "ready" || row.status === "processing") return light(row);

  // uploaded or failed: carry on from where it stopped.
  if (row.transcript && row.transcript.segments.length > 0) {
    const next = await patch(id, {
      status: "processing",
      stage: "queued_notes",
      error: null,
      processing_started_at: now(),
    });
    EdgeRuntime.waitUntil(runStep(id, "notes"));
    return light(next ?? row);
  }
  const next = await patch(id, { status: "uploaded", stage: null, error: null, processing_started_at: null });
  EdgeRuntime.waitUntil(runStep(id, "transcribe"));
  return light(next ?? row);
}

async function renote(body: Record<string, unknown>) {
  const id = uuid(body.id);
  const row = await reap(await mustGet(id));
  if (!row.transcript || row.transcript.segments.length === 0) {
    throw new Problem(409, "There's no transcript to write notes from yet.");
  }
  if (row.status === "processing") return light(row);
  const next = await patch(id, {
    status: "processing",
    stage: "queued_notes",
    error: null,
    processing_started_at: now(),
  });
  EdgeRuntime.waitUntil(runStep(id, "notes"));
  return light(next ?? row);
}

const LIST_FIELDS = [
  "id",
  "recorded_at",
  "duration_ms",
  "status",
  "stage",
  "error",
  "title",
  "ai_title:notes->>title",
  "summary:notes->>summary",
  "speaker_names",
  "updated_at",
  "parts",
  "mime_type",
  "size_bytes",
  "attempts",
  "processing_started_at",
].join(",");

async function list() {
  const res = await fetch(`${REST}?select=${LIST_FIELDS}&order=recorded_at.desc&limit=1000`, {
    headers: serviceHeaders(),
  });
  if (!res.ok) throw new Error(`list ${res.status}: ${await res.text()}`);
  const rows = (await res.json()) as (Row & { ai_title: string | null; summary: string | null })[];
  const out = [];
  for (const r of rows) {
    if (isStuck(r)) EdgeRuntime.waitUntil(runStep(r.id, "transcribe"));
    const fixed = isStale(r) ? await markStale(r) : null;
    const row = fixed ? { ...r, ...fixed } : r;
    out.push({
      id: row.id,
      recorded_at: row.recorded_at,
      duration_ms: row.duration_ms,
      status: row.status,
      stage: row.stage,
      error: row.error,
      title: row.title,
      ai_title: r.ai_title,
      summary: r.summary,
      speaker_names: row.speaker_names ?? {},
      updated_at: row.updated_at,
      parts: row.parts,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
    });
  }
  return { recordings: out };
}

async function getOne(body: Record<string, unknown>) {
  const row = await reap(await mustGet(uuid(body.id)));
  return { recording: full(row) };
}

// Full recordings for a list of ids, for a phone catching up on what it hasn't seen.
async function getMany(body: Record<string, unknown>) {
  const ids = (Array.isArray(body.ids) ? body.ids : []).slice(0, 50).map(uuid);
  if (ids.length === 0) return { recordings: [] };
  const res = await fetch(`${REST}?id=in.(${ids.join(",")})&select=*`, { headers: serviceHeaders() });
  if (!res.ok) throw new Error(`select many ${res.status}: ${await res.text()}`);
  const rows = (await res.json()) as Row[];
  return { recordings: rows.map(full) };
}

async function update(body: Record<string, unknown>) {
  const id = uuid(body.id);
  const changes: Partial<Row> = {};
  if ("title" in body) {
    const t = body.title === null ? "" : text(body.title, 140);
    changes.title = t || null;
  }
  if ("speaker_names" in body) {
    const names = body.speaker_names;
    if (!names || typeof names !== "object" || Array.isArray(names)) {
      throw new Problem(400, "Speaker names look wrong.");
    }
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(names as Record<string, unknown>)) {
      if (!/^speaker_\d{1,2}$/.test(k)) continue;
      const name = text(v, 60);
      if (name) clean[k] = name;
    }
    changes.speaker_names = clean;
  }
  if (Object.keys(changes).length === 0) throw new Problem(400, "Nothing to change.");
  const row = await patch(id, changes);
  if (!row) throw new Problem(404, "That recording wasn't found.");
  return { recording: full(row) };
}

async function audio(body: Record<string, unknown>) {
  const row = await mustGet(uuid(body.id));
  if (row.status === "uploading") throw new Problem(409, "This recording hasn't finished uploading.");
  const urls = [];
  for (const path of partPaths(row)) urls.push(await signDownload(path, 3600));
  return { urls, mime_type: row.mime_type };
}

async function remove(body: Record<string, unknown>) {
  const id = uuid(body.id);
  const objects = await listObjects(id);
  if (objects.length > 0) await removeObjects(objects.map((o) => `${id}/${o.name}`));
  const res = await fetch(`${REST}?id=eq.${id}`, { method: "DELETE", headers: serviceHeaders() });
  if (!res.ok) throw new Error(`delete ${res.status}: ${await res.text()}`);
  await res.body?.cancel();
  return { ok: true };
}

// ---------------------------------------------------------------- processing

async function runStep(id: string, step: Step): Promise<void> {
  const row = await claim(id, step);
  if (!row) return; // already taken, finished, or not ready for this step
  const started = Date.now();
  try {
    if (step === "transcribe") {
      const { transcript, text: plain, language } = await transcribe(row);
      console.log(
        `[alien-tech] transcribed ${id} in ${((Date.now() - started) / 1000).toFixed(1)}s:`,
        `${transcript.segments.length} segments, ${transcript.speakers.length} speakers,`,
        `${transcript.duration ?? "?"}s audio`,
      );
      if (transcript.segments.length === 0) {
        await patch(id, {
          transcript,
          transcript_text: "",
          language,
          notes: noSpeechNotes(),
          status: "ready",
          stage: null,
          error: null,
          processing_started_at: null,
        });
        return;
      }
      await patch(id, {
        transcript,
        transcript_text: plain,
        language,
        status: "processing",
        stage: "queued_notes",
        error: null,
        processing_started_at: now(),
      });
      try {
        await handOff(id, "notes");
      } catch (e) {
        console.warn("[alien-tech] hand-off failed, writing notes here", e);
        await runStep(id, "notes");
      }
      return;
    }

    const { notes, suggested } = await writeNotes(row);
    const latest = await getRow(id);
    if (!latest) return; // deleted while the notes were being written
    const names = { ...suggested, ...(latest.speaker_names ?? {}) };
    await patch(id, {
      notes,
      speaker_names: names,
      status: "ready",
      stage: null,
      error: null,
      processing_started_at: null,
    });
    console.log(`[alien-tech] notes for ${id} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (e) {
    const message = e instanceof Problem ? e.message : "Something went wrong while processing. Try again.";
    console.error(`[alien-tech] ${step} failed for ${id}:`, e);
    await patch(id, {
      status: "failed",
      stage: step === "transcribe" ? "transcribing" : "notes",
      error: message,
      processing_started_at: null,
    }).catch((err) => console.error("[alien-tech] could not record the failure", err));
  }
}

// Takes a recording for one step. Two workers can never run the same step on
// the same recording: the update only lands if nobody bumped attempts first.
async function claim(id: string, step: Step): Promise<Row | null> {
  const row = await getRow(id);
  if (!row) return null;
  const ready = step === "transcribe"
    ? row.status === "uploaded"
    : row.status === "processing" && row.stage === "queued_notes";
  if (!ready) return null;
  return await patch(
    id,
    {
      status: "processing",
      stage: step === "transcribe" ? "transcribing" : "notes",
      error: null,
      attempts: row.attempts + 1,
      processing_started_at: now(),
    },
    `&attempts=eq.${row.attempts}`,
  );
}

// Starts a step in a fresh invocation so it gets its own time limit.
async function handOff(id: string, step: Step): Promise<void> {
  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-alien-internal": await internalToken(id, step) },
    body: JSON.stringify({ action: "run", id, step }),
  });
  await res.body?.cancel();
  if (res.status !== 202) throw new Error(`hand-off answered ${res.status}`);
}

function isStale(row: Pick<Row, "status" | "stage" | "processing_started_at">): boolean {
  if (row.status !== "processing" || !row.processing_started_at) return false;
  return Date.now() - Date.parse(row.processing_started_at) > STALE_MS;
}

async function markStale(row: Row): Promise<Partial<Row> | null> {
  const changes: Partial<Row> = {
    status: "failed",
    stage: row.stage === "notes" || row.stage === "queued_notes" ? "notes" : "transcribing",
    error: "Processing stopped before it finished. Tap Try again.",
    processing_started_at: null,
  };
  const updated = await patch(row.id, changes, `&attempts=eq.${row.attempts}&status=eq.processing`);
  return updated ? changes : null;
}

// A recording that sat in "uploaded" without starting gets started again.
function isStuck(row: Pick<Row, "status" | "updated_at">): boolean {
  return row.status === "uploaded" && Date.now() - Date.parse(row.updated_at) > 90_000;
}

async function reap(row: Row): Promise<Row> {
  if (isStuck(row)) EdgeRuntime.waitUntil(runStep(row.id, "transcribe"));
  if (!isStale(row)) return row;
  const changes = await markStale(row);
  return changes ? { ...row, ...changes } : await mustGet(row.id);
}

function now(): string {
  return new Date().toISOString();
}
