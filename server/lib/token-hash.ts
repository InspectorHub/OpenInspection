/**
 * Track I-a — magic-link token hygiene (DBA §14).
 *
 * Tokens are stored as SHA-256 hashes; the plaintext only ever lives in the
 * outbound link (and, for tier-2 families, in a KEK-sealed `token_enc` column
 * so the server can re-embed the SAME link later). Every lookup hashes the
 * presented token and matches on `token_hash` — there is one way in.
 *
 * There used to be a second. `resolveTokenRow` tried the hash, then fell back to
 * a plaintext column and lazily upgraded whatever it matched, so a self-host
 * could cross over with no ops step. It did its job: across the three families
 * that used it, no un-upgraded row was left. Two of the plaintext columns are
 * now dropped and the third holds only an undistributed placeholder, so the
 * fallback had nothing left to match and the helper had nothing left to do.
 */
import { generateRandomToken } from './random-token';

/**
 * Mint a new opaque capability token. Delegates to the canonical
 * `generateRandomToken` generator (32 bytes of crypto-random entropy →
 * base64url, ~43 chars, no padding).
 */
export function mintToken(): string {
    return generateRandomToken();
}

export async function hashToken(token: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

