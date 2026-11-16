// Signing in and out on this phone, and what happens to what the phone holds
// when the account changes.
//
// The rule: audio that hasn't reached the server is never thrown away. Copies
// of what the server already has (transcripts, notes, cached audio) belong to
// the account that fetched them, so they leave the phone with that account.

import { api, ApiError, getSession, setSession, type AccountInfo, type Session } from "./api";
import { db, getSetting, setSetting } from "./db";
import { useSync } from "./sync";

/** The email whose recordings this phone holds copies of. */
const OWNER_SETTING = "accountEmail";

export function looksLikeEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.trim());
}

/** Removes this phone's copies of recordings the server holds. Recordings still waiting to upload stay. */
export async function clearServerCopies() {
  await db.transaction("rw", db.recordings, db.audio, async () => {
    const synced = await db.recordings.where("sync").equals("synced").toArray();
    for (const r of synced) {
      await db.recordings.delete(r.id);
      await db.audio.delete(r.id);
    }
  });
}

/** Finishes sign-in with the emailed code. Throws an ApiError the screen can show. */
export async function signIn(email: string, code: string): Promise<Session> {
  const { token, account } = await api.authVerify(email.trim().toLowerCase(), code);
  return await adopt(token, account);
}

/** Makes this the phone's account, whichever way the person signed in. */
async function adopt(token: string, account: AccountInfo): Promise<Session> {
  const previous = await getSetting<string | null>(OWNER_SETTING, null);
  if (previous && previous !== account.email) await clearServerCopies();
  await setSetting(OWNER_SETTING, account.email);
  const session: Session = { token, email: account.email, role: account.role };
  useSync.setState({ paused: false, lastError: null });
  setSession(session);
  return session;
}

export async function signOut() {
  if (getSession() && navigator.onLine) await api.signOut().catch(() => undefined);
  setSession(null);
  useSync.setState({ paused: false, lastError: null });
  await clearServerCopies();
}

/** How many recordings on this phone haven't reached the server yet. */
export async function waitingCount(): Promise<number> {
  return db.recordings.where("sync").equals("pending").count();
}

// ---------------------------------------------------------------- Google
//
// The whole page goes to Google and comes back, because that is the one way
// that works inside an app on the Home Screen (pop-ups don't). Google returns
// an ID token in the address, after the #, which never reaches any server but
// ours.

const GOOGLE_PENDING = "alien.googleSignIn";
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";

function random(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Where Google sends the person back to. It must match the address registered with Google exactly. */
export const googleReturnAddress = () => `${location.origin}/`;

/** The Google address for a sign-in this phone starts now. */
export function googleSignInUrl(clientId: string): string {
  const pending = { state: random(), nonce: random(), at: Date.now() };
  localStorage.setItem(GOOGLE_PENDING, JSON.stringify(pending));
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleReturnAddress(),
    response_type: "id_token",
    scope: "openid email",
    nonce: pending.nonce,
    state: pending.state,
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH}?${params}`;
}

/**
 * Finishes a Google sign-in when the page has just come back from Google.
 * Returns null when it hasn't, the session when it worked, and throws an
 * ApiError the screen can show when it didn't.
 */
export async function finishGoogleSignIn(): Promise<Session | null> {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const idToken = hash.get("id_token");
  const error = hash.get("error");
  if (!hash.get("state") || (!idToken && !error)) return null;
  // Take the token out of the address bar and history right away.
  history.replaceState(null, "", location.pathname + location.search);

  let pending: { state?: string; nonce?: string; at?: number } = {};
  try {
    pending = JSON.parse(localStorage.getItem(GOOGLE_PENDING) ?? "{}");
  } catch {
    // Treated as no sign-in in progress.
  }
  localStorage.removeItem(GOOGLE_PENDING);
  if (error) {
    if (error === "access_denied") return null; // they backed out
    throw new ApiError(400, "Google sign-in didn't finish. Try again.");
  }
  const fresh = typeof pending.at === "number" && Date.now() - pending.at < 15 * 60 * 1000;
  if (!idToken || !pending.nonce || pending.state !== hash.get("state") || !fresh) {
    throw new ApiError(400, "Google sign-in didn't finish. Try again.");
  }
  const { token, account } = await api.authGoogle(idToken, pending.nonce);
  return await adopt(token, account);
}
