import { describe, it, expect } from 'vitest';
import { mintToken, hashToken, resolveTokenRow, deadTokenSentinel } from '../../../server/lib/token-hash';

describe('token-hash', () => {
    it('mintToken returns 43-char base64url with no padding', () => {
        const t = mintToken();
        expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(mintToken()).not.toBe(t);
    });

    it('hashToken is a stable 64-hex sha256', async () => {
        const h1 = await hashToken('abc');
        const h2 = await hashToken('abc');
        expect(h1).toBe(h2);
        expect(h1).toMatch(/^[0-9a-f]{64}$/);
        expect(await hashToken('abd')).not.toBe(h1);
    });

    it('deadTokenSentinel prefixes the row id', () => {
        expect(deadTokenSentinel('abc')).toBe('x:abc');
    });

    it('resolveTokenRow: hash hit wins, no upgrade call', async () => {
        const row = { id: 'r1' };
        let upgraded = false;
        const out = await resolveTokenRow({
            presented: 'tok',
            byHash: async () => row,
            byPlaintext: async () => null,
            upgrade: async () => { upgraded = true; },
        });
        expect(out).toBe(row);
        expect(upgraded).toBe(false);
    });

    it('resolveTokenRow: plaintext fallback hit triggers upgrade with the hash', async () => {
        const row = { id: 'r1' };
        let upgradeArgs: unknown[] | null = null;
        const out = await resolveTokenRow({
            presented: 'tok',
            byHash: async () => null,
            byPlaintext: async (t) => (t === 'tok' ? row : null),
            upgrade: async (r, h) => { upgradeArgs = [r, h]; },
        });
        expect(out).toBe(row);
        expect(upgradeArgs![0]).toBe(row);
        expect(upgradeArgs![1]).toBe(await hashToken('tok'));
    });

    it('resolveTokenRow: byHash returning undefined falls through to byPlaintext', async () => {
        const row = { id: 'r1' };
        let upgraded = false;
        const out = await resolveTokenRow({
            presented: 'tok',
            byHash: async () => undefined,
            byPlaintext: async () => row,
            upgrade: async () => { upgraded = true; },
        });
        expect(out).toBe(row);
        expect(upgraded).toBe(true);
    });

    it('resolveTokenRow: miss everywhere returns null; upgrade errors are swallowed', async () => {
        expect(await resolveTokenRow({
            presented: 'tok', byHash: async () => null, byPlaintext: async () => null, upgrade: async () => {},
        })).toBeNull();
        const row = { id: 'r1' };
        const out = await resolveTokenRow({
            presented: 'tok', byHash: async () => null, byPlaintext: async () => row,
            upgrade: async () => { throw new Error('db locked'); },
        });
        expect(out).toBe(row); // upgrade failure must not break the lookup
    });
});
