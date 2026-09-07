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
 * Statements the covered renders issue MORE THAN ONCE, counted as the excess (a
 * statement run 3x wastes 2), summed across every render in `RENDERS`.
 *
 * Measured 2026-09-07: 103 statements across 5 renders, 103 distinct, ZERO
 * wasted. Every covered render repeats nothing.
 *
 * It was 4 when the coverage first went from one render to five, and all four
 * were one shape — a `tenant_configs` row read by more than one endpoint of the
 * same page. Three were `BrandingService` (`getBranding` is a bare SELECT *,
 * `getBrand` a narrow projection) reached from two endpoints, and once from a
 * single endpoint twice; the fourth was `select sms_mode` from /sms/config and
 * /sms/compliance. Both services now memoise the ROW on the request scope and
 * leave the derivation per-call.
 *
 * ⚠️ Lower it in the same commit that removes one; never raise it to make a
 * change pass. The whole value is that the next duplicate is visible the day it
 * lands, with its SQL and the endpoints that issued it in the failure message.
 *
 * How the covered renders got here, because each step removed a different KIND
 * of problem:
 *   - `resolveOverridesFromDb` memoised on the request scope (three endpoints
 *     each read the acting user's full row).
 *   - the instrument started keying on bind PARAMETERS. `contactIdForRole` x2
 *     was never a duplicate: same SQL, different roles. See `capture`.
 *   - `getPeopleCard` takes its caller's inspection row, like
 *     `computePublishReadiness` — /hub loaded it then re-read it.
 *   - `PeopleService.listPeople` memoised, with the request env threaded from
 *     the DI middleware into the service tree, so /hub and /people share one read.
 *
 * One thing this count is NOT, learned by getting it wrong: `tenants.slug` x2
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
const CONTACT = 'dupe-contact';

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
        // contact-detail's render needs a contact to read.
        await b.DB.prepare(
            "INSERT OR IGNORE INTO contacts (id, tenant_id, name, created_at) VALUES (?, ?, ?, ?)",
        ).bind(CONTACT, TENANT, 'Dupe Contact', now).run();
        // No tenant_configs row is seeded on purpose. One was added here while
        // chasing a 500, written as `INSERT ... (id, tenant_id)` with a
        // `.catch()` — and `tenant_configs` has no `id` column, so it threw
        // every run and the catch swallowed it. It never inserted anything, and
        // the endpoints answer 200 without it. `lint:seed-sql` is what caught
        // the dead statement; the 500 was positional and the warm-up fixed it.
    });

    /**
     * The renders this probe covers, and the endpoint set each one fans out to.
     *
     * Hand-curated by reading each loader, because the typed client's property
     * chain (`api.admin["tenant-config"].$get`) is not the URL — the mount point
     * is. A path guessed wrong would 404, issue almost no statements, and quietly
     * lower the duplicate count, so `no404` below is not a nicety: it is what
     * stops a typo from reading as an improvement.
     *
     * Extracted with:
     *   awk '/export async function loader/,/^}/' <route> | grep -oE '\bapi\.[^(]*\$get'
     */
    const RENDERS: Array<{ name: string; paths: string[] }> = [
        {
            name: 'inspector-portal',
            paths: [
                '/api/auth/me',
                `/api/inspections/${INSPECTION}/hub`,
                `/api/inspections/${INSPECTION}/people`,
                `/api/inspections/${INSPECTION}/versions`,
                '/api/role-profiles',
                '/api/team/members',
                '/api/services',
                '/api/session/context',
            ],
        },
        {
            name: 'contact-detail',
            paths: [`/api/contacts/${CONTACT}`, `/api/contacts/${CONTACT}/access`],
        },
        {
            name: 'calendar',
            paths: [
                '/api/auth/me',
                '/api/admin/members',
                // start/end are REQUIRED by ListCalendarItemsQuerySchema; without
                // them the route 400s, which short-circuits the handler and would
                // undercount this render.
                '/api/calendar/items?start=2026-09-01&end=2026-09-30',
            ],
        },
        {
            name: 'settings-booking',
            paths: [
                '/api/admin/members',
                '/api/admin/agreements',
                '/api/admin/branding',
                '/api/admin/booking-routing',
                '/api/admin/service-areas/all',
                '/api/admin/tenant-config',
            ],
        },
        {
            name: 'settings-communication',
            paths: [
                '/api/admin/communication',
                '/api/admin/tenant-config',
                // smsAdminRoutes mounts at /api/admin, so the routes declared
                // '/sms/config' resolve here -- not at a top-level /api/sms.
                '/api/admin/sms/config',
                '/api/admin/sms/compliance',
            ],
        },
    ];

    /** Fires one render's endpoint set under ONE shared request scope. */
    async function measureRender(paths: string[]) {
        const seen: Issued[] = [];
        const scopedEnv = {
            ...testEnv,
            DB: capture(b.DB, (s) => seen.push(s)),
            [REQUEST_SCOPE]: createRequestScope(),
        } as unknown as Record<string, unknown>;

        const statuses: number[] = [];
        const errors: string[] = [];
        const owner = new Map<string, Set<string>>();
        // Sequential, sharing ONE scope. A render fans these out in parallel, but
        // parallel makes statements unattributable — and the scope decides
        // duplication, not the ordering, so the counts hold either way while this
        // ordering also says WHICH endpoint issued what.
        for (const p of paths) {
            const before = seen.length;
            const r = await Promise.resolve(app.fetch(
                new Request(`http://x${p}`, { headers: { Authorization: `Bearer ${token}` } }),
                scopedEnv as never,
            )).catch(() => null);
            statuses.push(r?.status ?? 0);
            if (r && r.status >= 400) {
                errors.push(`${p} -> ${r.status} ${(await r.text()).slice(0, 160)}`);
            }
            for (const issued of seen.slice(before)) {
                const k = keyOf(issued);
                if (!owner.has(k)) owner.set(k, new Set());
                owner.get(k)!.add(p);
            }
        }

        const counts = new Map<string, number>();
        for (const s of seen) counts.set(keyOf(s), (counts.get(keyOf(s)) ?? 0) + 1);
        const dupes = [...counts.entries()].filter(([, n]) => n > 1).sort((a, x) => x[1] - a[1]);
        return {
            total: seen.length,
            distinct: counts.size,
            wasted: dupes.reduce((acc, [, n]) => acc + (n - 1), 0),
            dupes,
            owner,
            statuses,
            authWalled: statuses.filter((s) => s === 401 || s === 403).length,
            errors,
            // ANY 4xx/5xx short-circuits the handler and undercounts the render.
            failed: paths.filter((_, i) => (statuses[i] ?? 0) >= 400),
        };
    }

    it('reports duplicate reads for every covered render', async () => {
        // Warm-up, deliberately OUTSIDE every capture and scope. Whichever
        // endpoint runs first in a fresh fixture 500s — proven by moving
        // /api/auth/me from first to last, which moved the 500 onto /hub. It is
        // positional, not an endpoint defect. A 5xx stops issuing statements
        // partway, so without this the first endpoint's reads go uncounted.
        await Promise.resolve(app.fetch(
            new Request('http://x/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }),
            { ...testEnv, [REQUEST_SCOPE]: createRequestScope() } as never,
        )).catch(() => null);

        const lines: string[] = [];
        let grandTotal = 0;
        let grandWasted = 0;
        const broken: string[] = [];

        for (const render of RENDERS) {
            const m = await measureRender(render.paths);
            grandTotal += m.total;
            grandWasted += m.wasted;
            lines.push(
                `${render.name}: total=${m.total} distinct=${m.distinct} wasted=${m.wasted} statuses=${m.statuses.join(',')}`,
            );
            for (const [sql, n] of m.dupes.slice(0, 6)) {
                lines.push(`   x${n} [${[...(m.owner.get(sql) ?? [])].join(' + ')}] :: ${sql.slice(0, 80)}`);
            }
            // Each of these makes the render's count an UNDERCOUNT, so they are
            // failures of the instrument, not findings about the code.
            if (m.total === 0) broken.push(`${render.name}: captured NO statements`);
            if (m.authWalled === render.paths.length) broken.push(`${render.name}: every call auth-walled`);
            if (m.failed.length) broken.push(`${render.name}: ${m.errors.join(' ; ')}`);
        }

        const report = [`renders=${RENDERS.length} totalStatements=${grandTotal} totalWasted=${grandWasted}`, ...lines].join(' ||| ');

        // The instrument, asserted before anything it measures.
        expect(broken, `instrument problems make these counts an undercount. ${report}`).toEqual([]);
        expect(grandTotal, 'no statements captured at all — the capture proxy is broken, not the code')
            .toBeGreaterThan(0);

        expect(grandWasted, `wasted statements grew past the baseline. ${report}`)
            .toBeLessThanOrEqual(WASTED_BASELINE);
    });
});
