import { describe, it, expect } from 'vitest';
import { isTokenRevokedOrExpired, SIGNER_TOKEN_TTL_MS, SHARE_TOKEN_TTL_MS } from '../../../server/lib/token-ttl';

// IA-37 — content-bearing public tokens (signer links, share links) must fail
// closed once revoked or past expiry. NULL expiresAt = never expires.
describe('isTokenRevokedOrExpired (IA-37)', () => {
    const NOW = 1_000_000_000_000;

    it('treats a NULL expiresAt as never-expiring', () => {
        expect(isTokenRevokedOrExpired({ expiresAt: null, revokedAt: null }, NOW)).toBe(false);
        expect(isTokenRevokedOrExpired({}, NOW)).toBe(false);
    });

    it('is dead once revoked, regardless of expiry', () => {
        expect(isTokenRevokedOrExpired({ expiresAt: NOW + SIGNER_TOKEN_TTL_MS, revokedAt: new Date(NOW) }, NOW)).toBe(true);
        expect(isTokenRevokedOrExpired({ revokedAt: NOW - 1 }, NOW)).toBe(true);
    });

    it('is dead at or after the expiry instant', () => {
        expect(isTokenRevokedOrExpired({ expiresAt: NOW - 1 }, NOW)).toBe(true);
        expect(isTokenRevokedOrExpired({ expiresAt: NOW }, NOW)).toBe(true);
        expect(isTokenRevokedOrExpired({ expiresAt: NOW + 1 }, NOW)).toBe(false);
    });

    it('accepts both Date and epoch-ms expiresAt', () => {
        expect(isTokenRevokedOrExpired({ expiresAt: new Date(NOW - 1000) }, NOW)).toBe(true);
        expect(isTokenRevokedOrExpired({ expiresAt: new Date(NOW + 1000) }, NOW)).toBe(false);
    });

    it('share links outlive signer links by default', () => {
        expect(SHARE_TOKEN_TTL_MS).toBeGreaterThan(SIGNER_TOKEN_TTL_MS);
    });
});
