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
import { sha256Hex } from './sha256';

/**
 * Mint a new opaque capability token. Delegates to the canonical
 * `generateRandomToken` generator (32 bytes of crypto-random entropy →
 * base64url, ~43 chars, no padding).
 */
export function mintToken(): string {
    return generateRandomToken();
}

/**
 * The value stored in a `token_hash` column, for the token presented in a link.
 *
 * A NAME rather than a call to `sha256Hex`, because the lookup contract is what
 * matters at the call sites: every family hashes the presented token the same
 * way and matches on the column. The digest itself is the shared one -- this
 * used to be its own copy of the same six lines, and two spellings of a value
 * every stored row is matched against is two chances for one to drift.
 */
export async function hashToken(token: string): Promise<string> {
    return sha256Hex(token);
}

