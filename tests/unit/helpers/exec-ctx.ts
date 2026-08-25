import { afterEach } from 'vitest';

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
 * `waitUntil` is a real implementation, not a no-op: a spec that schedules
 * background work and never awaits it is a spec that asserts on a race.
 *
 * ## The settling is automatic, and it is automatic because asking did not work
 *
 * This helper used to hand back a `settle()` and rely on callers to await it.
 * Measured 2026-08-25: **five specs imported it and none of them called
 * `settle`**, while nine more hand-rolled `waitUntil: (p) => { void p.catch(…) }`
 * and never awaited anything either. Fourteen specs, zero settling — so the
 * detached promise the doc comment warned about was live in every one of them.
 *
 * What that costs is not a failing assertion, which is why it survived so long.
 * The background promise keeps running after its test file finishes, and when
 * it logs, the worker's RPC channel may already be closing:
 *
 *     EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending
 *
 * Vitest reports that as an unhandled rejection and **exits non-zero on a run
 * where every single test passed** — 8169 passed, 0 failed, exit 1. Observed on
 * one full run of three over an unchanged tree, so it is load-dependent, which
 * is the worst kind: it will not reproduce when you go looking, and it lands on
 * whichever spec loses the timing lottery that day.
 *
 * So the settle now registers itself. `makeExecutionContext()` is called at
 * module scope in every current caller, and a top-level `afterEach` applies to
 * the whole file — meaning every existing caller is fixed without touching it,
 * and a new one cannot forget. The returned `settle` is kept for specs that
 * need to await background work *mid-test* in order to assert on its effects;
 * awaiting it twice is harmless.
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

export function makeExecutionContext(): TestExecutionContext {
    let pending: Promise<unknown>[] = [];
    const ctx = {
        waitUntil(promise: Promise<unknown>) {
            pending.push(Promise.resolve(promise).catch(() => undefined));
        },
        passThroughOnException() {},
    } as unknown as ExecutionContext;

    const settle = async () => {
        // Drain rather than iterate once: a settling promise may itself call
        // `waitUntil` again, and a single `Promise.all` over the array as it
        // was would leave that second generation detached — the same bug one
        // level down.
        while (pending.length > 0) {
            const batch = pending;
            pending = [];
            await Promise.all(batch);
        }
    };

    // Guarded because `afterEach` is only registrable while a suite is being
    // collected. Every caller today builds this at module scope, but a spec
    // that built one INSIDE a test would otherwise fail here for a reason that
    // has nothing to do with what it was testing — and it would still get a
    // working `settle` to call by hand.
    try {
        afterEach(settle);
    } catch {
        // Not in a collectable scope; the caller owns settling.
    }

    return { ctx, settle };
}
