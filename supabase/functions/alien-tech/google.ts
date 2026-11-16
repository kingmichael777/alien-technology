// Sign in with Google for alien-tech.
//
// The app sends the person to Google, and Google sends them back with an ID
// token: a short statement, signed by Google, of which Google account they
// are. This file checks that statement. Nothing here is secret: the client ID
// is public, and the token is checked against Google's published keys.
//
// Turned on by setting the Vault secret ALIEN_TECH_GOOGLE_CLIENT_ID to the
// client ID of a Google web OAuth client whose redirect address is the app.

import { config } from "./_shared/config.ts";
import { cleanEmail, decodeJwt, googleClaimsProblem } from "./lib.ts";
import { Problem } from "./store.ts";

const KEYS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const KEYS_FOR_MS = 60 * 60 * 1000;

type Jwk = JsonWebKey & { kid?: string };
let keys: { at: number; list: Jwk[] } | null = null;

async function googleKey(kid: string): Promise<CryptoKey | null> {
  // Google changes its keys now and then: an unknown key id means look again.
  for (const fresh of [false, true]) {
    if (fresh || !keys || Date.now() - keys.at > KEYS_FOR_MS) {
      const res = await fetch(KEYS_URL, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`google keys ${res.status}`);
      keys = { at: Date.now(), list: ((await res.json()) as { keys?: Jwk[] }).keys ?? [] };
    }
    const jwk = keys.list.find((k) => k.kid === kid);
    if (jwk) {
      return await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
        "verify",
      ]);
    }
  }
  return null;
}

export async function googleClientId(): Promise<string | null> {
  return (await config("ALIEN_TECH_GOOGLE_CLIENT_ID"))?.trim() || null;
}

const REFUSED = "Google sign-in didn't work. Try again.";

// The verified email behind a Google ID token, or a Problem the app can show.
export async function googleEmail(idToken: unknown, nonce: unknown): Promise<string> {
  const clientId = await googleClientId();
  if (!clientId) throw new Problem(400, "Google sign-in isn't set up yet.");
  if (typeof idToken !== "string" || typeof nonce !== "string" || nonce.length < 16) throw new Problem(401, REFUSED);
  const jwt = decodeJwt(idToken);
  if (!jwt || jwt.header.alg !== "RS256" || typeof jwt.header.kid !== "string") throw new Problem(401, REFUSED);

  let key: CryptoKey | null;
  try {
    key = await googleKey(jwt.header.kid);
  } catch (e) {
    console.error("[alien-tech] could not read Google's keys", e);
    throw new Problem(502, "Google couldn't be reached. Try again in a minute.");
  }
  if (!key) throw new Problem(401, REFUSED);
  const good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, jwt.signature, jwt.signed);
  if (!good) throw new Problem(401, REFUSED);

  const problem = googleClaimsProblem(jwt.claims, clientId, nonce, Date.now());
  if (problem) {
    console.warn("[alien-tech] google token refused:", problem);
    throw new Problem(401, REFUSED);
  }
  const email = cleanEmail(jwt.claims.email);
  if (!email) throw new Problem(401, REFUSED);
  return email;
}
