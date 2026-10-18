import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { ServerLight } from "@/lib/api";
import { db, type RecordingRow } from "@/lib/db";
import { merge, needsDetail, storeFull } from "@/lib/sync";

const light = (over: Partial<ServerLight> = {}): ServerLight => ({
  id: "11111111-1111-4111-8111-111111111111",
  recorded_at: "2026-10-18T04:20:00.000Z",
  duration_ms: 54000,
  status: "ready",
  stage: null,
  error: null,
  title: null,
  ai_title: "Kitchen Remodeling Quote",
  summary: "Summary",
  speaker_names: {},
  updated_at: "2026-10-18T04:27:00.000Z",
  parts: 1,
  mime_type: "audio/mp4",
  size_bytes: 1000,
  ...over,
});

const local = (over: Partial<RecordingRow> = {}): RecordingRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  recordedAt: Date.parse("2026-10-18T04:20:00.000Z"),
  durationMs: 54000,
  mimeType: "audio/mp4",
  size: 1000,
  hasAudio: true,
  sync: "pending",
  syncError: null,
  source: "app",
  server: null,
  detailAt: null,
  createdAt: 0,
  ...over,
});

beforeEach(async () => {
  await db.recordings.clear();
  await db.audio.clear();
});

describe("merge", () => {
  it("adds recordings made on another device", async () => {
    await merge([light()]);
    const r = await db.recordings.get(light().id);
    expect(r).toMatchObject({ hasAudio: false, sync: "synced", source: "server" });
    expect(r?.server?.ai_title).toBe("Kitchen Remodeling Quote");
  });

  it("marks a pending recording synced once the server has its audio", async () => {
    await db.recordings.add(local({ sync: "pending", syncError: "Waiting" }));
    await merge([light({ status: "processing", stage: "transcribing" })]);
    expect(await db.recordings.get(light().id)).toMatchObject({ sync: "synced", syncError: null });
  });

  it("keeps a pending recording pending while the server is still waiting for its upload", async () => {
    await db.recordings.add(local({ sync: "pending" }));
    await merge([light({ status: "uploading" })]);
    expect((await db.recordings.get(light().id))?.sync).toBe("pending");
  });

  it("never throws away audio this phone holds when the server copy is gone", async () => {
    await db.recordings.add(local({ id: "a", sync: "synced", hasAudio: true, server: { ...light({ id: "a" }) } }));
    await db.audio.add({ id: "a", data: new Blob(["x"]) });
    await db.recordings.add(local({ id: "b", sync: "pending" }));
    await db.recordings.add(local({ id: "c", sync: "synced", hasAudio: false, server: { ...light({ id: "c" }) } }));
    await merge([]);
    expect(await db.recordings.get("a")).toMatchObject({ sync: "pending" });
    expect(await db.audio.get("a")).toBeDefined();
    expect(await db.recordings.get("b")).toBeDefined();
    expect(await db.recordings.get("c")).toBeUndefined();
  });

  it("uploads again when the server is waiting for audio this phone holds", async () => {
    await db.recordings.add(local({ sync: "synced", hasAudio: true, server: { ...light({ status: "ready" }) } }));
    await merge([light({ status: "uploading", ai_title: null })]);
    const r = await db.recordings.get(light().id);
    expect(r?.sync).toBe("pending");
  });

  it("keeps transcript and notes until a fresh full copy arrives", async () => {
    const id = light().id;
    await db.recordings.add(local({ sync: "synced" }));
    await storeFull([
      {
        ...light(),
        language: "eng",
        time_zone: "America/Los_Angeles",
        notes: null,
        transcript: { version: 1, segments: [{ speaker: "speaker_0", start: 0, end: 1, text: "Hi" }], speakers: ["speaker_0"], duration: 1 },
      },
    ]);
    await merge([light({ updated_at: "2026-10-18T05:00:00.000Z", title: "Renamed" })]);
    const r = await db.recordings.get(id);
    expect(r?.server?.title).toBe("Renamed");
    expect(r?.server?.transcript?.segments).toHaveLength(1);
    expect(needsDetail(r!)).toBe(true);
  });
});

describe("needsDetail", () => {
  it("fetches once notes or a failure exist and the copy is stale", () => {
    const at = (status: ServerLight["status"], stage: string | null, detailAt: string | null) =>
      needsDetail(local({ sync: "synced", server: { ...light({ status, stage }) }, detailAt }));
    expect(at("ready", null, null)).toBe(true);
    expect(at("ready", null, "2026-10-18T04:27:00.000Z")).toBe(false);
    expect(at("processing", "transcribing", null)).toBe(false);
    expect(at("processing", "notes", null)).toBe(true);
    expect(at("failed", "notes", null)).toBe(true);
    expect(at("uploaded", null, null)).toBe(false);
  });
});
