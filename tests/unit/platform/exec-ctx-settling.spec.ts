import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeExecutionContext } from '../helpers/exec-ctx';

/**
 * The helper 62 specs now depend on for teardown safety.
 *
 * Every assertion here is about a failure mode that is INVISIBLE in normal use:
 * background work settles, nothing warns, and the suite is green whether the
 * bounds work or not. So each bound is exercised against work built to trip it,
 * and the timings are asserted rather than described.
 */
describe('makeExecutionContext settles background work', () => {
    it('awaits what was handed to waitUntil', async () => {
        const { ctx, settle } = makeExecutionContext();
        let done = false;
        ctx.waitUntil((async () => { await Promise.resolve(); done = true; })());
        expect(done).toBe(false);
        await settle();
        expect(done).toBe(true);
    });

    it('drains work that schedules further work', async () => {
        // The reason settle re-reads `pending` instead of taking one snapshot.
        // A single Promise.all over the array as it stood would resolve while
        // the second generation was still running — detached, which is the
        // whole bug one level down.
        const { ctx, settle } = makeExecutionContext();
        const seen: number[] = [];
        ctx.waitUntil((async () => {
            seen.push(1);
            ctx.waitUntil((async () => { seen.push(2); })());
        })());
        await settle();
        expect(seen).toEqual([1, 2]);
    });

    it('swallows a rejecting background promise instead of leaving it unhandled', async () => {
        const { ctx, settle } = makeExecutionContext();
        ctx.waitUntil(Promise.reject(new Error('background boom')));
        await expect(settle()).resolves.toBeUndefined();
    });

    describe('the bounds', () => {
        afterEach(() => { vi.restoreAllMocks(); });

        it('abandons work that never settles, rather than hanging', async () => {
            // The failure this bound exists to prevent: awaiting a promise that
            // never resolves turns a stray teardown rejection into a hang that
            // names no cause. Asserted by the clock, because "it returned" is
            // also what a hang looks like right up until the suite times out.
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const { ctx, settle } = makeExecutionContext({ settleBudgetMs: 60, label: 'never-settles' });
            ctx.waitUntil(new Promise(() => { /* deliberately never resolves */ }));

            const started = performance.now();
            await settle();
            const elapsed = performance.now() - started;

            expect(elapsed).toBeLessThan(2_000);
            expect(warn).toHaveBeenCalledOnce();
            expect(warn.mock.calls[0][0]).toContain('did not settle');
            expect(warn.mock.calls[0][0]).toContain('never-settles');
        });

        it('survives a spec that froze the clock', async () => {
            // ⚠️ The trap that makes the bound above worth testing separately.
            // `vi.useFakeTimers()` replaces the global setTimeout and freezes
            // Date.now, so a deadline computed either way inside a faked spec
            // never arrives — the bound would BE the hang. The helper captures
            // the real setTimeout at module load, before any spec can fake it.
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            vi.useFakeTimers();
            try {
                const { ctx, settle } = makeExecutionContext({ settleBudgetMs: 60, label: 'faked-timers' });
                ctx.waitUntil(new Promise(() => { /* never resolves */ }));
                const started = performance.now();
                await settle();
                expect(performance.now() - started).toBeLessThan(2_000);
                expect(warn).toHaveBeenCalledOnce();
            } finally {
                vi.useRealTimers();
            }
        });

        it('stops work that reschedules itself forever', async () => {
            // The other way the drain loop can hang: each generation adds
            // another. Bounded by count rather than by time, because this one
            // makes progress the whole while and a time bound would let it burn
            // the entire budget first.
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const { ctx, settle } = makeExecutionContext({ maxGenerations: 4, label: 'self-rescheduling' });
            let generations = 0;
            // A SAFETY VALVE, not part of what is under test. The helper's cap
            // is what must stop this; the valve only ensures a broken cap fails
            // an assertion instead of hanging the suite forever. It sits far
            // above maxGenerations so it can never be what fires first.
            const VALVE = 50;
            const reschedule = () => {
                generations++;
                if (generations >= VALVE) return;
                // `await` before recursing: without it this recurses
                // synchronously and blows the stack before the helper's drain
                // loop ever gets a turn. (It did, on the first draft.)
                ctx.waitUntil((async () => { await Promise.resolve(); reschedule(); })());
            };
            reschedule();

            await settle();

            expect(warn).toHaveBeenCalledOnce();
            expect(warn.mock.calls[0][0]).toContain('rescheduled itself');
            // The helper stopped it, not the valve.
            expect(generations).toBeLessThan(VALVE);
        });
    });
});
