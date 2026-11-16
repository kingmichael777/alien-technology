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

describe("signing in with Google", async () => {
  const { finishGoogleSignIn, googleSignInUrl } = await import("@/lib/account");

  /** Starts a sign-in and returns what Google would be asked. */
  const start = () => new URL(googleSignInUrl("client-1")).searchParams;

  it("sends the person to Google with a fresh state and nonce", () => {
    const a = start();
    const b = start();
    expect(a.get("client_id")).toBe("client-1");
    expect(a.get("response_type")).toBe("id_token");
    expect(a.get("scope")).toBe("openid email");
    expect(a.get("redirect_uri")).toBe(`${location.origin}/`);
    expect(a.get("nonce")).toHaveLength(48);
    expect(a.get("nonce")).not.toBe(b.get("nonce"));
    expect(a.get("state")).not.toBe(b.get("state"));
  });

  it("does nothing on an ordinary page load", async () => {
    location.hash = "";
    expect(await finishGoogleSignIn()).toBeNull();
  });

  it("finishes sign-in when Google sends the person back, and clears the address", async () => {
    const calls: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ token: "t-1", account: { email: "dana@example.com", role: "member" } }), { status: 200 });
      }),
    );
    const asked = start();
    location.hash = `#state=${asked.get("state")}&id_token=the.id.token&authuser=0`;
    const session = await finishGoogleSignIn();
    expect(session).toEqual({ token: "t-1", email: "dana@example.com", role: "member" });
    expect(calls).toEqual([{ action: "auth_google", id_token: "the.id.token", nonce: asked.get("nonce") }]);
    expect(location.hash).toBe("");
    expect(getSession()?.email).toBe("dana@example.com");
  });

  it("refuses a token that doesn't belong to a sign-in this phone started", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    start();
    location.hash = "#state=someone-elses-state&id_token=the.id.token";
    await expect(finishGoogleSignIn()).rejects.toThrow("Google sign-in didn't finish");
    expect(fetched).not.toHaveBeenCalled();
    expect(location.hash).toBe("");
    // and the same token can't be replayed against the sign-in that was pending
    location.hash = "#state=someone-elses-state&id_token=the.id.token";
    await expect(finishGoogleSignIn()).rejects.toThrow();
    expect(getSession()).toBeNull();
  });

  it("stays quiet when the person backs out at Google", async () => {
    const asked = start();
    location.hash = `#state=${asked.get("state")}&error=access_denied`;
    expect(await finishGoogleSignIn()).toBeNull();
  });
});
