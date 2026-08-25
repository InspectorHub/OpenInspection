import { afterEach } from 'vitest';

/**
 * Captured at module load, BEFORE any spec installs fake timers.
 *
 * ⚠️ This is the whole reason the budget below works. `vi.useFakeTimers()`
 * replaces the global `setTimeout` and freezes `Date.now()`, so a deadline
 * computed either way inside a faked spec never arrives — the bound would be
 * the hang it exists to prevent. Several specs here do use fake timers.
 *
 * The module is imported at collection time, which is before any `beforeEach`
 * runs, so this is the real one.
 */
const realSetTimeout = globalThis.setTimeout;

/**
 * A test double for the Workers `ExecutionContext`.
 *
 * Two of its four members are host machinery a test cannot meaningfully build:
 * `props` (the RPC-caller properties bag) and `tracing` (the runtime's span
 * factory — `enterSpan` / `startActiveSpan`, both of which the host implements
 * against a live trace context). Every spec that needs a context needs the
 * other two, so the shape lives here once with the cast attached to the reason
 * instead of being re-invented per spec.
 *
 * ## What this is for
 *
 * A handler calls `waitUntil(somePromise())`. **The promise is created and runs
 * whatever the stub does** — the stub only decides whether anything can ever
 * await it. A stub that drops it leaves the work running past the end of the
 * test file, and when that work logs, its worker's RPC channel may already be
 * closing:
 *
 *     EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending
 *
 * Vitest reports that as an unhandled rejection and **exits non-zero on a run
 * where every test passed** — measured at 8169 passed, 0 failed, exit 1. It is
 * load-dependent, so it lands on whichever spec loses the timing lottery and
 * will not reproduce when you go looking.
 *
 * ## The settling is automatic, because asking did not work
 *
 * This helper used to return a `settle()` and rely on callers to await it.
 * Measured 2026-08-25: five specs imported it and NONE called `settle`, while
 * 47 more hand-rolled a stub that dropped the promise. So the settle registers
 * its own `afterEach`: every caller is covered without being touched, and a new
 * one cannot forget. `settle()` is still returned for specs that must await
 * background work mid-test in order to assert on its effects.
 *
 * ## Awaiting introduces its own failure mode, and it is bounded on purpose
 *
 * Awaiting work that used to be dropped turns "a stray rejection at teardown"
 * into "a hang" if that work never settles — a strictly worse trade, because a
 * hang surfaces as a vitest timeout that names no cause. Two ways it can hang,
 * and both are capped:
 *
 *   TIME — a promise that never settles (waiting on a faked timer that is never
 *   advanced, a mock that resolves nothing). Bounded by `settleBudgetMs`.
 *
 *   GENERATIONS — settling work that schedules more work, forever. The drain
 *   loop below re-reads `pending` precisely because a single `Promise.all` over
 *   the array as it stood would leave the second generation detached; that
 *   correctness fix is also an unbounded loop unless it is capped.
 *
 * On exceeding either bound the helper **warns and moves on rather than
 * failing**. Test infrastructure must not invent new failures: abandoning the
 * promise is exactly the old behaviour, so this is never worse than before the
 * change, and the warning names what to look at. A warning here is a real
 * finding — it means that spec has background work that genuinely never
 * finishes.
 */

export interface TestExecutionContext {
    /** Pass this where a `ExecutionContext` is expected. */
    ctx: ExecutionContext;
    /**
     * Await every promise handed to `ctx.waitUntil` so far.
     *
     * Calling this is OPTIONAL — teardown does it. Reach for it when a test
     * asserts on the RESULT of background work and must not race it.
     */
    settle: () => Promise<void>;
}

export interface TestExecutionContextOptions {
    /**
     * How long to wait for background work before abandoning it with a warning.
     * Generous by default: this is a backstop against a hang, not a performance
     * assertion, and a budget tight enough to fire on merely slow work would
     * make the suite flaky in a new direction.
     */
    settleBudgetMs?: number;
    /** How many times settling work may schedule further work before we stop. */
    maxGenerations?: number;
    /** Names the warning, so a spec that trips a bound is identifiable. */
    label?: string;
}

export function makeExecutionContext(options: TestExecutionContextOptions = {}): TestExecutionContext {
    const { settleBudgetMs = 5_000, maxGenerations = 10, label = 'waitUntil' } = options;
    let pending: Promise<unknown>[] = [];

    const ctx = {
        waitUntil(promise: Promise<unknown>) {
            // The catch is attached HERE, at hand-off, not at settle time. A
            // promise that rejects before anything awaits it is an unhandled
            // rejection in that window regardless of what settle does later.
            pending.push(Promise.resolve(promise).catch(() => undefined));
        },
        passThroughOnException() {},
    } as unknown as ExecutionContext;

    /** Resolves `'timeout'` on the real clock, whatever a spec did to timers. */
    const budget = () => new Promise<'timeout'>((resolve) => {
        realSetTimeout(() => resolve('timeout'), settleBudgetMs);
    });

    const settle = async () => {
        const expiry = budget();
        for (let generation = 0; pending.length > 0; generation++) {
            if (generation >= maxGenerations) {
                console.warn(
                    `[exec-ctx:${label}] background work rescheduled itself ${maxGenerations} times `
                    + 'and is being abandoned. Something in this spec schedules waitUntil work in a loop.',
                );
                break;
            }
            const batch = pending;
            pending = [];
            const outcome = await Promise.race([Promise.all(batch).then(() => 'settled' as const), expiry]);
            if (outcome === 'timeout') {
                console.warn(
                    `[exec-ctx:${label}] background work did not settle within ${settleBudgetMs}ms `
                    + 'and is being abandoned. It is now detached, exactly as it was before this '
                    + 'helper existed — which means it can still surface as a teardown rejection. '
                    + 'Find what never resolves rather than raising this budget.',
                );
                break;
            }
        }
        pending = [];
    };

    // Guarded because `afterEach` is only registrable while a suite is being
    // COLLECTED. Every caller builds this at module scope; one that built it
    // inside a test would otherwise fail here for a reason unrelated to what it
    // was testing — and would still get a working `settle` to call by hand.
    try {
        afterEach(settle);
    } catch {
        // Not in a collectable scope; the caller owns settling.
    }

    return { ctx, settle };
}
