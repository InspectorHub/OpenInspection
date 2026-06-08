/**
 * Track I-a — magic-link token hygiene (DBA §14).
 *
 * Tokens are stored as SHA-256 hashes; the plaintext only ever lives in the
 * outbound link (and, for tier-2 families, in a KEK-sealed `token_enc` column
 * so the server can re-embed the SAME link later). Lookups hash the presented
 * token; a permanent plaintext-column fallback lazily upgrades legacy rows —
 * OSS self-hosts upgrade with zero ops steps (same philosophy as the legacy
 * secrets read path in config-crypto).
 */
import { logger } from './logger';
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

/** Cleared-plaintext sentinel for legacy NOT NULL + UNIQUE token columns. */
export function deadTokenSentinel(rowId: string): string {
    return `x:${rowId}`;
}

export async function resolveTokenRow<T extends object>(opts: {
    presented: string;
    byHash: (hash: string) => Promise<T | null | undefined>;
    byPlaintext: (token: string) => Promise<T | null | undefined>;
    /**
     * Persist token_hash (+ token_enc for tier 2) and clear the plaintext.
     * Failures are logged, never thrown.
     *
     * For tier-2 families the caller closes over the presented plaintext to
     * also seal token_enc:
     *   upgrade: (row, hash) => db.update(...).set({ tokenHash: hash, tokenEnc: await sealToken(presented, ...) })
     */
    upgrade: (row: T, hash: string) => Promise<void>;
}): Promise<T | null> {
    const hash = await hashToken(opts.presented);
    const byHash = await opts.byHash(hash);
    if (byHash != null) return byHash;
    const legacy = await opts.byPlaintext(opts.presented);
    if (legacy == null) return null;
    try {
        await opts.upgrade(legacy, hash);
    } catch (e) {
        logger.warn('token-hash.lazy-upgrade.failed', { error: e instanceof Error ? e.message : String(e) });
    }
    return legacy;
}
