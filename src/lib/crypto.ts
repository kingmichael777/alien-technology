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

/** The same passcode typed on another keyboard can arrive composed or decomposed; NFC makes both derive the same key. */
export async function deriveKey(passcode: string, salt: Uint8Array<ArrayBuffer>, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(passcode.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** `aad` is authenticated but not encrypted: a ciphertext only opens under the same label it was sealed with. */
const gcm = (iv: Uint8Array<ArrayBuffer>, aad?: string): AesGcmParams => (aad === undefined ? { name: "AES-GCM", iv } : { name: "AES-GCM", iv, additionalData: enc.encode(aad) });

export async function encryptBytes(key: CryptoKey, data: ArrayBuffer | Uint8Array<ArrayBuffer>, aad?: string): Promise<{ iv: Uint8Array<ArrayBuffer>; ct: ArrayBuffer }> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(gcm(iv, aad), key, data);
  return { iv, ct };
}

export async function decryptBytes(key: CryptoKey, iv: Uint8Array<ArrayBuffer>, ct: ArrayBuffer | Uint8Array<ArrayBuffer>, aad?: string): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(gcm(iv, aad), key, ct);
}

export async function encryptJSON(key: CryptoKey, value: unknown, aad?: string): Promise<Sealed> {
  const { iv, ct } = await encryptBytes(key, enc.encode(JSON.stringify(value)), aad);
  return { iv: b64(iv), ct: b64(ct) };
}

export async function decryptJSON<T>(key: CryptoKey, s: Sealed, aad?: string): Promise<T> {
  const buf = await decryptBytes(key, unb64(s.iv), unb64(s.ct), aad);
  return JSON.parse(dec.decode(buf)) as T;
}

// ---- media envelope: the Blob's MIME type travels inside the ciphertext ----
// Layout: "ATM1" | type length (uint16, big endian) | type (UTF-8) | original bytes
const MAGIC = [0x41, 0x54, 0x4d, 0x31];

export function packMedia(type: string, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const t = enc.encode(type.length > 255 ? "" : type);
  const out = new Uint8Array(new ArrayBuffer(6 + t.length + bytes.length));
  out.set(MAGIC, 0);
  out[4] = t.length >> 8;
  out[5] = t.length & 0xff;
  out.set(t, 6);
  out.set(bytes, 6 + t.length);
  return out;
}

/** Reverses packMedia. Bytes without the envelope come back whole with an empty type. */
export function unpackMedia(buf: ArrayBuffer | Uint8Array<ArrayBuffer>): { type: string; bytes: Uint8Array<ArrayBuffer> } {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u.length >= 6 && MAGIC.every((m, i) => u[i] === m)) {
    const n = (u[4]! << 8) | u[5]!;
    if (6 + n <= u.length) return { type: dec.decode(u.subarray(6, 6 + n)), bytes: u.subarray(6 + n) };
  }
  return { type: "", bytes: u };
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
