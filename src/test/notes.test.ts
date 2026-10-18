import { describe, expect, it } from "vitest";
import { canonicalCode, looksLikeCode } from "@/lib/api";
import type { RecordingRow, ServerCopy } from "@/lib/db";
import { length, stamp, timer, when } from "@/lib/format";
import {
  displayTitle,
  extensionFor,
  fileName,
  fillSpeakers,
  matches,
  phaseOf,
  searchTerms,
  shareText,
  snippet,
  speakerName,
} from "@/lib/notes";

const server: ServerCopy = {
  id: "a",
  status: "ready",
  stage: null,
  error: null,
  updated_at: "2026-10-18T04:27:00Z",
  title: null,
  ai_title: "Kitchen Remodeling Quote",
  summary: "{speaker_1} estimated $18,500 for new cabinets.",
  speaker_names: { speaker_0: "Mike", speaker_1: "Dana" },
  notes: {
    version: 1,
    title: "Kitchen Remodeling Quote",
    summary: "{speaker_1} estimated $18,500 for new cabinets.",
    key_points: ["The job takes about three weeks."],
    follow_ups: [{ task: "Email the written quote", who: "{speaker_1}", when: "By Friday (October 23)" }],
    details: [{ label: "Cell", value: "949-555-0182" }],
    open_questions: ["Keep the old sink?"],
  },
  transcript: {
    version: 1,
    speakers: ["speaker_0", "speaker_1"],
    duration: 54.3,
    segments: [
      { speaker: "speaker_0", start: 0.1, end: 6.7, text: "Hi, I'm Mike. What are we looking at?" },
      { speaker: "speaker_1", start: 7.9, end: 18.4, text: "About eighteen thousand five hundred dollars for the quartz counters." },
    ],
  },
};

const row = (over: Partial<RecordingRow> = {}): RecordingRow => ({
  id: "a",
  recordedAt: new Date(2026, 9, 17, 21, 27).getTime(),
  durationMs: 54_000,
  mimeType: "audio/mp4",
  size: 200_000,
  hasAudio: true,
  sync: "synced",
  syncError: null,
  source: "app",
  server,
  detailAt: server.updated_at,
  createdAt: 0,
  ...over,
});

describe("speakers", () => {
  it("numbers unnamed speakers from 1 and uses names when given", () => {
    expect(speakerName("speaker_0", {})).toBe("Speaker 1");
    expect(speakerName("speaker_3", null)).toBe("Speaker 4");
    expect(speakerName("speaker_1", { speaker_1: "Dana" })).toBe("Dana");
    expect(speakerName("speaker_1", { speaker_1: "   " })).toBe("Speaker 2");
  });
  it("fills tokens in notes", () => {
    expect(fillSpeakers("{speaker_1} told {speaker_0} about {speaker_2}.", { speaker_0: "Mike", speaker_1: "Dana" })).toBe(
      "Dana told Mike about Speaker 3.",
    );
    expect(fillSpeakers("{ speaker_0 } said hi", {})).toBe("Speaker 1 said hi");
  });
});

describe("titles and status", () => {
  it("prefers the name you gave it, then the suggested one", () => {
    expect(displayTitle(row())).toBe("Kitchen Remodeling Quote");
    expect(displayTitle(row({ server: { ...server, title: "Dana visit" } }))).toBe("Dana visit");
    expect(displayTitle(row({ server: null }))).toBe("Recording");
  });

  it("explains where a recording is", () => {
    const pending = row({ sync: "pending", server: null });
    expect(phaseOf(pending, { connected: false, online: true }).kind).toBe("local");
    expect(phaseOf(pending, { connected: true, online: false })).toMatchObject({ text: expect.stringContaining("online") });
    expect(phaseOf(pending, { connected: true, online: true, progress: 0.426 })).toMatchObject({ text: "Uploading 42%" });
    expect(phaseOf(row({ sync: "rejected", syncError: "Too large." }), { connected: true, online: true })).toMatchObject({
      kind: "failed",
      retry: "upload",
    });
    const at = (status: ServerCopy["status"], stage: string | null = null) =>
      phaseOf(row({ server: { ...server, status, stage } }), { connected: true, online: true });
    expect(at("processing", "transcribing")).toMatchObject({ text: "Writing the transcript" });
    expect(at("processing", "queued_notes")).toMatchObject({ text: "Writing the notes" });
    expect(at("failed")).toMatchObject({ kind: "failed", retry: "server" });
    expect(at("ready").kind).toBe("ready");
  });
});

describe("search", () => {
  it("matches every word across notes, transcript and names", () => {
    expect(matches(row(), searchTerms("dana quartz"))).toBe(true);
    expect(matches(row(), searchTerms("949-555"))).toBe(true);
    expect(matches(row(), searchTerms("plumber"))).toBe(false);
    expect(matches(row(), [])).toBe(true);
  });
  it("shows a snippet around the match with names filled in", () => {
    expect(snippet(row(), ["quartz"])).toContain("Dana: About eighteen thousand");
    expect(snippet(row(), ["sink"])).toBeNull(); // open questions aren't used for snippets
  });
});

describe("sharing", () => {
  it("writes notes and transcript as plain text with names", () => {
    const text = shareText(row(), { transcript: true });
    expect(text).toContain("Kitchen Remodeling Quote");
    expect(text).toContain("Dana estimated $18,500");
    expect(text).toContain("- Email the written quote (Dana, By Friday (October 23))");
    expect(text).toContain("- Cell: 949-555-0182");
    expect(text).toContain("[0:07] Dana: About eighteen");
    expect(text).not.toContain("{speaker_");
    expect(shareText(row(), { transcript: false })).not.toContain("Transcript");
  });
  it("names files by date and title", () => {
    expect(fileName(row(), "m4a")).toBe("2026-10-17 Kitchen Remodeling Quote.m4a");
    expect(extensionFor("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionFor("audio/mp4")).toBe("m4a");
  });
});

describe("format", () => {
  it("formats lengths and stamps", () => {
    expect(length(54_000)).toBe("0:54");
    expect(length(3_725_000)).toBe("1:02:05");
    expect(timer(65_400)).toBe("01:05");
    expect(stamp(7.9)).toBe("0:07");
  });
  it("says today and yesterday", () => {
    const now = new Date(2026, 9, 17, 22, 0).getTime();
    expect(when(new Date(2026, 9, 17, 9, 5).getTime(), now)).toMatch(/^Today, 9:05\sAM$/);
    expect(when(new Date(2026, 9, 16, 16, 2).getTime(), now)).toMatch(/^Yesterday, 4:02\sPM$/);
  });
});

describe("access code", () => {
  it("accepts the code however it is typed", () => {
    expect(canonicalCode(" alien ab2cd ef3gh jk4lm np5qr ")).toBe("ALIEN-AB2CD-EF3GH-JK4LM-NP5QR");
    expect(looksLikeCode("alienab2cdef3ghjk4lmnp5qr")).toBe(true);
    expect(looksLikeCode("hello")).toBe(false);
  });
});

describe("adding a file", async () => {
  const { fileType } = await import("@/lib/library");
  it("reads the type from the file or its name", () => {
    expect(fileType("Call with Dana.m4a", "audio/x-m4a")).toBe("audio/mp4");
    expect(fileType("Call with Dana.m4a", "")).toBe("audio/mp4");
    expect(fileType("memo.mp3", "audio/mp3")).toBe("audio/mpeg");
    expect(fileType("memo.wav", "audio/wave")).toBe("audio/wav");
    expect(fileType("clip.webm", "audio/webm;codecs=opus")).toBe("audio/webm");
    expect(fileType("photo.jpg", "image/jpeg")).toBeNull();
    expect(fileType("notes.txt", "")).toBeNull();
  });
});
