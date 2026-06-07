import { describe, it, expect } from 'vitest';
import { sealToken, openToken } from '../../server/lib/config-crypto';

describe('config-crypto sealToken/openToken', () => {
    it('round-trips under the current secret with t1: format', async () => {
        const enc = await sealToken('my-token', 'tenant-1', 'jwt-secret');
        expect(enc.startsWith('t1:')).toBe(true);
        expect(await openToken(enc, 'tenant-1', 'jwt-secret')).toBe('my-token');
    });

    it('is tenant-bound (AAD): other tenant cannot open', async () => {
        const enc = await sealToken('my-token', 'tenant-1', 'jwt-secret');
        await expect(openToken(enc, 'tenant-2', 'jwt-secret')).rejects.toThrow();
    });

    it('falls back to the previous secret during rotation', async () => {
        const enc = await sealToken('my-token', 'tenant-1', 'old-secret');
        expect(await openToken(enc, 'tenant-1', 'new-secret', 'old-secret')).toBe('my-token');
        await expect(openToken(enc, 'tenant-1', 'new-secret')).rejects.toThrow();
    });

    it('rejects malformed base64 in the ciphertext segment', async () => {
        await expect(openToken('t1:!!!:abc', 'tenant-1', 'secret')).rejects.toThrow();
    });
});
