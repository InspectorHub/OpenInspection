/**
 * The keyring is the most expensive thing the chain does that is not a query.
 *
 * A page render re-enters the global middleware chain 16 times through the
 * in-process API fan-out, and each pass imported the same PEM into a CryptoKey
 * again: 3.53ms/request of importKey measured 2026-09-06. The keyring depends
 * on nothing but `c.env`, so within one request there is nothing that could
 * change between passes -- which is what makes sharing it sound rather than
 * merely cheaper.
 *
 * The saving is invisible to the D1 statement gate (this is CPU, not queries),
 * so this spec is the evidence that the change took effect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequestScope, REQUEST_SCOPE } from '../../../server/lib/request-scope';

const buildKeyring = vi.fn(async (_env: unknown) => ({ currentKid: 'v1', keys: new Map() }));
vi.mock('../../../server/lib/jwt-keyring', () => ({ buildKeyring: (e: unknown) => buildKeyring(e) }));

import { contextBootstrap } from '../../../server/lib/middleware/context-bootstrap';

function ctx(env: Record<string, unknown>) {
    const vars = new Map<string, unknown>();
    return {
        env,
        set: (k: string, v: unknown) => vars.set(k, v),
        get: (k: string) => vars.get(k),
        var: Object.fromEntries(vars),
    } as never;
}

describe('contextBootstrap keyring memo', () => {
    beforeEach(() => buildKeyring.mockClear());

    it('builds the keyring once across calls sharing a scope', async () => {
        const env = { JWT_CURRENT_KID: 'v1', [REQUEST_SCOPE]: createRequestScope() };
        await contextBootstrap(ctx(env), async () => {});
        await contextBootstrap(ctx(env), async () => {});
        expect(buildKeyring).toHaveBeenCalledTimes(1);
    });

    it('hands every pass the same keyring promise', async () => {
        const env = { JWT_CURRENT_KID: 'v1', [REQUEST_SCOPE]: createRequestScope() };
        const first = ctx(env);
        const second = ctx(env);
        await contextBootstrap(first, async () => {});
        await contextBootstrap(second, async () => {});
        expect((second as unknown as { get: (k: string) => unknown }).get('keyringPromise'))
            .toBe((first as unknown as { get: (k: string) => unknown }).get('keyringPromise'));
    });

    // POSITIVE CONTROL -- without a scope the work must still happen. An
    // implementation that returned nothing at all would pass the tests above.
    it('builds it every time when there is no scope', async () => {
        const env = { JWT_CURRENT_KID: 'v1' };
        await contextBootstrap(ctx(env), async () => {});
        await contextBootstrap(ctx(env), async () => {});
        expect(buildKeyring).toHaveBeenCalledTimes(2);
    });
});
