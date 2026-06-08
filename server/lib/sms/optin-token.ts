import { sealToken, openToken } from '../config-crypto';

/**
 * Track L (D6, path B) — self-describing SMS opt-in link token. DECISION: no new
 * DB table. We reuse the existing tier-2 token-sealing helper (`sealToken`/
 * `openToken` in config-crypto, the same AES-GCM/HKDF envelope agreement tokens
 * use). The token is `<tenantId>~<sealedContactId>`:
 *   - the tenantId is carried in cleartext (tenant ids are not secret) so the
 *     server can pick the AAD/KEK to open the sealed part;
 *   - the contactId is sealed under that tenant's AAD, so tampering with EITHER
 *     segment fails decryption (the AAD binds the ciphertext to the tenant).
 * No lookup row is needed: resolving the token yields (tenantId, contactId)
 * directly. The `~` delimiter never collides with the sealed blob, which is the
 * colon-delimited `t1:<iv>:<cipher>` form.
 */

const DELIM = '~';

export async function mintOptinToken(
    tenantId: string, contactId: string, jwtSecret: string,
): Promise<string> {
    const sealed = await sealToken(contactId, tenantId, jwtSecret);
    return `${tenantId}${DELIM}${sealed}`;
}

/** Returns { tenantId, contactId } or null on any format/AAD/key mismatch. */
export async function resolveOptinToken(
    token: string, jwtSecret: string, jwtSecretPrevious?: string,
): Promise<{ tenantId: string; contactId: string } | null> {
    const idx = token.indexOf(DELIM);
    if (idx <= 0) return null;
    const tenantId = token.slice(0, idx);
    const sealed = token.slice(idx + 1);
    if (!tenantId || !sealed) return null;
    try {
        const contactId = await openToken(sealed, tenantId, jwtSecret, jwtSecretPrevious);
        if (!contactId) return null;
        return { tenantId, contactId };
    } catch {
        return null;
    }
}
