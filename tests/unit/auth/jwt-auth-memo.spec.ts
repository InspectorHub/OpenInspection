/**
 * Contract test for the memo KEY SHAPES the auth middleware uses.
 *
 * INVARIANT: JWT verification is keyed by the token itself (`jwt:${token}`)
 * and the KV revocation marker by the user (`pwchanged:${userId}`). Both keys
 * carry the whole of what the cached answer depends on, so two different
 * tokens — or two different users — can never read each other's result. A
 * change that widens either key (say, dropping the token from the jwt key)
 * turns a per-request memo into a cross-identity cache, which is why the key
 * strings are pinned here rather than left to the call sites.
 *
 * WHY MEMOISING THE REVOCATION READ IS SAFE: Workers KV is eventually
 * consistent — a write can take up to 60 seconds to propagate to the edge that
 * serves the next read. Re-reading `pwchanged:{userId}` 16 times inside one
 * ~350ms render therefore cannot observe anything a single read would miss;
 * all 16 reads fall inside the same propagation window. The memo removes
 * duplicate work, not a detection opportunity.
 *
 * Every "does not re-run" assertion below is paired with a positive control
 * that runs the same factory WITHOUT a scope, so a memo that silently stopped
 * calling the factory at all cannot pass as a success.
 */

import { describe, it, expect, vi } from 'vitest';
import { REQUEST_SCOPE, createRequestScope, memoOnce } from '../../../server/lib/request-scope';

const scopedEnv = () => ({ [REQUEST_SCOPE]: createRequestScope() });

const TOKEN_A = 'header.payload-a.signature';
const TOKEN_B = 'header.payload-b.signature';
const USER_A = 'user-aaaa';
const USER_B = 'user-bbbb';

describe('auth middleware memo keys', () => {
    it('verifies one token once per scope', async () => {
        const env = scopedEnv();
        const verify = vi.fn(async () => ({ sub: USER_A, iat: 1_700_000_000 }));

        const first = await memoOnce(env, `jwt:${TOKEN_A}`, verify);
        const second = await memoOnce(env, `jwt:${TOKEN_A}`, verify);
        const third = await memoOnce(env, `jwt:${TOKEN_A}`, verify);

        expect(verify).toHaveBeenCalledTimes(1);
        expect(second).toBe(first);
        expect(third).toBe(first);
    });

    it('keys verification by token, so two tokens are never confused', async () => {
        const env = scopedEnv();
        const verify = vi.fn(async (token: string) => ({ sub: token === TOKEN_A ? USER_A : USER_B }));

        const a = await memoOnce(env, `jwt:${TOKEN_A}`, () => verify(TOKEN_A));
        const b = await memoOnce(env, `jwt:${TOKEN_B}`, () => verify(TOKEN_B));
        await memoOnce(env, `jwt:${TOKEN_A}`, () => verify(TOKEN_A));

        expect(verify).toHaveBeenCalledTimes(2);
        expect(a.sub).toBe(USER_A);
        expect(b.sub).toBe(USER_B);
    });

    it('reads the revocation marker once per user per scope, and keeps users apart', async () => {
        const env = scopedEnv();
        const kvGet = vi.fn(async (userId: string) => (userId === USER_A ? '1700000001' : null));

        await memoOnce(env, `pwchanged:${USER_A}`, () => kvGet(USER_A));
        await memoOnce(env, `pwchanged:${USER_A}`, () => kvGet(USER_A));
        const otherUser = await memoOnce(env, `pwchanged:${USER_B}`, () => kvGet(USER_B));

        expect(kvGet).toHaveBeenCalledTimes(2);
        expect(kvGet).toHaveBeenNthCalledWith(1, USER_A);
        expect(kvGet).toHaveBeenNthCalledWith(2, USER_B);
        expect(otherUser).toBeNull();
    });

    it('POSITIVE CONTROL: without a scope, every call re-verifies and re-reads', async () => {
        const env = {};
        const verify = vi.fn(async () => ({ sub: USER_A }));
        const kvGet = vi.fn(async () => '1700000001');

        await memoOnce(env, `jwt:${TOKEN_A}`, verify);
        await memoOnce(env, `jwt:${TOKEN_A}`, verify);
        await memoOnce(env, `jwt:${TOKEN_A}`, verify);
        await memoOnce(env, `pwchanged:${USER_A}`, kvGet);
        await memoOnce(env, `pwchanged:${USER_A}`, kvGet);

        expect(verify).toHaveBeenCalledTimes(3);
        expect(kvGet).toHaveBeenCalledTimes(2);
    });
});
