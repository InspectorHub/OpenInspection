import { describe, it, expect } from 'vitest';
import { mintToken, hashToken } from '../../../server/lib/token-hash';

// This file used to cover two more exports: `deadTokenSentinel`, and
// `resolveTokenRow` — the hash-then-plaintext lookup that lazily upgraded a
// legacy row it matched. Both are gone with the last plaintext column that had
// anything for them to find, so the five specs that drove them went too. What
// remains is the whole of the module: mint a token, hash a token.

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
});
