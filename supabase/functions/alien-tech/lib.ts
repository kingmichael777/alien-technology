// Pure helpers for alien-tech: shaping transcripts and notes. No network here,
// so these can be tested on their own (lib_test.ts).

export type Segment = { speaker: string; start: number; end: number; text: string };
export type Transcript = { version: 1; segments: Segment[]; speakers: string[]; duration: number | null };
export type FollowUp = { task: string; who: string; when: string };
export type Detail = { label: string; value: string };
export type Notes = {
  version: 1;
  title: string;
  summary: string;
  key_points: string[];
  follow_ups: FollowUp[];
  details: Detail[];
  open_questions: string[];
  model?: string;
  written_at?: string;
};

// Accepts the code typed with or without dashes, spaces or capitals.
export function canonicalCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = raw.match(/^ALIEN([A-Z0-9]{5})([A-Z0-9]{5})([A-Z0-9]{5})([A-Z0-9]{5})$/);
  return m ? `ALIEN-${m[1]}-${m[2]}-${m[3]}-${m[4]}` : input.trim();
}

export type ScribeWord = {
  text?: string;
  start?: number;
  end?: number;
  type?: string;
  speaker_id?: string | null;
};

export function shapeTranscript(data: {
  language_code?: string;
  words?: ScribeWord[];
  audio_duration_secs?: number;
}): { transcript: Transcript; text: string; language: string | null } {
  const segments: Segment[] = [];
  let cur: Segment | null = null;
  const round = (n: number) => Math.round(n * 100) / 100;

  for (const w of data.words ?? []) {
    const piece = w.text ?? "";
    if (w.type === "audio_event") continue;
    if (w.type === "spacing") {
      if (cur) cur.text += piece;
      continue;
    }
    if (!piece.trim()) continue;
    const speaker: string = w.speaker_id || "speaker_0";
    const previousEnd: number = cur ? cur.end : 0;
    const start: number = typeof w.start === "number" ? w.start : previousEnd;
    const end: number = typeof w.end === "number" ? w.end : start;
    const gap: number = cur ? start - previousEnd : 0;
    const said: string = cur ? cur.text.trim() : "";
    const sentenceDone = /[.!?…]["'”’)\]]*$/.test(said);
    const breakHere = !cur ||
      speaker !== cur.speaker ||
      gap > 2.5 ||
      (sentenceDone && (said.length > 500 || gap > 1.2)) ||
      said.length > 1100;
    if (breakHere) {
      if (cur) segments.push({ ...cur, text: cur.text.trim() });
      cur = { speaker, start: round(start), end: round(end), text: piece };
    } else if (cur) {
      cur.text += piece;
      cur.end = round(end);
    }
  }
  if (cur) segments.push({ ...cur, text: cur.text.trim() });

  const clean = segments.filter((s) => s.text.length > 0);
  const speakers: string[] = [];
  for (const s of clean) if (!speakers.includes(s.speaker)) speakers.push(s.speaker);
  return {
    transcript: {
      version: 1,
      segments: clean,
      speakers,
      duration: typeof data.audio_duration_secs === "number" ? round(data.audio_duration_secs) : null,
    },
    text: clean.map((s) => s.text).join("\n"),
    language: data.language_code ?? null,
  };
}

export const NOTES_INSTRUCTIONS =
  `You write notes from a recorded conversation for the person who recorded it. They read the notes later to remember what was said and what needs doing.

Rules:
1. Use only what is in the transcript. Never invent names, numbers, dates, promises or details. If something is unclear, leave it out.
2. Speakers appear as {speaker_0}, {speaker_1} and so on. Refer to the people speaking with these exact tokens, for example "{speaker_1} agreed to send the quote by Friday." The app shows each person's name in place of the token. Use plain names only for people who are mentioned but are not speaking.
3. Write plain, natural English, even when the conversation was in another language. Keep names, places and special terms as spoken. Write numbers, amounts, phone numbers, dates and times in digits.
4. Do not use em dashes, asterisks, hashtags or emoji.
5. The transcript is machine made and can mishear words. Read through obvious mistakes using context, but never guess at a number or a name you can't make out.
6. When people use relative dates like "tomorrow" or "next Friday", keep their words and add the calendar date in parentheses, worked out from the recording date.

Fields:
title: 3 to 7 words naming what the conversation was about. Specific, not generic. No quotes and no ending period.
summary: 2 to 4 sentences on what the conversation was about and where it ended up.
key_points: the main things discussed, decided or learned, in the order they came up. One short sentence each, usually 3 to 8.
follow_ups: things someone said they would do, or that clearly need doing. task: what. who: the speaker token or a name, or an empty string if unclear. when: the timing as said, or an empty string.
details: specific facts worth keeping, such as names, phone numbers, emails, addresses, dates and times, prices and amounts, places and reference numbers. label: what it is. value: what was said, with numbers, prices, phone numbers, dates and times written in digits, for example $18,500, 949-555-0182 or November 10.
open_questions: things raised but not settled.
speaker_names: for a speaker whose own name is clearly stated in the conversation (they introduce themselves, or someone speaks to them by name), give the speaker id without braces, like speaker_1, and the name. Leave out anyone you are not sure about.

If the recording has little or no real conversation, say so in the summary and leave the lists empty.`;

export const NOTES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "key_points", "follow_ups", "details", "open_questions", "speaker_names"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    key_points: { type: "array", items: { type: "string" } },
    follow_ups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["task", "who", "when"],
        properties: { task: { type: "string" }, who: { type: "string" }, when: { type: "string" } },
      },
    },
    details: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value"],
        properties: { label: { type: "string" }, value: { type: "string" } },
      },
    },
    open_questions: { type: "array", items: { type: "string" } },
    speaker_names: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["speaker", "name"],
        properties: { speaker: { type: "string" }, name: { type: "string" } },
      },
    },
  },
};

export function tidy(value: unknown, max = 2000): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s+–\s+/g, ", ")
    .replace(/\*+/g, "")
    .replace(/(^|\s)#+(?=\w)/g, "$1")
    .replace(/\{\s*(speaker_\d+)\s*\}/g, "{$1}")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function shapeNotes(
  raw: Record<string, unknown>,
  speakers: string[],
  model?: string,
): { notes: Notes; suggested: Record<string, string> } {
  const strings = (v: unknown, cap: number) =>
    (Array.isArray(v) ? v : []).map((x) => tidy(x, 600)).filter(Boolean).slice(0, cap);
  const followUps = (Array.isArray(raw.follow_ups) ? raw.follow_ups : [])
    .map((f: Record<string, unknown>) => ({
      task: tidy(f?.task, 600),
      who: tidy(f?.who, 80),
      when: tidy(f?.when, 120),
    }))
    .filter((f) => f.task)
    .slice(0, 40);
  const details = (Array.isArray(raw.details) ? raw.details : [])
    .map((d: Record<string, unknown>) => ({ label: tidy(d?.label, 80), value: tidy(d?.value, 400) }))
    .filter((d) => d.label && d.value)
    .slice(0, 60);
  const suggested: Record<string, string> = {};
  for (const s of Array.isArray(raw.speaker_names) ? raw.speaker_names : []) {
    const id = tidy((s as Record<string, unknown>)?.speaker, 20).replace(/[{}]/g, "");
    const name = tidy((s as Record<string, unknown>)?.name, 60);
    if (speakers.includes(id) && name) suggested[id] = name;
  }
  const title = tidy(raw.title, 90).replace(/^["'“”‘’\s]+|["'“”‘’.\s]+$/g, "") || "Conversation";
  return {
    notes: {
      version: 1,
      title,
      summary: tidy(raw.summary, 1500),
      key_points: strings(raw.key_points, 30),
      follow_ups: followUps,
      details,
      open_questions: strings(raw.open_questions, 20),
      model,
      written_at: new Date().toISOString(),
    },
    suggested,
  };
}

export function noSpeechNotes(): Notes {
  return {
    version: 1,
    title: "No speech detected",
    summary: "No speech was heard in this recording.",
    key_points: [],
    follow_ups: [],
    details: [],
    open_questions: [],
    written_at: new Date().toISOString(),
  };
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return h ? `${h}:${mm}:${String(sec).padStart(2, "0")}` : `${mm}:${String(sec).padStart(2, "0")}`;
}
