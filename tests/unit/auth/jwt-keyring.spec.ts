/**
 * Unit tests for server/lib/jwt-keyring.ts — ES256 multi-version keyring.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildKeyring, signJwt, verifyJwt } from '../../../server/lib/jwt-keyring';

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
    const privBuf = await crypto.subtle.exportKey('pkcs8', privateKey);
    const pubBuf  = await crypto.subtle.exportKey('spki',  publicKey);
    return {
        privatePem: bufToPem(privBuf, 'PRIVATE KEY'),
        publicPem:  bufToPem(pubBuf,  'PUBLIC KEY'),
    };
}

function b64url(s: string): string {
    return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

describe('jwt-keyring', () => {
    let v1: Pem;
    let v2: Pem;

    beforeAll(async () => {
        v1 = await genKeypair();
        v2 = await genKeypair();
    });

    it('signs with current kid and verifies', async () => {
        const env = {
            JWT_PRIVATE_KEY_V1: v1.privatePem,
            JWT_PUBLIC_KEY_V1:  v1.publicPem,
            JWT_CURRENT_KID: 'v1',
        };
        const keyring = await buildKeyring(env);
        const token = await signJwt({ sub: 'user-1' }, keyring);

        // Header must declare ES256 + kid=v1
        const [headerB64] = token.split('.');
        const header = JSON.parse(Buffer.from(headerB64 as string, 'base64url').toString('utf8'));
        expect(header.alg).toBe('ES256');
        expect(header.kid).toBe('v1');
        expect(header.typ).toBe('JWT');

        const payload = await verifyJwt(token, keyring);
        expect(payload['sub']).toBe('user-1');
        expect(typeof payload['iat']).toBe('number');
    });

    it('stamps iat automatically if absent', async () => {
        const env = {
            JWT_PRIVATE_KEY_V1: v1.privatePem,
            JWT_PUBLIC_KEY_V1:  v1.publicPem,
            JWT_CURRENT_KID: 'v1',
        };
        const keyring = await buildKeyring(env);
        const before = Math.floor(Date.now() / 1000);
        const token = await signJwt({ sub: 'user-1' }, keyring);
        const after = Math.floor(Date.now() / 1000);
        const payload = await verifyJwt(token, keyring);
        const iat = payload['iat'] as number;
        expect(iat).toBeGreaterThanOrEqual(before);
        expect(iat).toBeLessThanOrEqual(after);
    });

    it('verifies a token signed with a kid that is no longer current (rotation case)', async () => {
        // Step 1: only v1 exists, sign a token with it.
        const envOnlyV1 = {
            JWT_PRIVATE_KEY_V1: v1.privatePem,
            JWT_PUBLIC_KEY_V1:  v1.publicPem,
            JWT_CURRENT_KID: 'v1',
        };
        const keyringOnlyV1 = await buildKeyring(envOnlyV1);
        const oldToken = await signJwt({ sub: 'user-1' }, keyringOnlyV1);

        // Step 2: v2 added, current rotated to v2. Old token still verifies.
        const envBothV2Current = {
            JWT_PRIVATE_KEY_V1: v1.privatePem,
            JWT_PUBLIC_KEY_V1:  v1.publicPem,
            JWT_PRIVATE_KEY_V2: v2.privatePem,
            JWT_PUBLIC_KEY_V2:  v2.publicPem,
            JWT_CURRENT_KID: 'v2',
        };
        const keyringBoth = await buildKeyring(envBothV2Current);
        const payload = await verifyJwt(oldToken, keyringBoth);
        expect(payload['sub']).toBe('user-1');

        // And new tokens use v2.
        const newToken = await signJwt({ sub: 'user-2' }, keyringBoth);
        const newHeader = JSON.parse(
            Buffer.from(newToken.split('.')[0] as string, 'base64url').toString('utf8'),
        );
        expect(newHeader.kid).toBe('v2');
    });

    it('rejects token whose kid is not in the keyring', async () => {
        const envOnlyV1 = {
            JWT_PRIVATE_KEY_V1: v1.privatePem,
            JWT_PUBLIC_KEY_V1:  v1.publicPem,
            JWT_CURRENT_KID: 'v1',
        };
        const envOnlyV2 = {
            JWT_PRIVATE_KEY_V2: v2.privatePem,
            JWT_PUBLIC_KEY_V2:  v2.publicPem,
            JWT_CURRENT_KID: 'v2',
        };
        const v1Keyring = await buildKeyring(envOnlyV1);
        const v2Keyring = await buildKeyring(envOnlyV2);

        const tokenSignedWithV2 = await signJwt({ sub: 'user-1' }, v2Keyring);
        await expect(verifyJwt(tokenSignedWithV2, v1Keyring)).rejects.toThrow(/kid/);
    });

    it('rejects a token with no kid header', async () => {
        const env = {
            JWT_PRIVATE_KEY_V1: v1.privatePem,
            JWT_PUBLIC_KEY_V1:  v1.publicPem,
            JWT_CURRENT_KID: 'v1',
        };
        const keyring = await buildKeyring(env);
        const header  = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT' }));
        const payload = b64url(JSON.stringify({ sub: 'user-1', iat: Math.floor(Date.now() / 1000) }));
        const malformed = `${header}.${payload}.fake-sig`;
        await expect(verifyJwt(malformed, keyring)).rejects.toThrow(/kid/);
    });

    it('rejects a token whose signature does not verify (cross-keyring forgery attempt)', async () => {
        // Forge: sign with v1 BUT swap kid to v2 in the header. Even if v2 is in the
        // keyring, the signature is over v1's input and won't verify against v2's pub.
        // (We achieve this by signing with v1 and then patching the header.)
        const envOnlyV1 = {
            JWT_PRIVATE_KEY_V1: v1.privatePem,
            JWT_PUBLIC_KEY_V1:  v1.publicPem,
            JWT_CURRENT_KID: 'v1',
        };
        const envBoth = {
            JWT_PRIVATE_KEY_V1: v1.privatePem,
            JWT_PUBLIC_KEY_V1:  v1.publicPem,
            JWT_PRIVATE_KEY_V2: v2.privatePem,
            JWT_PUBLIC_KEY_V2:  v2.publicPem,
            JWT_CURRENT_KID: 'v1',
        };
        const keyringV1 = await buildKeyring(envOnlyV1);
        const keyringBoth = await buildKeyring(envBoth);

        const goodToken = await signJwt({ sub: 'user-1' }, keyringV1);
        const [_origHeader, payloadB64, sigB64] = goodToken.split('.');
        const tamperedHeader = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'v2' }));
        const tamperedToken = `${tamperedHeader}.${payloadB64}.${sigB64}`;
        // v2 is in keyringBoth, kid lookup will succeed — but verify() must reject.
        await expect(verifyJwt(tamperedToken, keyringBoth)).rejects.toThrow();
    });

    it('throws when JWT_CURRENT_KID is missing', async () => {
        const env = {
            JWT_PRIVATE_KEY_V1: v1.privatePem,
            JWT_PUBLIC_KEY_V1:  v1.publicPem,
        };
        await expect(buildKeyring(env)).rejects.toThrow(/JWT_CURRENT_KID/);
    });

    it('throws when JWT_CURRENT_KID names a kid with no keypair', async () => {
        const env = {
            JWT_PRIVATE_KEY_V1: v1.privatePem,
            JWT_PUBLIC_KEY_V1:  v1.publicPem,
            JWT_CURRENT_KID: 'v9',
        };
        await expect(buildKeyring(env)).rejects.toThrow(/v9/);
    });

    it('skips incomplete keypairs (private without public, or vice versa)', async () => {
        // V2 has only private — should be skipped. V1 is fully provisioned and current.
        const env = {
            JWT_PRIVATE_KEY_V1: v1.privatePem,
            JWT_PUBLIC_KEY_V1:  v1.publicPem,
            JWT_PRIVATE_KEY_V2: v2.privatePem,
            JWT_CURRENT_KID: 'v1',
        };
        const keyring = await buildKeyring(env);
        expect(keyring.keys.has('v1')).toBe(true);
        expect(keyring.keys.has('v2')).toBe(false);
    });
});
