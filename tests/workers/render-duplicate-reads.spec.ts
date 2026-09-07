/**
 * What the page render actually asks the database, twice.
 *
 * A render fans out into ~13 in-process API calls sharing one request scope.
 * Statements they repeat cost D1 quota and CPU but NOT round trips — they are
 * already inside `Promise.all` waves — so this is a spec that REPORTS, and
 * ratchets only the number it can defend.
 *
 * ⚠️ Why it has to be authenticated, and why an unauthenticated probe is worse
 * than no probe: a request without a valid token 401s in the middleware chain,
 * before a single handler runs. A first attempt at this measured 9 statements
 * and 0 duplicates and looked like a clean bill of health. It had measured the
 * auth wall. `middleware-d1-floor.spec.ts` is unauthenticated ON PURPOSE for the
 * opposite reason — a 401 pays the full middleware floor, which is all it counts.
 */
import { env as testEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from '../../server/index';
import { createRequestScope, REQUEST_SCOPE } from '../../server/lib/request-scope';
import { buildKeyring, signJwt } from '../../server/lib/jwt-keyring';
import { applyMigrations as replayMigrations } from './migration-replay';

const migrationSql = import.meta.glob('../../migrations/*.sql', {
    query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

/**
 * Statements this render issues MORE THAN ONCE, counted as the excess (a
 * statement run 3× wastes 2). It is now ZERO: 39 statements, 39 distinct.
 *
 * ⚠️ A ratchet at zero is the strictest kind, and the point. Any new repeated
 * read fails this immediately, with the offending SQL and the endpoints that
 * issued it in the message. Do not raise it to make a change pass — the whole
 * value is that the next duplicate is visible the day it lands.
 *
 * How it got here, because each step removed a different KIND of problem:
 *   6 → `resolveOverridesFromDb` memoised on the request scope (three endpoints
 *       each read the acting user's full row).
 *   3 → the instrument started keying on bind PARAMETERS. `contactIdForRole`
 *       ×2 was never a duplicate: same SQL, different roles. See `capture`.
 *   2 → `getPeopleCard` takes its caller's inspection row, like
 *       `computePublishReadiness` — /hub loaded it then re-read it.
 *   1 → `PeopleService.listPeople` memoised, with the request env threaded from
 *       the DI middleware into the service tree, so /hub and /people share one
 *       read instead of one each.
 *   0 → nothing repeats.
 *
 * One thing this count is NOT, learned by getting it wrong: `tenants.slug` ×2
 * appears WITHOUT the warm-up below and vanishes with it, because
 * `inspectorPaletteMiddleware` resolves it KV-first and the warm-up populates
 * that entry. It was never a second D1 reader — memoising `resolveTenantSlug`
 * moved this number by exactly zero, which is why that memo was reverted rather
 * than kept on a hunch.
 */
const WASTED_BASELINE = 0;

const TENANT = 'dupe-tenant';
const USER = 'dupe-user';
const INSPECTION = 'dupe-inspection';

/** One issued statement: its SQL and the parameters it was bound with. */
interface Issued { sql: string; params: unknown[] }

/**
 * Records every prepared statement AND the parameters bound to it. Proxy rather
 * than a spread copy: D1Database carries `prepare` on the prototype.
 *
 * ⚠️ The parameters are not a nicety — without them this instrument LIES. It
 * originally keyed on SQL text alone, which made `contactIdForRole(…, 'buyer_agent')`
 * and `contactIdForRole(…, 'listing_agent')` look like the same statement run
 * twice. They are two different reads that happen to share a query shape, and
 * "deduplicating" them would have deleted one of the two answers.
 */
function capture(db: D1Database, onStatement: (s: Issued) => void): D1Database {
    const wrapStmt = (stmt: D1PreparedStatement, entry: Issued): D1PreparedStatement =>
        new Proxy(stmt, {
            get(t, p, r) {
                const v = Reflect.get(t, p, r);
                if (typeof v !== 'function') return v;
                return (...args: unknown[]) => {
                    // drizzle binds then executes; record what it bound.
                    if (p === 'bind') entry.params = args;
                    const out = (v as (...a: unknown[]) => unknown).apply(t, args);
                    return out && typeof out === 'object' && 'bind' in (out as object)
                        ? wrapStmt(out as D1PreparedStatement, entry)
                        : out;
                };
            },
        });
    return new Proxy(db, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (prop === 'prepare' && typeof value === 'function') {
                return (sql: string) => {
                    const entry: Issued = { sql, params: [] };
                    onStatement(entry);
                    return wrapStmt((value as (s: string) => D1PreparedStatement).call(target, sql), entry);
                };
            }
            if (prop === 'batch' && typeof value === 'function') {
                return (statements: unknown[]) => {
                    for (const _ of statements) onStatement({ sql: '<batch>', params: [] });
                    return (value as (s: unknown[]) => unknown).call(target, statements);
                };
            }
            return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
        },
    }) as D1Database;
}

const normalise = (sql: string) => sql.replace(/\s+/g, ' ').replace(/\?\d*/g, '?').trim();

/**
 * The identity of a read: its query shape AND what it asked for. Two statements
 * are the same read only when both match — see the warning on `capture`.
 */
const keyOf = (s: Issued) => `${normalise(s.sql)} :: ${JSON.stringify(s.params)}`;

const b = testEnv as unknown as { DB: D1Database };

describe('what one render asks the database twice', () => {
    let token: string;

    beforeAll(async () => {
        await replayMigrations(b.DB, migrationSql);
        const keyring = await buildKeyring(testEnv as never);
        token = await signJwt(
            { sub: USER, 'custom:tenantId': TENANT, 'custom:userRole': 'owner', role: 'owner' },
            keyring,
        );
        // Columns read off the Drizzle schema, not guessed: `tenants` has no
        // `name` at all, and `created_at` is notNull with no default.
        const now = Date.now();
        await b.DB.prepare("INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES (?, ?, ?)")
            .bind(TENANT, 'dupe-tenant', now).run();
        await b.DB.prepare(
            "INSERT OR IGNORE INTO users (id, tenant_id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).bind(USER, TENANT, 'dupe@example.com', 'x', 'Dupe User', 'owner', now).run();
        await b.DB.prepare(
            "INSERT OR IGNORE INTO inspections (id, tenant_id, property_address, date, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(INSPECTION, TENANT, '1 Test St', '2026-09-07', 'scheduled', now).run();
        // No tenant_configs row is seeded on purpose. One was added here while
        // chasing a 500, written as `INSERT ... (id, tenant_id)` with a
        // `.catch()` — and `tenant_configs` has no `id` column, so it threw
        // every run and the catch swallowed it. It never inserted anything, and
        // the endpoints answer 200 without it. `lint:seed-sql` is what caught
        // the dead statement; the 500 was positional and the warm-up fixed it.
    });

    it('reports every statement issued more than once under one scope', async () => {
        const seen: Issued[] = [];
        const scopedEnv = {
            ...testEnv,
            DB: capture(b.DB, (s) => seen.push(s)),
            [REQUEST_SCOPE]: createRequestScope(),
        } as unknown as Record<string, unknown>;

        // The endpoint set the inspector-portal loader fans out to.
        const paths = [
            '/api/auth/me',
            `/api/inspections/${INSPECTION}/hub`,
            `/api/inspections/${INSPECTION}/people`,
            `/api/inspections/${INSPECTION}/versions`,
            '/api/role-profiles',
            '/api/team/members',
            '/api/services',
            '/api/session/context',
        ];
        // Warm-up, deliberately OUTSIDE the capture and outside the scope.
        // Whichever endpoint runs first in a fresh fixture 500s — proven by
        // moving /api/auth/me from first to last, which moved the 500 onto
        // /hub instead. It is positional, not an endpoint defect. A 5xx stops
        // issuing statements partway, so without this the first endpoint's
        // reads go uncounted and every duplicate total is an undercount.
        await Promise.resolve(app.fetch(
            new Request('http://x/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }),
            { ...testEnv, [REQUEST_SCOPE]: createRequestScope() } as never,
        )).catch(() => null);

        // Sequential, sharing ONE scope. A render fans these out in parallel,
        // but parallel makes statements unattributable — and the memo scope is
        // what decides duplication, not the ordering, so the counts hold either
        // way while this ordering also says WHICH endpoint issued what.
        const statuses: (number | string)[] = [];
        const bodies: string[] = [];
        const owner = new Map<string, Set<string>>();
        for (const p of paths) {
            const before = seen.length;
            const r = await Promise.resolve(app.fetch(
                new Request(`http://x${p}`, { headers: { Authorization: `Bearer ${token}` } }),
                scopedEnv as never,
            )).catch(() => null);
            statuses.push(r?.status ?? 'threw');
            if (r && r.status >= 500) {
                bodies.push(`${p} -> ${(await r.text()).slice(0, 300)}`);
            }
            for (const issued of seen.slice(before)) {
                const k = keyOf(issued);
                if (!owner.has(k)) owner.set(k, new Set());
                owner.get(k)!.add(p);
            }
        }
        const authWalled = statuses.filter((s) => s === 401 || s === 403).length;

        const counts = new Map<string, number>();
        for (const s of seen) {
            const k = keyOf(s);
            counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        const dupes = [...counts.entries()].filter(([, n]) => n > 1).sort((a, x) => x[1] - a[1]);
        const repeated = dupes.reduce((acc, [, n]) => acc + (n - 1), 0);

        // The workerd pool does not forward console.log, so the report travels
        // in the assertion message — the one channel that always surfaces.
        const report = [
            `statuses=${statuses.join(',')} authWalled=${authWalled}`,
            ...bodies,
            `total=${seen.length} distinct=${counts.size} dupeGroups=${dupes.length} wastedStatements=${repeated}`,
            ...dupes.slice(0, 20).map(([sql, n]) => `x${n} [${[...(owner.get(sql) ?? [])].join(' + ')}] :: ${sql.slice(0, 90)}`),
        ].join(' ||| ');

        // The instrument, asserted before anything it measures.
        expect(seen.length, 'no statements captured — the capture proxy is broken, not the code')
            .toBeGreaterThan(0);
        // The failure mode that made the first attempt useless: if every call is
        // auth-walled, the handlers never ran and a low duplicate count is a lie.
        expect(authWalled, `every call was auth-walled (statuses ${statuses.join(',')}) — this measures the middleware, not the render`)
            .toBeLessThan(paths.length);

        // A 5xx endpoint stops issuing statements partway, so it makes the
        // duplicate count an UNDERCOUNT and the baseline below meaningless.
        // Assert the render's endpoints actually answered.
        const failed = statuses.filter((s) => typeof s === 'number' && s >= 500);
        expect(failed.length, `an endpoint 5xx'd, so the counts below are an undercount. ${report}`)
            .toBe(0);

        expect(repeated, `wasted statements grew past the baseline. ${report}`)
            .toBeLessThanOrEqual(WASTED_BASELINE);
    });
});
