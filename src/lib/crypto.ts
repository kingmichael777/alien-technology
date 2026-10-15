/** WebCrypto helpers: PBKDF2-SHA256 key derivation, AES-GCM-256 with a fresh 12-byte IV per item. */
export const PBKDF2_ITERATIONS = 600_000;

export interface Sealed {
  iv: string;
  ct: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const u = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));

export async function deriveKey(passcode: string, salt: Uint8Array<ArrayBuffer>, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(passcode), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptBytes(key: CryptoKey, data: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<{ iv: Uint8Array<ArrayBuffer>; ct: ArrayBuffer }> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return { iv, ct };
}

export async function decryptBytes(key: CryptoKey, iv: Uint8Array<ArrayBuffer>, ct: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
}

export async function encryptJSON(key: CryptoKey, value: unknown): Promise<Sealed> {
  const { iv, ct } = await encryptBytes(key, enc.encode(JSON.stringify(value)));
  return { iv: b64(iv), ct: b64(ct) };
}

export async function decryptJSON<T>(key: CryptoKey, s: Sealed): Promise<T> {
  const buf = await decryptBytes(key, unb64(s.iv), unb64(s.ct));
  return JSON.parse(dec.decode(buf)) as T;
}

export interface KeyRef {
  v: 1;
  kdf: "PBKDF2-SHA256";
  cipher: "AES-GCM-256";
  salt: string;
  iterations: number;
  verifier: Sealed;
}

export const VERIFIER = "alien-technology/sealed-case";
