// The two outside services alien-tech uses: ElevenLabs Scribe for the
// transcript with speakers, and OpenAI for the notes.

import { config } from "./_shared/config.ts";
import {
  clock,
  type Notes,
  NOTES_INSTRUCTIONS,
  NOTES_SCHEMA,
  shapeNotes,
  shapeTranscript,
  type Transcript,
} from "./lib.ts";
import { download, EXTENSIONS, partPaths, Problem, type Row, signDownload } from "./store.ts";

export const SCRIBE_MODEL = "scribe_v2";
export const NOTES_MODEL = "gpt-5.6-sol";

// ---------------------------------------------------------------- transcription

export async function transcribe(row: Row): Promise<{ transcript: Transcript; text: string; language: string | null }> {
  const key = await config("ELEVENLABS_API_KEY");
  if (!key) throw new Problem(500, "Transcription isn't set up on the server yet.");
  const paths = partPaths(row);
  const filename = `recording.${EXTENSIONS[row.mime_type ?? ""] ?? "m4a"}`;

  let res: Response | null = null;
  if (paths.length === 1) {
    // ElevenLabs fetches the audio itself from a private link that expires.
    const url = await signDownload(paths[0], 3600);
    res = await scribe(key, (form) => form.append("source_url", url));
    if (!res.ok && res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429) {
      console.warn("[alien-tech] source_url refused:", res.status, (await res.text()).slice(0, 400));
      res = null;
    }
  }
  if (!res) {
    // Send the bytes. Parts are joined in order back into the original file.
    const blobs: Blob[] = [];
    for (const path of paths) blobs.push(await download(path));
    const file = new Blob(blobs, { type: row.mime_type ?? "application/octet-stream" });
    res = await scribe(key, (form) => form.append("file", file, filename));
  }
  if (!res.ok) throw scribeProblem(res.status, await res.text());

  const data = await res.json();
  return shapeTranscript(data);
}

async function scribe(key: string, attach: (form: FormData) => void): Promise<Response> {
  const send = () => {
    const form = new FormData();
    form.append("model_id", SCRIBE_MODEL);
    form.append("diarize", "true");
    form.append("timestamps_granularity", "word");
    form.append("tag_audio_events", "false");
    attach(form);
    return fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": key },
      body: form,
      signal: AbortSignal.timeout(330_000),
    });
  };
  try {
    let res = await send();
    if (res.status === 429 || res.status >= 500) {
      console.warn("[alien-tech] scribe answered", res.status, "- trying once more");
      await res.body?.cancel();
      await new Promise((r) => setTimeout(r, 4000));
      res = await send();
    }
    return res;
  } catch (e) {
    if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new Problem(504, "Transcription took too long. Try again.");
    }
    throw e;
  }
}

function scribeProblem(status: number, body: string): Problem {
  console.error("[alien-tech] scribe error", status, body.slice(0, 600));
  let detail = "";
  try {
    const parsed = JSON.parse(body);
    detail = String(parsed?.detail?.status ?? parsed?.detail?.code ?? "");
  } catch {
    // not JSON
  }
  if (/quota|credit|payment/i.test(detail) || /quota_exceeded|insufficient/i.test(body)) {
    return new Problem(402, "The ElevenLabs account is out of transcription credit. Add credit, then tap Try again.");
  }
  if (status === 401 || status === 403) return new Problem(502, "ElevenLabs refused the server's key.");
  if (status === 429) return new Problem(503, "The transcription service is busy. Try again in a minute.");
  if (status === 400 || status === 422) {
    return new Problem(422, "The audio couldn't be read. It may be empty or damaged.");
  }
  return new Problem(502, `The transcription service had a problem (code ${status}). Try again.`);
}

// ---------------------------------------------------------------- notes

export async function writeNotes(row: Row): Promise<{ notes: Notes; suggested: Record<string, string> }> {
  const key = await config("OPENAI_API_KEY");
  if (!key) throw new Problem(500, "Notes aren't set up on the server yet.");
  const transcript = row.transcript;
  if (!transcript || transcript.segments.length === 0) throw new Problem(409, "There's no transcript yet.");

  const zoneName = row.time_zone || "America/Los_Angeles";
  let when: string;
  try {
    when = new Date(row.recorded_at).toLocaleString("en-US", {
      timeZone: zoneName,
      dateStyle: "full",
      timeStyle: "short",
    });
  } catch {
    when = new Date(row.recorded_at).toUTCString();
  }
  const seconds = transcript.duration ?? row.duration_ms / 1000;
  const known = Object.entries(row.speaker_names ?? {})
    .filter(([k, v]) => v && transcript.speakers.includes(k))
    .map(([k, v]) => `{${k}} is ${v}`);
  let lines = transcript.segments.map((s) => `[${clock(s.start)}] {${s.speaker}}: ${s.text}`).join("\n");
  if (lines.length > 600_000) lines = lines.slice(0, 600_000) + "\n[The rest of the transcript was cut for length.]";

  const input = [
    `Recorded: ${when}`,
    `Length: ${Math.max(1, Math.round(seconds / 60))} minutes`,
    `Speakers: ${transcript.speakers.map((s) => `{${s}}`).join(", ")}`,
    known.length ? `Known names:\n${known.join("\n")}` : "",
    "",
    "Transcript:",
    lines,
  ].filter((l) => l !== "").join("\n");

  const payload = {
    model: NOTES_MODEL,
    instructions: NOTES_INSTRUCTIONS,
    input: [{ role: "user", content: [{ type: "input_text", text: input }] }],
    reasoning: { effort: "medium" },
    max_output_tokens: 16000,
    store: false,
    text: { format: { type: "json_schema", name: "conversation_notes", strict: true, schema: NOTES_SCHEMA } },
  };

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(330_000),
    });
    if (res.status === 429 || res.status >= 500) {
      const peek = await res.text();
      if (!/insufficient_quota/.test(peek)) {
        console.warn("[alien-tech] notes answered", res.status, "- trying once more");
        await new Promise((r) => setTimeout(r, 4000));
        res = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(300_000),
        });
      } else {
        res = new Response(peek, { status: res.status });
      }
    }
  } catch (e) {
    if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new Problem(504, "Writing the notes took too long. Try again.");
    }
    throw e;
  }
  if (!res.ok) throw notesProblem(res.status, await res.text());

  const data = await res.json();
  const out = outputText(data);
  if (!out) {
    console.error("[alien-tech] notes empty", JSON.stringify(data).slice(0, 800));
    throw new Problem(
      502,
      data?.status === "incomplete"
        ? "The notes ran too long to finish. Try again."
        : "The notes came back empty. Try again.",
    );
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(out);
  } catch {
    console.error("[alien-tech] notes not JSON", out.slice(0, 800));
    throw new Problem(502, "The notes came back garbled. Try again.");
  }
  return shapeNotes(parsed, transcript.speakers, NOTES_MODEL);
}

function outputText(data: { output?: unknown; output_text?: unknown }): string {
  if (typeof data.output_text === "string" && data.output_text) return data.output_text;
  const parts: string[] = [];
  if (Array.isArray(data.output)) {
    for (const item of data.output as { type?: string; content?: { type?: string; text?: string }[] }[]) {
      if (item?.type !== "message" || !Array.isArray(item.content)) continue;
      for (const c of item.content) if (c?.type === "output_text" && typeof c.text === "string") parts.push(c.text);
    }
  }
  return parts.join("");
}

function notesProblem(status: number, body: string): Problem {
  console.error("[alien-tech] notes error", status, body.slice(0, 600));
  if (/insufficient_quota|billing/i.test(body)) {
    return new Problem(
      402,
      "The OpenAI account is out of credit, so the notes couldn't be written. Add credit, then tap Try again.",
    );
  }
  if (status === 401 || status === 403) return new Problem(502, "OpenAI refused the server's key.");
  if (status === 429) return new Problem(503, "The notes service is busy. Try again in a minute.");
  return new Problem(502, `The notes service had a problem (code ${status}). Try again.`);
}
