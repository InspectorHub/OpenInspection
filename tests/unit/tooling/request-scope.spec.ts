/**
 * The per-request memo primitive behind the in-process API fan-out.
 *
 * Two properties carry the whole design and neither is obvious from the call
 * shape: the memo caches the PROMISE rather than the value (the fan-out is
 * parallel, so a value cache would let every concurrent caller miss and
 * recompute — correct-looking code that saves nothing), and `memoOnce` falls
 * through to the factory when no scope is present, which is what keeps
 * external HTTP requests on unchanged per-request verification.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRequestScope, memoOnce, REQUEST_SCOPE } from '../../../server/lib/request-scope';

describe('RequestScope', () => {
    it('runs the factory once per key', async () => {
        const scope = createRequestScope();
        const fn = vi.fn(async () => 'v');
        expect(await scope.once('k', fn)).toBe('v');
        expect(await scope.once('k', fn)).toBe('v');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('shares the IN-FLIGHT promise with concurrent callers', async () => {
        // The 15 loader calls are issued in parallel. A value cache would let
        // all 15 miss and all 15 compute; only a promise cache dedupes them.
        const scope = createRequestScope();
        let resolve!: (v: string) => void;
        const fn = vi.fn(() => new Promise<string>((r) => { resolve = r; }));
        const both = Promise.all([scope.once('k', fn), scope.once('k', fn)]);
        resolve('v');
        expect(await both).toEqual(['v', 'v']);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('propagates rejection to every waiter and does not swallow it', async () => {
        const scope = createRequestScope();
        const fn = vi.fn(async () => { throw new Error('boom'); });
        await expect(scope.once('k', fn)).rejects.toThrow('boom');
        await expect(scope.once('k', fn)).rejects.toThrow('boom');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('keeps two scopes independent', async () => {
        const a = createRequestScope();
        const b = createRequestScope();
        const fn = vi.fn(async () => 'v');
        await a.once('k', fn);
        await b.once('k', fn);
        expect(fn).toHaveBeenCalledTimes(2);
    });
});

describe('memoOnce', () => {
    it('memoises when the env carries a scope', async () => {
        const env = { [REQUEST_SCOPE]: createRequestScope() };
        const fn = vi.fn(async () => 1);
        await memoOnce(env, 'k', fn);
        await memoOnce(env, 'k', fn);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    // POSITIVE CONTROL for every "does not re-run" assertion in later tasks:
    // without a scope the factory MUST still run every time. Without this,
    // a memoOnce that silently returned undefined would pass the tests above.
    it('runs every time when the env carries no scope', async () => {
        const fn = vi.fn(async () => 1);
        expect(await memoOnce({}, 'k', fn)).toBe(1);
        expect(await memoOnce({}, 'k', fn)).toBe(1);
        expect(await memoOnce(undefined, 'k', fn)).toBe(1);
        expect(fn).toHaveBeenCalledTimes(3);
    });
});
