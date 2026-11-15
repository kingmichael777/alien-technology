import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearServerCopies, signIn, signOut } from "@/lib/account";
import { getSession, setSession } from "@/lib/api";
import { db, type RecordingRow } from "@/lib/db";

const row = (id: string, over: Partial<RecordingRow> = {}): RecordingRow => ({
  id,
  recordedAt: 1,
  durationMs: 1000,
  mimeType: "audio/mp4",
  size: 10,
  hasAudio: true,
  sync: "synced",
  syncError: null,
  source: "app",
  server: null,
  detailAt: null,
  createdAt: 0,
  ...over,
});

/** Answers the server's sign-in calls. */
function serverSays(account: { email: string; role: "master" | "member" }) {
  const calls: { action: string; session: string | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { action: string };
      calls.push({ action: body.action, session: (init.headers as Record<string, string>)["x-alien-session"] ?? null });
      const answer = body.action === "auth_verify" ? { token: `token-for-${account.email}`, account } : { ok: true };
      return new Response(JSON.stringify(answer), { status: 200 });
    }),
  );
  return calls;
}

beforeEach(async () => {
  localStorage.clear();
  await Promise.all([db.recordings.clear(), db.audio.clear(), db.settings.clear()]);
});

afterEach(() => vi.unstubAllGlobals());

describe("accounts on this phone", () => {
  it("keeps recordings that haven't uploaded when server copies are cleared", async () => {
    await db.recordings.bulkAdd([row("a"), row("b", { sync: "pending" }), row("c", { sync: "rejected" })]);
    await db.audio.bulkAdd([
      { id: "a", data: new Blob(["a"]) },
      { id: "b", data: new Blob(["b"]) },
    ]);
    await clearServerCopies();
    expect((await db.recordings.toArray()).map((r) => r.id).sort()).toEqual(["b", "c"]);
    expect((await db.audio.toArray()).map((r) => r.id)).toEqual(["b"]);
  });

  it("signs in and remembers the account", async () => {
    serverSays({ email: "dana@example.com", role: "member" });
    const session = await signIn(" Dana@Example.com ", "123456");
    expect(session).toEqual({ token: "token-for-dana@example.com", email: "dana@example.com", role: "member" });
    expect(getSession()).toEqual(session);
  });

  it("keeps what the phone holds when the same person signs in again", async () => {
    serverSays({ email: "dana@example.com", role: "member" });
    await signIn("dana@example.com", "123456");
    await db.recordings.add(row("a"));
    setSession(null); // the server signed this phone out
    await signIn("dana@example.com", "654321");
    expect(await db.recordings.count()).toBe(1);
  });

  it("never shows one person's recordings to the next person on the phone", async () => {
    serverSays({ email: "dana@example.com", role: "member" });
    await signIn("dana@example.com", "123456");
    await db.recordings.bulkAdd([row("hers"), row("waiting", { sync: "pending" })]);
    setSession(null);
    serverSays({ email: "sam@example.com", role: "member" });
    await signIn("sam@example.com", "123456");
    expect((await db.recordings.toArray()).map((r) => r.id)).toEqual(["waiting"]);
  });

  it("signing out tells the server, forgets the session and clears server copies", async () => {
    const calls = serverSays({ email: "dana@example.com", role: "member" });
    await signIn("dana@example.com", "123456");
    await db.recordings.bulkAdd([row("a"), row("b", { sync: "pending" })]);
    await signOut();
    expect(calls.at(-1)).toEqual({ action: "sign_out", session: "token-for-dana@example.com" });
    expect(getSession()).toBeNull();
    expect((await db.recordings.toArray()).map((r) => r.id)).toEqual(["b"]);
  });
});
