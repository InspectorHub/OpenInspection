/**
 * Ratchets on the D1 statements the global middleware chain spends.
 *
 * Why this gate exists at all: a single page render fans out 15 in-process API
 * calls through the self-binding in `workers/app.ts`, and Hono runs the whole
 * `app.use('*')` chain on every one of them. Measured 2026-09-06, before any
 * memoisation, one `GET /inspections/:id` render cost 143 D1 statements and
 * 105 of them (73%) were that one chain running over and over. The saving is a
 * number only an instrument can see, so the instrument ships with the change.
 *
 * There are TWO numbers here and they move in opposite ways on purpose:
 *
 *   COLD_FLOOR   one call, NO request scope — the external HTTP path. It must
 *                NOT move. Memoisation is unreachable from outside by
 *                construction, so a drop here would mean the scope leaked into
 *                `toApi` and external requests had started sharing auth
 *                decisions. This is the security argument in executable form.
 *   FANOUT_TOTAL several calls sharing ONE scope — the in-process render path.
 *                This is the number each memoisation task lowers.
 *
 * A gate with only the cold number could never observe the effect it exists to
 * observe: with no scope in the env every `memoOnce` falls through to its
 * factory, so the cold count is unchanged by definition.
 *
 * The probe is unauthenticated on purpose. A 401 pays the same middleware floor
 * as a 200 — the expensive work is gated on the `/api/` path prefix, not on
 * whether a token verified — so the probe needs no session to measure the chain.
 *
 * `/api/event-types` is the probe because its own handler issued 0 statements
 * in the reference measurement, so its total IS the middleware floor. If that
 * endpoint ever grows its own query these numbers stop meaning "floor"; the
 * comments below say how to re-derive them.
 */
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { app } from '../../server/index';
import { createRequestScope, REQUEST_SCOPE } from '../../server/lib/request-scope';

/**
 * One unscoped call. Re-derive by counting statements for two endpoints whose
 * own query counts differ and taking the smaller total.
 *
 * This suite runs against a database with no application tables, so the
 * middleware queries fail and fall back rather than filling their KV caches.
 * That is why this reads 10 where a seeded dev worker reads 9 — the number is
 * environment-specific, which is exactly why it is measured here rather than
 * copied from a profile taken elsewhere.
 */
const COLD_FLOOR = 10;

/** How many in-process calls the fan-out probe issues, in parallel, as a render does. */
const FANOUT_CALLS = 3;

/**
 * All FANOUT_CALLS calls sharing one scope. Lower it in the same commit that
 * removes the work; never raise it without saying in the commit message what
 * bought the extra statement.
 */
const FANOUT_TOTAL = 26;

/**
 * Proxy rather than a spread copy: D1Database carries its methods on the
 * prototype, so `{ ...db }` yields an object with no `prepare` at all and the
 * request would fail in a way that reads like a middleware bug.
 */
function countingDb(db: D1Database, onStatement: (sql: string) => void): D1Database {
    return new Proxy(db, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (prop === 'prepare' && typeof value === 'function') {
                return (query: string) => { onStatement(query); return value.call(target, query); };
            }
            if (prop === 'batch' && typeof value === 'function') {
                return (statements: unknown[]) => {
                    for (const _ of statements) onStatement('<batch>');
                    return value.call(target, statements);
                };
            }
            return typeof value === 'function' ? value.bind(target) : value;
        },
    }) as D1Database;
}

const probe = () => new Request('http://x/api/event-types');

describe('global middleware D1 budget', () => {
    it('keeps the unscoped external path at its floor', async () => {
        let n = 0;
        const testEnv = { ...env, DB: countingDb(env.DB as D1Database, () => { n++; }) };
        const res = await app.fetch(probe(), testEnv as never);

        // Both numbers, always. A gate that prints only a verdict cannot be
        // audited, and a counter that silently broke would read as a triumph.
        console.log(`cold floor (no scope): measured=${n} ratchet=${COLD_FLOOR} status=${res.status}`);

        // 0 hits means the counter stopped counting, not that the chain got
        // free. Fail on it explicitly.
        expect(n, 'counter recorded no statements - the instrument is broken, not the code fixed').toBeGreaterThan(0);
        expect(n, `unscoped chain spent ${n} D1 statements, ratchet is ${COLD_FLOOR}`).toBeLessThanOrEqual(COLD_FLOOR);
    });

    it('shares middleware work across an in-process fan-out sharing one scope', async () => {
        let n = 0;
        const scope = createRequestScope();
        const testEnv = {
            ...env,
            DB: countingDb(env.DB as D1Database, () => { n++; }),
            [REQUEST_SCOPE]: scope,
        };

        // Issued in parallel, as a render issues them: that is what makes the
        // promise cache (rather than a value cache) the load-bearing detail.
        const results = await Promise.all(
            Array.from({ length: FANOUT_CALLS }, () => app.fetch(probe(), testEnv as never)),
        );

        console.log(`fan-out of ${FANOUT_CALLS} (one scope): measured=${n} ratchet=${FANOUT_TOTAL} statuses=${results.map((r) => r.status).join(',')}`);

        expect(n, 'counter recorded no statements - the instrument is broken, not the code fixed').toBeGreaterThan(0);
        expect(n, `fan-out of ${FANOUT_CALLS} spent ${n} D1 statements, ratchet is ${FANOUT_TOTAL}`).toBeLessThanOrEqual(FANOUT_TOTAL);
    });
});
