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
 * background work and never awaits it is a spec that asserts on a race. Use
 * `settle()` to await everything that was handed to `waitUntil`.
 */

export interface TestExecutionContext {
    /** Pass this where a `ExecutionContext` is expected. */
    ctx: ExecutionContext;
    /** Await every promise handed to `ctx.waitUntil` so far. */
    settle: () => Promise<void>;
}

export function makeExecutionContext(): TestExecutionContext {
    const pending: Promise<unknown>[] = [];
    const ctx = {
        waitUntil(promise: Promise<unknown>) {
            pending.push(Promise.resolve(promise).catch(() => undefined));
        },
        passThroughOnException() {},
    } as unknown as ExecutionContext;
    return { ctx, settle: async () => { await Promise.all(pending); } };
}
