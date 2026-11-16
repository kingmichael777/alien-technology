// Accounts for alien-tech: who is asking, signing in with an emailed code,
// and the master's tools for adding, pausing and removing accounts.
//
// Nothing secret is stored as it is. A sign-in code is kept as an HMAC made
// with the service key, and a session token as its SHA-256.

import { config } from "./_shared/config.ts";
import { canonicalCode, cleanCode, cleanEmail, codeEmail, hex, inviteEmail, same } from "./lib.ts";
import { googleClientId, googleEmail } from "./google.ts";
import { Problem, SERVICE_KEY, serviceHeaders, SUPABASE_URL, uuid } from "./store.ts";

const DB = `${SUPABASE_URL}/rest/v1`;
// The sender can be changed without a deploy: set the Vault secret
// ALIEN_TECH_EMAIL_FROM to an address on a domain verified in Resend.
const DEFAULT_EMAIL_FROM = "Alien Technology <alien@mikerashid.com>";

const CODE_MINUTES = 10;
const MAX_TRIES = 5; // wrong guesses allowed per code
const MAX_CODES_PER_HOUR = 5; // codes sent to one email
const SESSION_DAYS = 180; // a phone unused this long signs in again
const HOUR_MS = 3600 * 1000;

export type Account = {
  id: string;
  email: string;
  role: "master" | "member";
  status: "active" | "paused";
  created_at: string;
  last_seen_at: string | null;
};

type CodeRow = {
  email: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  sent_count: number;
  window_started_at: string;
};

export function publicAccount(a: Account) {
  return { email: a.email, role: a.role };
}

// ---------------------------------------------------------------- database

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
  if (!res.ok) throw new DbError(res.status, await res.text());
  const body = await res.text();
  return (body ? JSON.parse(body) : []) as T;
}

class DbError extends Error {
  constructor(public status: number, body: string) {
    super(`database ${status}: ${body}`);
  }
}

const q = encodeURIComponent;

async function accountByEmail(email: string): Promise<Account | null> {
  const rows = await db<Account[]>(`alien_accounts?email=eq.${q(email)}&select=*`);
  return rows[0] ?? null;
}

async function accountById(id: string): Promise<Account | null> {
  const rows = await db<Account[]>(`alien_accounts?id=eq.${id}&select=*`);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- secrets

async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

async function codeHash(email: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SERVICE_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`alien-tech:code:${email}:${code}`)));
}

function newCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------- who is asking

let legacyHash: string | undefined;

// The account behind a request, or a Problem the app can show.
export async function authorize(req: Request): Promise<Account> {
  const token = req.headers.get("x-alien-session");
  if (token) {
    const rows = await db<{ last_used_at: string; account: Account | null }[]>(
      `alien_sessions?token_hash=eq.${await sha256(token)}&select=last_used_at,account:alien_accounts(*)`,
    );
    const session = rows[0];
    const account = session?.account;
    const age = session ? Date.now() - Date.parse(session.last_used_at) : Infinity;
    if (!account || age > SESSION_DAYS * 24 * HOUR_MS) throw new Problem(401, "Sign in again to continue.");
    if (account.status !== "active") throw new Problem(403, "This account is paused. Ask the owner to turn it back on.");
    if (age > HOUR_MS) {
      const now = new Date().toISOString();
      await db(`alien_sessions?token_hash=eq.${await sha256(token)}`, {
        method: "PATCH",
        body: JSON.stringify({ last_used_at: now }),
        headers: { Prefer: "return=minimal" },
      });
      await db(`alien_accounts?id=eq.${account.id}`, {
        method: "PATCH",
        body: JSON.stringify({ last_seen_at: now }),
        headers: { Prefer: "return=minimal" },
      });
    }
    return account;
  }

  // A phone still on the older app sends the shared access code. It is the
  // master's until the secret is removed from the server.
  const given = req.headers.get("x-alien-key");
  if (given) {
    legacyHash ??= (await config("ALIEN_TECH_KEY_SHA256"))?.trim().toLowerCase();
    if (legacyHash && same(await sha256(canonicalCode(given)), legacyHash)) {
      const rows = await db<Account[]>(`alien_accounts?role=eq.master&status=eq.active&select=*`);
      if (rows[0]) return rows[0];
    }
  }
  throw new Problem(401, "Sign in to continue.");
}

function mustBeMaster(me: Account) {
  if (me.role !== "master") throw new Problem(403, "Only the master account can manage accounts.");
}

// ---------------------------------------------------------------- signing in

const WRONG_CODE = "That code isn't right, or it expired. Check it or ask for a new one.";

// Sends a code when the email has an active account. The answer is the same
// either way, so this can't be used to find out who has an account.
export async function authStart(body: Record<string, unknown>) {
  const email = cleanEmail(body.email);
  if (!email) throw new Problem(400, "That doesn't look like an email address.");
  const account = await accountByEmail(email);
  if (!account || account.status !== "active") return { ok: true };

  const [prev] = await db<CodeRow[]>(`alien_login_codes?email=eq.${q(email)}&select=*`);
  const inWindow = prev && Date.now() - Date.parse(prev.window_started_at) < HOUR_MS;
  if (inWindow && prev.sent_count >= MAX_CODES_PER_HOUR) {
    throw new Problem(429, "Too many codes were sent to this email. Try again in an hour.");
  }

  const code = newCode();
  await db(`alien_login_codes?on_conflict=email`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      email,
      code_hash: await codeHash(email, code),
      expires_at: new Date(Date.now() + CODE_MINUTES * 60 * 1000).toISOString(),
      attempts: 0,
      sent_count: inWindow ? prev.sent_count + 1 : 1,
      window_started_at: inWindow ? prev.window_started_at : new Date().toISOString(),
    }),
  });

  const mail = codeEmail(code, CODE_MINUTES);
  if (!(await sendEmail(email, mail))) throw new Problem(502, "The code couldn't be sent. Try again in a minute.");
  return { ok: true };
}

export async function authVerify(body: Record<string, unknown>) {
  const email = cleanEmail(body.email);
  const code = cleanCode(body.code);
  if (!email || !code) throw new Problem(401, WRONG_CODE);

  const [row] = await db<CodeRow[]>(`alien_login_codes?email=eq.${q(email)}&select=*`);
  if (!row) throw new Problem(401, WRONG_CODE);
  if (row.attempts >= MAX_TRIES) throw new Problem(429, "Too many tries. Ask for a new code.");
  // Count the try first. It only lands if no other request counted one meanwhile.
  const counted = await db<CodeRow[]>(`alien_login_codes?email=eq.${q(email)}&attempts=eq.${row.attempts}`, {
    method: "PATCH",
    body: JSON.stringify({ attempts: row.attempts + 1 }),
  });
  if (counted.length === 0) throw new Problem(401, WRONG_CODE);
  if (Date.parse(row.expires_at) < Date.now()) throw new Problem(401, WRONG_CODE);
  if (!same(await codeHash(email, code), row.code_hash)) throw new Problem(401, WRONG_CODE);

  const account = await accountByEmail(email);
  if (!account || account.status !== "active") throw new Problem(401, WRONG_CODE);
  await db(`alien_login_codes?email=eq.${q(email)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });

  return await startSession(account);
}

// What the sign-in screen offers. Google appears once its client ID is set.
export async function authConfig() {
  return { google_client_id: await googleClientId() };
}

// Signs in with a Google ID token. Google has already proved who owns the
// email, so someone who isn't on the list is told so plainly.
export async function authGoogle(body: Record<string, unknown>) {
  const email = await googleEmail(body.id_token, body.nonce);
  const account = await accountByEmail(email);
  if (!account) {
    throw new Problem(403, `${email} doesn't have an Alien Technology account. Ask the owner to add it.`);
  }
  if (account.status !== "active") throw new Problem(403, "This account is paused. Ask the owner to turn it back on.");
  return await startSession(account);
}

async function startSession(account: Account) {
  const token = newToken();
  const now = new Date().toISOString();
  await db(`alien_sessions`, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ token_hash: await sha256(token), account_id: account.id }),
  });
  await db(`alien_accounts?id=eq.${account.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ last_seen_at: now }),
  });
  // Phones that haven't been used for a long time are signed out for good.
  const cutoff = new Date(Date.now() - SESSION_DAYS * 24 * HOUR_MS).toISOString();
  await db(`alien_sessions?last_used_at=lt.${q(cutoff)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } })
    .catch((e) => console.warn("[alien-tech] could not clear old sessions", e));

  return { token, account: publicAccount(account) };
}

export async function signOut(req: Request) {
  const token = req.headers.get("x-alien-session");
  if (token) {
    await db(`alien_sessions?token_hash=eq.${await sha256(token)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  }
  return { ok: true };
}

// ---------------------------------------------------------------- the master's tools

export async function accountsList(me: Account) {
  mustBeMaster(me);
  const accounts = await db<Account[]>(`alien_accounts?select=*&order=created_at.asc`);
  const usage = await db<{ owner_id: string; recordings: number; duration_ms: number }[]>(`rpc/alien_account_usage`, {
    method: "POST",
    body: "{}",
  });
  const used = new Map(usage.map((u) => [u.owner_id, u]));
  return {
    accounts: accounts.map((a) => ({
      id: a.id,
      email: a.email,
      role: a.role,
      status: a.status,
      created_at: a.created_at,
      last_seen_at: a.last_seen_at,
      recordings: Number(used.get(a.id)?.recordings ?? 0),
      duration_ms: Number(used.get(a.id)?.duration_ms ?? 0),
    })),
  };
}

export async function accountAdd(body: Record<string, unknown>, me: Account) {
  mustBeMaster(me);
  const email = cleanEmail(body.email);
  if (!email) throw new Problem(400, "That doesn't look like an email address.");
  if (await accountByEmail(email)) throw new Problem(409, "That email already has an account.");
  try {
    await db(`alien_accounts`, { method: "POST", body: JSON.stringify({ email, role: "member" }) });
  } catch (e) {
    if (e instanceof DbError && e.status === 409) throw new Problem(409, "That email already has an account.");
    throw e;
  }
  const emailed = await sendEmail(email, inviteEmail());
  return { ok: true, emailed };
}

export async function accountUpdate(body: Record<string, unknown>, me: Account) {
  mustBeMaster(me);
  const target = await accountById(uuid(body.id));
  if (!target) throw new Problem(404, "That account wasn't found.");
  if (target.role === "master") throw new Problem(400, "The master account can't be paused.");
  const status = body.status === "paused" ? "paused" : body.status === "active" ? "active" : null;
  if (!status) throw new Problem(400, "Nothing to change.");
  await db(`alien_accounts?id=eq.${target.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status }),
  });
  return { ok: true };
}

// Removes an account with everything it recorded.
export async function accountRemove(
  body: Record<string, unknown>,
  me: Account,
  removeRecording: (id: string) => Promise<void>,
) {
  mustBeMaster(me);
  const target = await accountById(uuid(body.id));
  if (!target) return { ok: true };
  if (target.role === "master") throw new Problem(400, "The master account can't be removed.");
  // Sign its phones out first so nothing new arrives while it is being cleared.
  await db(`alien_sessions?account_id=eq.${target.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  await db(`alien_login_codes?email=eq.${q(target.email)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  const recordings = await db<{ id: string }[]>(`alien_recordings?owner_id=eq.${target.id}&select=id`);
  for (const r of recordings) await removeRecording(r.id);
  await db(`alien_accounts?id=eq.${target.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  return { ok: true, recordings: recordings.length };
}

// ---------------------------------------------------------------- email

// Sent as plain text on purpose. Resend can only add its open-tracking pixel
// to HTML, and a tracking pixel in a one-line sign-in email reads as spam.
async function sendEmail(to: string, mail: { subject: string; text: string }): Promise<boolean> {
  const key = await config("RESEND_API_KEY");
  if (!key) {
    console.error("[alien-tech] RESEND_API_KEY is not set, so no email can be sent");
    return false;
  }
  const from = (await config("ALIEN_TECH_EMAIL_FROM"))?.trim() || DEFAULT_EMAIL_FROM;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from, to: [to], subject: mail.subject, text: mail.text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error("[alien-tech] email refused", res.status, (await res.text()).slice(0, 400));
      return false;
    }
    await res.body?.cancel();
    return true;
  } catch (e) {
    console.error("[alien-tech] email failed", e);
    return false;
  }
}
