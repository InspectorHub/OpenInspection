/**
 * The jwt-auth memo, asserted against the MIDDLEWARE rather than against the
 * key string.
 *
 * `jwt-auth-memo.spec.ts` next door pins the key SHAPES, and that is all it
 * does: it calls `memoOnce` directly with its own `vi.fn()`, so it agrees with
 * the strings this author chose and would stay green if the call were deleted
 * from `jwt-auth.ts` altogether. This spec is the other half — it drives the
 * real middleware and counts what the middleware actually reaches for.
 *
 * It is needed here specifically because nothing else covers this point. The
 * D1 budget gate catches an unwired memo in branding, the tenant row and the
 * tenant config, since those are queries it can count; token verification is
 * CPU and its probe is unauthenticated, so both of these would go unnoticed.
 *
 * The middleware is allowed to fail after the verify call — classification of
 * a synthetic payload is not what is under test. What is under test is how many
 * times it reached `verifyJwt` and the revocation marker, so each case counts
 * those and ignores the outcome.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequestScope, REQUEST_SCOPE } from '../../../server/lib/request-scope';

const verifyJwt = vi.fn(async () => ({ sub: 'u1', iat: 2_000_000_000, 'custom:tenantId': 't1', role: 'admin' }));
vi.mock('../../../server/lib/jwt-keyring', () => ({
    verifyJwt: (...a: unknown[]) => verifyJwt(...(a as [])),
    buildKeyring: async () => ({ currentKid: 'v1', keys: new Map() }),
}));

const { jwtAuthMiddleware } = await import('../../../server/lib/middleware/jwt-auth');

const TOKEN = 'header.payload.signature';

/** Counts KV reads of the revocation marker; returns null so nothing is revoked. */
function countingCache(counts: { pwchanged: number }) {
    return {
        get: async (k: string) => { if (k.startsWith('pwchanged:')) counts.pwchanged += 1; return null; },
        put: async () => {},
    } as unknown as KVNamespace;
}

/**
 * One pass of the middleware over an authenticated API request. Swallows any
 * downstream failure: the counts are the subject, the request outcome is not.
 */
async function pass(env: Record<string, unknown>) {
    const vars = new Map<string, unknown>([['keyringPromise', Promise.resolve({ currentKid: 'v1', keys: new Map() })]]);
    const c = {
        env,
        req: { path: '/api/event-types', header: (n: string) => (n.toLowerCase() === 'authorization' ? `Bearer ${TOKEN}` : undefined), raw: new Request('http://x/api/event-types', { headers: { authorization: `Bearer ${TOKEN}` } }) },
        get: (k: string) => vars.get(k),
        set: (k: string, v: unknown) => vars.set(k, v),
        var: { keyringPromise: vars.get('keyringPromise') },
        header: () => {},
    };
    try { await (jwtAuthMiddleware as unknown as (ctx: unknown, n: () => Promise<void>) => Promise<void>)(c, async () => {}); } catch { /* outcome not under test */ }
}

describe('jwt-auth memo wiring', () => {
    beforeEach(() => verifyJwt.mockClear());

    it('verifies the token once and reads the marker once across a shared scope', async () => {
        const counts = { pwchanged: 0 };
        const env = { TENANT_CACHE: countingCache(counts), [REQUEST_SCOPE]: createRequestScope() };
        await pass(env);
        await pass(env);
        expect(verifyJwt, 'the same token verified twice in one request').toHaveBeenCalledTimes(1);
        expect(counts.pwchanged, 'the revocation marker read twice in one request').toBe(1);
    });

    // POSITIVE CONTROL. Without it, a middleware that had stopped reaching
    // either of these at all would satisfy the assertions above.
    it('verifies and reads every time when there is no scope', async () => {
        const counts = { pwchanged: 0 };
        const env = { TENANT_CACHE: countingCache(counts) };
        await pass(env);
        await pass(env);
        expect(verifyJwt).toHaveBeenCalledTimes(2);
        expect(counts.pwchanged).toBe(2);
    });
});
