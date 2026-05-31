/**
 * Shared url-safe random token generator.
 *
 * Used by GuestInviteService + ObserverLinkService to mint opaque
 * capability tokens stored in the DB. 32 bytes of crypto-random
 * entropy → base64url (~43 chars, no padding) so the value is safe
 * to embed in URLs and cookies without further escaping.
 */
export function generateRandomToken(byteLength = 32): string {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
