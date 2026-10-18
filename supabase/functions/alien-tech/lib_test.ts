// Run with: deno test supabase/functions/alien-tech/lib_test.ts
import { canonicalCode, clock, shapeNotes, shapeTranscript, tidy } from "./lib.ts";

function eq(actual: unknown, expected: unknown, label = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}\nexpected ${e}\nreceived ${a}`);
}

Deno.test("access code is accepted however it is typed", () => {
  const code = "ALIEN-AB2CD-EF3GH-JK4LM-NP5QR";
  eq(canonicalCode(code), code);
  eq(canonicalCode(" alien ab2cd ef3gh jk4lm np5qr "), code);
  eq(canonicalCode("alienab2cdef3ghjk4lmnp5qr"), code);
  eq(canonicalCode("something else"), "something else");
});

const w = (text: string, start: number, end: number, speaker = "speaker_0") => ({
  text,
  start,
  end,
  type: "word",
  speaker_id: speaker,
});
const sp = (start: number) => ({ text: " ", start, end: start, type: "spacing", speaker_id: null });

Deno.test("words become one segment per speaker turn", () => {
  const { transcript, text } = shapeTranscript({
    language_code: "eng",
    audio_duration_secs: 9.5,
    words: [
      w("Hi,", 0, 0.3),
      sp(0.3),
      w("I'm", 0.35, 0.5),
      sp(0.5),
      w("Sam.", 0.55, 0.9),
      sp(0.9),
      w("Hello", 1.2, 1.5, "speaker_1"),
      sp(1.5),
      w("Sam.", 1.55, 1.9, "speaker_1"),
      { text: "(laughs)", start: 2, end: 2.5, type: "audio_event", speaker_id: "speaker_1" },
      sp(2.5),
      w("Good", 3, 3.2),
      sp(3.2),
      w("to", 3.25, 3.3),
      sp(3.3),
      w("meet", 3.35, 3.5),
      sp(3.5),
      w("you.", 3.55, 3.8),
    ],
  });
  eq(transcript.segments.map((s) => [s.speaker, s.text]), [
    ["speaker_0", "Hi, I'm Sam."],
    ["speaker_1", "Hello Sam."],
    ["speaker_0", "Good to meet you."],
  ]);
  eq(transcript.speakers, ["speaker_0", "speaker_1"]);
  eq(transcript.segments[1].start, 1.2);
  eq(transcript.segments[1].end, 1.9);
  eq(transcript.duration, 9.5);
  eq(text, "Hi, I'm Sam.\nHello Sam.\nGood to meet you.");
});

Deno.test("a long pause by the same speaker starts a new paragraph", () => {
  const { transcript } = shapeTranscript({
    words: [
      w("One", 0, 0.4),
      sp(0.4),
      w("thing.", 0.5, 0.9),
      sp(0.9),
      w("Another", 4.5, 5),
      sp(5),
      w("thing.", 5.1, 5.5),
    ],
  });
  eq(transcript.segments.map((s) => s.text), ["One thing.", "Another thing."]);
});

Deno.test("no words means no segments", () => {
  const { transcript, text } = shapeTranscript({ words: [] });
  eq(transcript.segments, []);
  eq(text, "");
});

Deno.test("notes are cleaned and speaker names kept only for real speakers", () => {
  const { notes, suggested } = shapeNotes(
    {
      title: '"Kitchen quote — next steps."',
      summary: "**Sam** gave a quote — it was fair. #budget",
      key_points: ["Price is $4,500", "", 7],
      follow_ups: [{ task: "Send the quote", who: "{ speaker_1 }", when: "Friday (October 23)" }, {
        task: "",
        who: "",
        when: "",
      }],
      details: [{ label: "Quote", value: "$4,500" }, { label: "", value: "x" }],
      open_questions: ["Start date?"],
      speaker_names: [{ speaker: "speaker_1", name: "Sam" }, { speaker: "{speaker_7}", name: "Ghost" }],
    },
    ["speaker_0", "speaker_1"],
    "test-model",
  );
  eq(notes.title, "Kitchen quote, next steps");
  eq(notes.summary, "Sam gave a quote, it was fair. budget");
  eq(notes.key_points, ["Price is $4,500"]);
  eq(notes.follow_ups, [{ task: "Send the quote", who: "{speaker_1}", when: "Friday (October 23)" }]);
  eq(notes.details, [{ label: "Quote", value: "$4,500" }]);
  eq(suggested, { speaker_1: "Sam" });
  eq(notes.model, "test-model");
});

Deno.test("tidy and clock", () => {
  eq(tidy("a  —  b"), "a, b");
  eq(clock(5), "0:05");
  eq(clock(65), "1:05");
  eq(clock(3725), "1:02:05");
});
