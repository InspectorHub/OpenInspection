/**
 * Shared WebCrypto helpers for email-provider webhook signature verification.
 *
 * All helpers are transport-only and dependency-free. They never throw out of
 * the verify path — callers wrap their use in try/catch and fail closed (return
 * `false`). String comparisons used for secrets/signatures are constant-time.
 */

/** Decode a standard base64 string to raw bytes. Throws on malformed input. */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Encode raw bytes to a standard base64 string. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Encode raw bytes to lowercase hex. */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

/**
 * Constant-time string compare. Does NOT short-circuit on first mismatch — it
 * always walks the full length of the longer string so timing does not leak the
 * position of the first differing byte. Unequal lengths still return false, but
 * the loop runs to completion either way. Empty `a` or `b` returns false.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  }
  return diff === 0;
}

/** Compute HMAC-SHA256 over `message` with `keyBytes` and return the raw signature bytes. */
export async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as Uint8Array<ArrayBuffer>,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

/** True when `nowMs` is within ±300s of `tsSeconds`*1000. Non-finite ts → false. */
export function withinReplayWindow(tsSeconds: number, nowMs: number): boolean {
  if (!Number.isFinite(tsSeconds)) return false;
  return Math.abs(nowMs - tsSeconds * 1000) <= 300_000;
}

/** Normalize an unknown `email`-ish value to a non-empty string, else undefined. */
export function normalizeEmail(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) return value[0];
  return undefined;
}
