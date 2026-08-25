import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';
import { logger } from './logger';

/**
 * Run work that must outlive the response, without letting it outlive the
 * REQUEST.
 *
 * ## Why a bare floating promise is not the same thing
 *
 * `doWork().catch(() => {})` looks like fire-and-forget and is not. On
 * Cloudflare Workers, asynchronous work that has not been registered with
 * `executionCtx.waitUntil` is not guaranteed to run once the response has been
 * returned — the runtime is free to tear the request down around it. So a
 * floating promise is not "work that happens later"; it is **work that may
 * happen, silently, sometimes**, and the `.catch(() => {})` hides the evidence
 * either way.
 *
 * That is exactly how the automation triggers behaved before this helper: an
 * `invoice.created` or `agreement.signed` rule could simply not fire, with
 * nothing logged and nothing to find afterwards.
 *
 * ## Why the try/catch around waitUntil
 *
 * `c.executionCtx` THROWS when no execution context is present, which is the
 * case in several unit-test harnesses. Degrading to a plain floating promise
 * there is correct — a test has no request lifetime to extend — and mirrors the
 * guard already used in `server/api/sms.ts` and `server/api/inspections/core.ts`.
 *
 * ⚠️ Specs that stub `ExecutionContext` should use `makeExecutionContext()`
 * from `tests/unit/helpers/exec-ctx.ts`, which SETTLES what it is handed at
 * teardown. A stub that drops the promise leaves this work running past the end
 * of the test file, which is a spec asserting on a race.
 *
 * ## The label is not decoration
 *
 * It is what a failure is findable by. `.catch(() => {})` produced silence;
 * this produces one line naming the work and the tenant, which is the
 * difference between "automations seem flaky" and a query.
 */
export function fireAndForget(
    c: Context<HonoConfig>,
    work: Promise<unknown>,
    label: string,
    context: Record<string, unknown> = {},
): void {
    const guarded = work.catch((err: unknown) => {
        logger.error(
            `${label} failed`,
            context,
            err instanceof Error ? err : new Error(String(err)),
        );
    });
    try {
        c.executionCtx.waitUntil(guarded);
    } catch {
        // No execution context (unit-test harnesses). The work still runs; it
        // simply has no request lifetime to be attached to.
    }
}
