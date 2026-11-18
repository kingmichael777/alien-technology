// Run with: deno test supabase/functions/alien-share/lib_test.ts
import { audioFileName, parseShareKey, shareDocument, shareKey } from "./lib.ts";

function eq(actual: unknown, expected: unknown, label = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}\nexpected ${e}\nreceived ${a}`);
}

Deno.test("a link key carries the recording id and the proof, and nothing else parses", () => {
  const id = "0b6f1c1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f";
  const proof = "a".repeat(40);
  const key = shareKey(id, proof);
  eq(key.length, 72);
  eq(parseShareKey(key), { id, proof });
  eq(parseShareKey(key.toUpperCase()), { id, proof });
  eq(parseShareKey(key.slice(1)), null);
  eq(parseShareKey(key + "0"), null);
  eq(parseShareKey("../" + key.slice(3)), null);
});

Deno.test("the audio file name is safe to type", () => {
  eq(audioFileName("Kitchen Remodeling: Quote #2", "2026-10-18T04:27:00Z", "m4a"), "2026-10-18-Kitchen-Remodeling-Quote-2.m4a");
  eq(audioFileName('"; rm -rf /', "nonsense", "m4a"), "recording-rm-rf.m4a");
  eq(audioFileName("", "2026-10-18T04:27:00Z", "webm"), "2026-10-18-Recording.webm");
});

Deno.test("the page for Claude has the notes, every line of the transcript and the audio link", () => {
  const doc = shareDocument({
    title: "Kitchen Remodeling Quote",
    recorded: "Saturday, October 17, 2026 at 9:27 PM (America/Los_Angeles)",
    seconds: 3725,
    status: "ready",
    names: { speaker_0: "Mike" },
    transcript: {
      version: 1,
      speakers: ["speaker_0", "speaker_1"],
      duration: 3725,
      segments: [
        { speaker: "speaker_0", start: 0.1, end: 6.7, text: "What are we looking at?" },
        { speaker: "speaker_1", start: 3607.9, end: 3618.4, text: "About $18,500." },
      ],
    },
    notes: {
      version: 1,
      title: "Kitchen Remodeling Quote",
      summary: "{speaker_1} quoted {speaker_0} $18,500.",
      key_points: ["Three weeks of work."],
      follow_ups: [{ task: "Email the quote", who: "{speaker_1}", when: "Friday" }],
      details: [{ label: "Cell", value: "949-555-0182" }],
      open_questions: [],
    },
    audio: { url: "https://x.test/c/k/audio", name: "2026-10-18-Kitchen-Remodeling-Quote.m4a", mime: "audio/mp4", bytes: 12_900_000 },
    expires: "Saturday, October 24, 2026 at 9:30 PM (America/Los_Angeles)",
  });
  const has = (t: string) => {
    if (!doc.includes(t)) throw new Error(`missing: ${t}\n${doc}`);
  };
  has("Title: Kitchen Remodeling Quote");
  has("Length: 1:02:05");
  has("Speakers: Mike, Speaker 2");
  has("File: 2026-10-18-Kitchen-Remodeling-Quote.m4a (audio/mp4, 12.3 MB)");
  has('Download: curl -L -o "2026-10-18-Kitchen-Remodeling-Quote.m4a" "https://x.test/c/k/audio"');
  has("Speaker 2 quoted Mike $18,500.");
  has("- Email the quote (Speaker 2, Friday)");
  has("- Cell: 949-555-0182");
  has("[0:00] Mike: What are we looking at?");
  has("[1:00:07] Speaker 2: About $18,500.");
  if (doc.includes("Open questions") || doc.includes("{speaker")) throw new Error(doc);
  if (/[—*#]/.test(doc)) throw new Error("no em dashes, asterisks or hashtags");
});

Deno.test("a recording still being written says so instead of showing an empty transcript", () => {
  const base = {
    title: "Recording",
    recorded: "x",
    seconds: 5,
    transcript: null,
    notes: null,
    names: {},
    audio: { url: "u", name: "n.m4a", mime: "audio/mp4", bytes: null },
    expires: "y",
  };
  if (!shareDocument({ ...base, status: "processing" }).includes("still being written")) throw new Error("processing");
  if (!shareDocument({ ...base, status: "failed" }).includes("Try again")) throw new Error("failed");
});
