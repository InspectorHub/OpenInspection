/**
 * A portal sign-in link works once.
 *
 * The link is a signed token that is valid on its own until it expires, which means anyone who sees it again (a forwarded email, a log, a
 * browser history) can sign in with it for as long as it lives. A first redemption therefore leaves a marker keyed by the SHA-256 of the
 * link, kept as long as the link could still be valid; a second redemption finds the marker and is refused like an expired link. The store is
 * a key-value namespace that is eventually consistent and has no compare-and-set, so this is a best-effort guard, not a lock. It guarantees that a link
 * reused one after the other from the same location is refused, and that an unreadable store refuses (fail closed) rather than letting a link
 * through unchecked. It does NOT guarantee that two simultaneous redemptions cannot both pass, nor that a reuse from another location is refused
 * before the marker has propagated; the link's short lifetime and the per-caller limit bound that window.
 */
async function sha256Hex(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** True for the first redemption of this link, false for any later one (or when the store cannot be used). */
export async function claimMagicLinkOnce(kv: KVNamespace | undefined, link: string, lifetimeSeconds: number): Promise<boolean> {
    if (!kv) return false;
    try {
        const key = `portal-ml-used:${await sha256Hex(link)}`;
        if (await kv.get(key)) return false;
        // KV accepts a lifetime of at least 60 seconds.
        await kv.put(key, '1', { expirationTtl: Math.max(60, lifetimeSeconds) });
        return true;
    } catch {
        return false;
    }
}
