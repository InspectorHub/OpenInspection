/**
 * Unit tests for resolveOwnerPreviewToken (server/api/public-report.ts).
 *
 * This is the security core of the owner-session preview fallback: it lets an
 * authenticated tenant user (inspector/admin) preview their own report on the
 * tokenless `/report/:tenant/:id` deep-link, WITHOUT widening the public,
 * token-gated endpoint to anyone else. It must fail closed on every bad input.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildKeyring, signJwt, type JwtKeyring } from '../../server/lib/jwt-keyring';
import { resolveOwnerPreviewToken } from '../../server/api/public-report';

interface Pem { privatePem: string; publicPem: string }

function bufToPem(buf: ArrayBuffer, label: string): string {
    const bin = String.fromCharCode(...new Uint8Array(buf));
    const b64 = btoa(bin);
    const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
    return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

async function genKeypair(): Promise<Pem> {
    const { privateKey, publicKey } = (await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
    )) as CryptoKeyPair;
    return {
        privatePem: bufToPem(await crypto.subtle.exportKey('pkcs8', privateKey), 'PRIVATE KEY'),
        publicPem:  bufToPem(await crypto.subtle.exportKey('spki',  publicKey),  'PUBLIC KEY'),
    };
}

describe('resolveOwnerPreviewToken', () => {
    let keyring: JwtKeyring;
    let otherKeyring: JwtKeyring; // a keyring whose keys are NOT trusted by `keyring`

    beforeAll(async () => {
        const v1 = await genKeypair();
        keyring = await buildKeyring({
            JWT_PRIVATE_KEY_V1: v1.privatePem,
            JWT_PUBLIC_KEY_V1:  v1.publicPem,
            JWT_CURRENT_KID: 'v1',
        });
        const fake = await genKeypair();
        otherKeyring = await buildKeyring({
            JWT_PRIVATE_KEY_V1: fake.privatePem,
            JWT_PUBLIC_KEY_V1:  fake.publicPem,
            JWT_CURRENT_KID: 'v1',
        });
    });

    it('returns the tenantId for a valid tenant-scoped session token', async () => {
        const token = await signJwt(
            { sub: 'user-1', 'custom:userRole': 'admin', 'custom:tenantId': 'tenant-A' },
            keyring,
        );
        expect(await resolveOwnerPreviewToken(token, keyring)).toBe('tenant-A');
    });

    it('returns null when no token is present', async () => {
        expect(await resolveOwnerPreviewToken(undefined, keyring)).toBeNull();
        expect(await resolveOwnerPreviewToken('', keyring)).toBeNull();
    });

    it('returns null when the keyring is unavailable', async () => {
        const token = await signJwt(
            { sub: 'user-1', 'custom:userRole': 'admin', 'custom:tenantId': 'tenant-A' },
            keyring,
        );
        expect(await resolveOwnerPreviewToken(token, undefined)).toBeNull();
    });

    it('returns null for a token signed by an untrusted key (bad signature)', async () => {
        const forged = await signJwt(
            { sub: 'user-1', 'custom:userRole': 'admin', 'custom:tenantId': 'tenant-A' },
            otherKeyring,
        );
        expect(await resolveOwnerPreviewToken(forged, keyring)).toBeNull();
    });

    it('returns null for a malformed token', async () => {
        expect(await resolveOwnerPreviewToken('not-a-jwt', keyring)).toBeNull();
    });

    it('returns null for an agent-class token (no tenant claim)', async () => {
        const token = await signJwt({ sub: 'agent-1', 'custom:userRole': 'agent' }, keyring);
        expect(await resolveOwnerPreviewToken(token, keyring)).toBeNull();
    });

    it('returns null for an unscoped token (role but no tenantId)', async () => {
        const token = await signJwt({ sub: 'user-2', 'custom:userRole': 'inspector' }, keyring);
        expect(await resolveOwnerPreviewToken(token, keyring)).toBeNull();
    });

    it('returns null when the session was invalidated AFTER the token was issued', async () => {
        const iat = Math.floor(Date.now() / 1000) - 100;
        const token = await signJwt(
            { sub: 'user-1', iat, 'custom:userRole': 'admin', 'custom:tenantId': 'tenant-A' },
            keyring,
        );
        // pwchanged timestamp (epoch seconds) is AFTER the token's iat → revoked.
        const kvGet = async (k: string) => (k === 'pwchanged:user-1' ? String(iat + 50) : null);
        expect(await resolveOwnerPreviewToken(token, keyring, kvGet)).toBeNull();
    });

    it('still resolves when the invalidation predates the token', async () => {
        const iat = Math.floor(Date.now() / 1000);
        const token = await signJwt(
            { sub: 'user-1', iat, 'custom:userRole': 'admin', 'custom:tenantId': 'tenant-A' },
            keyring,
        );
        // pwchanged BEFORE the token's iat → token is still valid.
        const kvGet = async (k: string) => (k === 'pwchanged:user-1' ? String(iat - 100) : null);
        expect(await resolveOwnerPreviewToken(token, keyring, kvGet)).toBe('tenant-A');
    });
});
