/**
 * The last-active debounce map must not grow without bound.
 *
 * It is module-scoped, so it lives as long as the isolate, and it used to gain
 * one entry per distinct user and lose none — ever. Nothing in the request path
 * removed anything. On a shared saas isolate serving many workspaces, that is a
 * slow leak in the one place a Worker cannot afford one.
 *
 * Asserted through BEHAVIOUR rather than by reaching into the map: once the cap
 * is exceeded the entries are dropped, so a user who was inside their debounce
 * window flushes again. That is observable, and it is also the only externally
 * visible consequence of the sweep -- the extra flush this test detects is
 * precisely the cost the file accepts in exchange for the bound.
 */
import { describe, it, expect, vi } from 'vitest';
import { touchLastActiveMiddleware, MAX_TRACKED_USERS } from '../../../server/lib/middleware/touch-last-active';

/** Drives the middleware once for `userId`, returning whether it flushed. */
async function visit(userId: string, touch: ReturnType<typeof vi.fn>) {
    const before = touch.mock.calls.length;
    const c = {
        get: (k: string) => (k === 'user' ? { sub: userId } : undefined),
        var: { services: { user: { touchLastActive: touch } } },
        executionCtx: { waitUntil: (p: Promise<unknown>) => { void p; } },
    };
    await (touchLastActiveMiddleware as unknown as (ctx: unknown, n: () => Promise<void>) => Promise<void>)(c, async () => {});
    return touch.mock.calls.length > before;
}

describe('touch-last-active debounce map', () => {
    it('debounces a repeat visit, then drops entries once the cap is exceeded', async () => {
        const touch = vi.fn(async () => {});

        // Fill to exactly the cap. Every user is new, so every one flushes.
        for (let i = 0; i < MAX_TRACKED_USERS; i++) await visit(`u${i}`, touch);
        expect(touch).toHaveBeenCalledTimes(MAX_TRACKED_USERS);

        // The debounce still holds: u0 came back well inside 30s.
        expect(await visit('u0', touch), 'u0 is inside its debounce window').toBe(false);

        // One more DISTINCT user tips it past the cap. Nothing has expired, so
        // the expiry sweep frees nothing and the clear() fallback runs.
        expect(await visit('overflow', touch), 'a new user always flushes').toBe(true);

        // u0's entry went with it, so u0 flushes again despite being inside its
        // window. Bounded, at the cost of one extra write -- the trade the file
        // documents.
        expect(await visit('u0', touch), 'the map was dropped, so u0 flushes again').toBe(true);
    });

    it('never flushes for an anonymous request', async () => {
        const touch = vi.fn(async () => {});
        const c = {
            get: () => undefined,
            var: { services: { user: { touchLastActive: touch } } },
            executionCtx: { waitUntil: () => {} },
        };
        await (touchLastActiveMiddleware as unknown as (ctx: unknown, n: () => Promise<void>) => Promise<void>)(c, async () => {});
        expect(touch).not.toHaveBeenCalled();
    });
});
