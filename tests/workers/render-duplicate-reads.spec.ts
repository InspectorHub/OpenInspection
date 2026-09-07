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
 * statement run 3× wastes 2). Measured, not chosen: 6 before
 * `resolveOverridesFromDb` was memoised, 3 after (41 statements, 38 distinct).
 *
 * Lower it in the same commit that removes one. All three that remain belong to
 * the hub aggregate, and none is the same job:
 *   - full `inspections` row ×2 and `inspection_people.contact_id` ⋈ ×2 — both
 *     INSIDE /hub, so the fix is passing one result down, the way
 *     `computePublishReadiness` now takes its caller's row.
 *   - people ⋈ contacts ⋈ role_profiles ×2 — /hub and /people genuinely both
 *     need it; deduping means one of them serving the other.
 *
 * Two things this count is NOT, both learned by getting them wrong first:
 *   - `tenants.slug` ×2 appears WITHOUT the warm-up below and vanishes with it,
 *     because `inspectorPaletteMiddleware` resolves it KV-first and the warm-up
 *     populates that entry. It was never a second D1 reader. Memoising
 *     `resolveTenantSlug` moved this number by exactly zero, which is why that
 *     memo was reverted instead of kept on a hunch.
 *   - It is not a CPU emergency. These cost D1 quota and CPU but ZERO round
 *     trips — they already sit inside `Promise.all` waves — and production was
 *     measured 2026-09-07 at one `exceededCpu` per ~2000 invocations.
 */
const WASTED_BASELINE = 3;

const TENANT = 'dupe-tenant';
const USER = 'dupe-user';
const INSPECTION = 'dupe-inspection';

/** Records the SQL text of every prepared statement. Proxy rather than a spread
 *  copy: D1Database carries `prepare` on the prototype. */
function capture(db: D1Database, onStatement: (sql: string) => void): D1Database {
    const wrapStmt = (stmt: D1PreparedStatement): D1PreparedStatement =>
        new Proxy(stmt, {
            get(t, p, r) {
                const v = Reflect.get(t, p, r);
                if (typeof v !== 'function') return v;
                return (...args: unknown[]) => {
                    const out = (v as (...a: unknown[]) => unknown).apply(t, args);
                    return out && typeof out === 'object' && 'bind' in (out as object)
                        ? wrapStmt(out as D1PreparedStatement)
                        : out;
                };
            },
        });
    return new Proxy(db, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (prop === 'prepare' && typeof value === 'function') {
                return (sql: string) => {
                    onStatement(sql);
                    return wrapStmt((value as (s: string) => D1PreparedStatement).call(target, sql));
                };
            }
            if (prop === 'batch' && typeof value === 'function') {
                return (statements: unknown[]) => {
                    for (const _ of statements) onStatement('<batch>');
                    return (value as (s: unknown[]) => unknown).call(target, statements);
                };
            }
            return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
        },
    }) as D1Database;
}

const normalise = (sql: string) => sql.replace(/\s+/g, ' ').replace(/\?\d*/g, '?').trim();

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
        const seen: string[] = [];
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
            for (const sql of seen.slice(before)) {
                const k = normalise(sql);
                if (!owner.has(k)) owner.set(k, new Set());
                owner.get(k)!.add(p);
            }
        }
        const authWalled = statuses.filter((s) => s === 401 || s === 403).length;

        const counts = new Map<string, number>();
        for (const s of seen) {
            const k = normalise(s);
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
