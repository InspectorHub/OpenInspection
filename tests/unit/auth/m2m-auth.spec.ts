/**
 * M2M auth primitive (`server/lib/m2m-auth.ts`) — the HKDF-derived HMAC
 * handshake that gates every portal↔core Service-Binding call.
 *
 * The production smoke test can only observe "403 on a missing header". These
 * unit tests lock the security properties the guard actually relies on, which a
 * live probe cannot exercise safely:
 *   - round-trip: a freshly-signed header verifies
 *   - shared-key binding: a header signed under a different keyring is rejected
 *   - integrity: a tampered MAC is rejected
 *   - replay window: a validly-signed but stale header (> ±300s) is rejected
 *   - malformed input is rejected (never throws)
 *
 * This file (`m2m-auth.ts`) is kept byte-for-byte identical in apps/portal, so
 * the same properties hold for the portal side of the handshake.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { signM2mHeader, verifyM2mHeader, M2M_HEADER } from '../../../server/lib/m2m-auth';

const pem = (material: string) => `-----BEGIN PRIVATE KEY-----\n${btoa(material)}\n-----END PRIVATE KEY-----`;
const ENV_A = { JWT_CURRENT_KID: 'v1', JWT_PRIVATE_KEY_V1: pem('shared-key-material-AAAAAAAAAAAAAAAAAAAA') } as Record<string, string | undefined>;
const ENV_B = { JWT_CURRENT_KID: 'v1', JWT_PRIVATE_KEY_V1: pem('different-key-material-BBBBBBBBBBBBBBBB') } as Record<string, string | undefined>;

describe('m2m-auth handshake', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('exports the canonical header name', () => {
        expect(M2M_HEADER).toBe('x-portal-m2m');
    });

    it('verifies a freshly-signed header (round-trip)', async () => {
        const header = await signM2mHeader(ENV_A);
        expect(await verifyM2mHeader(ENV_A, header)).toBe(true);
    });

    it('rejects a header signed under a different shared keyring', async () => {
        const header = await signM2mHeader(ENV_A);
        expect(await verifyM2mHeader(ENV_B, header)).toBe(false);
    });

    it('rejects a tampered MAC', async () => {
        const header = await signM2mHeader(ENV_A);
        const dot = header.indexOf('.');
        const ts = header.slice(0, dot);
        const mac = header.slice(dot + 1);
        const last = mac.slice(-1);
        const flipped = mac.slice(0, -1) + (last === '0' ? '1' : '0');
        expect(await verifyM2mHeader(ENV_A, `${ts}.${flipped}`)).toBe(false);
    });

    it('rejects missing / malformed headers without throwing', async () => {
        expect(await verifyM2mHeader(ENV_A, undefined)).toBe(false);
        expect(await verifyM2mHeader(ENV_A, null)).toBe(false);
        expect(await verifyM2mHeader(ENV_A, '')).toBe(false);
        expect(await verifyM2mHeader(ENV_A, 'no-dot-here')).toBe(false);
        expect(await verifyM2mHeader(ENV_A, '.deadbeef')).toBe(false);
        expect(await verifyM2mHeader(ENV_A, 'notanumber.deadbeef')).toBe(false);
    });

    it('rejects a validly-signed but stale header (replay window > ±300s)', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-03T00:00:00Z'));
        const stale = await signM2mHeader(ENV_A);

        // +360s — beyond MAX_SKEW_SECONDS (300): the signature is still
        // cryptographically valid, but the window check must reject it.
        vi.setSystemTime(new Date('2026-06-03T00:06:00Z'));
        expect(await verifyM2mHeader(ENV_A, stale)).toBe(false);

        // Sanity: a header signed inside the window still verifies.
        const fresh = await signM2mHeader(ENV_A);
        vi.setSystemTime(new Date('2026-06-03T00:06:30Z')); // +30s from `fresh`
        expect(await verifyM2mHeader(ENV_A, fresh)).toBe(true);
    });
});
