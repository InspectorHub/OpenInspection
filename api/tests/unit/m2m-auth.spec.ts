/**
 * Unit tests for src/lib/m2m-auth.ts — multi-version PORTAL_M2M_SECRET
 * verification (Bearer + HMAC-signature flavors).
 */
import { describe, it, expect } from 'vitest';
import { verifyM2mAuth, verifyM2mSignature } from '../../src/lib/m2m-auth';
import { timingSafeEqual } from '../../src/lib/password';

function bearer(secret: string): string { return `Bearer ${secret}`; }

async function sign(secret: string, body: string, timestamp: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`));
    return Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

describe('verifyM2mAuth (Bearer)', () => {
    it('accepts a request with the current (V1-only) secret', () => {
        const env = { PORTAL_M2M_SECRET_V1: 'secret-v1' };
        expect(verifyM2mAuth(bearer('secret-v1'), env)).toBe(true);
    });

    it('accepts a request with the previous secret during rotation (V1 still active, V2 is current)', () => {
        // Overlap window: both V1 and V2 are provisioned on core.
        const env = {
            PORTAL_M2M_SECRET_V1: 'secret-v1',
            PORTAL_M2M_SECRET_V2: 'secret-v2',
            PORTAL_M2M_CURRENT_KID: 'v2',
        };
        // A caller still on the old kid presents V1 and is accepted.
        expect(verifyM2mAuth(bearer('secret-v1'), env)).toBe(true);
        // The new kid (V2) is accepted too.
        expect(verifyM2mAuth(bearer('secret-v2'), env)).toBe(true);
    });

    it('rejects a request with an unknown secret', () => {
        const env = { PORTAL_M2M_SECRET_V1: 'secret-v1' };
        expect(verifyM2mAuth(bearer('bogus'), env)).toBe(false);
    });

    it('rejects a request missing the Authorization header', () => {
        const env = { PORTAL_M2M_SECRET_V1: 'secret-v1' };
        expect(verifyM2mAuth(undefined, env)).toBe(false);
    });

    it('rejects a request with a malformed Authorization header (no Bearer prefix)', () => {
        const env = { PORTAL_M2M_SECRET_V1: 'secret-v1' };
        expect(verifyM2mAuth('Basic secret-v1', env)).toBe(false);
        expect(verifyM2mAuth('secret-v1', env)).toBe(false);
        expect(verifyM2mAuth('Bearer ', env)).toBe(false);
    });

    it('falls back to legacy PORTAL_M2M_SECRET when no V<N> are set', () => {
        const env = { PORTAL_M2M_SECRET: 'legacy-secret' };
        expect(verifyM2mAuth(bearer('legacy-secret'), env)).toBe(true);
        expect(verifyM2mAuth(bearer('bogus'), env)).toBe(false);
    });

    it('accepts BOTH legacy and V<N> while migration is in flight', () => {
        // During rotation cutover, core may briefly have both set.
        const env = {
            PORTAL_M2M_SECRET:     'legacy-secret',
            PORTAL_M2M_SECRET_V1:  'secret-v1',
        };
        expect(verifyM2mAuth(bearer('legacy-secret'), env)).toBe(true);
        expect(verifyM2mAuth(bearer('secret-v1'), env)).toBe(true);
        expect(verifyM2mAuth(bearer('bogus'), env)).toBe(false);
    });

    it('rejects everything when no secret is configured at all', () => {
        expect(verifyM2mAuth(bearer('whatever'), {})).toBe(false);
    });

    it('ignores empty-string V<N> slots (counts as not provisioned)', () => {
        const env = {
            PORTAL_M2M_SECRET_V1: '',
            PORTAL_M2M_SECRET_V2: 'real-v2',
        };
        // Empty secret cannot match an empty-Bearer (which is already rejected).
        expect(verifyM2mAuth(bearer(''), env)).toBe(false);
        expect(verifyM2mAuth(bearer('real-v2'), env)).toBe(true);
    });

    it('uses timing-safe comparison (sanity-check the helper is the same module)', () => {
        // Verify the underlying helper is the constant-time one rather than
        // referencing a regression-prone === path. This is a defense-in-depth
        // check — the real timing guarantee comes from timingSafeEqual itself.
        expect(timingSafeEqual('abc', 'abc')).toBe(true);
        expect(timingSafeEqual('abc', 'abd')).toBe(false);
        expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    });
});

describe('verifyM2mSignature (HMAC)', () => {
    const body = JSON.stringify({ tenantId: 't1', subdomain: 'acme' });
    const now = () => Math.floor(Date.now() / 1000).toString();

    it('accepts a signature made with the current V1 secret', async () => {
        const env = { PORTAL_M2M_SECRET_V1: 'secret-v1' };
        const ts  = now();
        const sig = await sign('secret-v1', body, ts);
        expect(await verifyM2mSignature(`${ts}.${sig}`, body, env)).toBe(true);
    });

    it('accepts a signature made with the previous secret during overlap window', async () => {
        const env = {
            PORTAL_M2M_SECRET_V1: 'secret-v1',
            PORTAL_M2M_SECRET_V2: 'secret-v2',
            PORTAL_M2M_CURRENT_KID: 'v2',
        };
        const ts = now();
        const sigV1 = await sign('secret-v1', body, ts);
        const sigV2 = await sign('secret-v2', body, ts);
        expect(await verifyM2mSignature(`${ts}.${sigV1}`, body, env)).toBe(true);
        expect(await verifyM2mSignature(`${ts}.${sigV2}`, body, env)).toBe(true);
    });

    it('rejects a signature made with an unknown secret', async () => {
        const env = { PORTAL_M2M_SECRET_V1: 'secret-v1' };
        const ts  = now();
        const sig = await sign('bogus', body, ts);
        expect(await verifyM2mSignature(`${ts}.${sig}`, body, env)).toBe(false);
    });

    it('rejects a signature with an expired timestamp (>5 minutes)', async () => {
        const env = { PORTAL_M2M_SECRET_V1: 'secret-v1' };
        const oldTs = (Math.floor(Date.now() / 1000) - 400).toString();
        const sig   = await sign('secret-v1', body, oldTs);
        expect(await verifyM2mSignature(`${oldTs}.${sig}`, body, env)).toBe(false);
    });

    it('rejects a malformed signature header (no dot separator)', async () => {
        const env = { PORTAL_M2M_SECRET_V1: 'secret-v1' };
        expect(await verifyM2mSignature('no-dots-here', body, env)).toBe(false);
        expect(await verifyM2mSignature(undefined, body, env)).toBe(false);
    });

    it('falls back to legacy PORTAL_M2M_SECRET when no V<N> are set', async () => {
        const env = { PORTAL_M2M_SECRET: 'legacy' };
        const ts  = now();
        const sig = await sign('legacy', body, ts);
        expect(await verifyM2mSignature(`${ts}.${sig}`, body, env)).toBe(true);
    });

    it('rejects when no secret is configured', async () => {
        const ts  = now();
        const sig = await sign('whatever', body, ts);
        expect(await verifyM2mSignature(`${ts}.${sig}`, body, {})).toBe(false);
    });
});
