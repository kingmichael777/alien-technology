// Signing in and out on this phone, and what happens to what the phone holds
// when the account changes.
//
// The rule: audio that hasn't reached the server is never thrown away. Copies
// of what the server already has (transcripts, notes, cached audio) belong to
// the account that fetched them, so they leave the phone with that account.

import { api, getSession, setSession, type Session } from "./api";
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
