/**
 * Table-driven idempotency coverage (#107).
 *
 * One suite drives the REAL app over every mutating route the coverage gate's
 * walker finds, and asserts the guard claimed an idempotency key. It replaces
 * per-route replay specs for the reach-and-key half of the question.
 *
 * WHAT THIS PROVES, and what it does not:
 *   - PROVES the guard is mounted ahead of each route and claims a key when a
 *     tenant is on the context. That is COVERAGE, not correct replay.
 *   - Does NOT prove a replay returns the stored response. That needs a
 *     business-valid body per route, which is the expensive part and the reason
 *     this suite exists at all. The surviving `*-replay.spec.ts` files remain
 *     the end-to-end proof that the mechanism works through a real route.
 *   - The JWT layer is STUBBED, so tenant PRESENCE is assumed, not proved.
 *     Which routes a tenant actually reaches stays a hand-classified question;
 *     that judgement lives in the baseline's `uncoveredByDesign`. The two
 *     negative controls at the bottom keep the tenant branch itself honest.
 *
 * Three mechanics make it cheap, each load-bearing:
 *   1. No valid body is needed: the guard is mounted globally (server/index.ts,
 *      `app.use('*', idempotencyGuard)`) AHEAD of every route's zod validation.
 *   2. No handler runs: `claimKey` is mocked to return a `done` claim, so the
 *      middleware returns the replay Response and never calls `next()`. No DB
 *      fixture, no business-valid payload, for any route.
 *   3. `app.use('*')` runs even for a path that matches NO route, so
 *      "claimKey was called" alone would pass vacuously. The anti-vacuity check
 *      is a cross-reference against Hono's own routing table.
 *
 * ⚠️ WHY `{ APP_MODE: 'saas' }` IS PASSED AS ENV, and why that is not a
 * harness detail. `app.request(path, init)` with no env leaves `c.env`
 * undefined and `contextBootstrap` → `getDeploymentProfile(c.env)` throws, so
 * every row 500s. Passing `{}` resolves the STANDALONE profile — and in
 * standalone `tenantRouter` runs BEFORE the guard and stamps a fixed tenant on
 * EVERY request, so the guard's `if (!tenantId) return next()` pass-through can
 * never fire and the no-tenant negative control below would be a lie. Under
 * `saas` the stubbed JWT layer owns the tenant, which is what this suite means
 * to model. The consequence is worth stating plainly: the routes the gate
 * classifies as by-design-unguarded are unguarded IN SAAS, and are claimed
 * under the fixed tenant in standalone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// ⚠️ The factory RETURNS a sentinel. A bare `vi.fn()` yields `undefined`, the
// guard passes that as claimKey's first argument, and `expect.anything()`
// refuses undefined — so every row failed on the db handle rather than on the
// claim. Returning an object also makes the assertion prove the guard built a
// handle from `c.env.DB` at all.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn(() => ({ __mockDb: true })) }));
vi.mock('../../../server/lib/idempotency/store', () => ({
    claimKey: vi.fn(async () => ({ state: 'done', status: 200, body: '{"replayed":true}' })),
    completeKey: vi.fn(),
    releaseKey: vi.fn(),
}));

/**
 * The tenant seam. Stubbing the JWT middleware is what lets one table cover
 * every route without minting a token per row; it is also the reason this suite
 * proves reach + key rather than reachability-by-a-real-tenant.
 */
const stubTenant = { id: 'tenant-a' as string | null };
vi.mock('../../../server/lib/middleware/jwt-auth', () => ({
    jwtAuthMiddleware: async (
        c: { set: (k: string, v: unknown) => void },
        next: () => Promise<void>,
    ) => {
        if (stubTenant.id) c.set('tenantId', stubTenant.id);
        await next();
    },
}));

const { app } = await import('../../../server/index');
const { claimKey } = await import('../../../server/lib/idempotency/store');

type Collected = Array<{ route: string; file: string }>;

// Loaded with a top-level dynamic import rather than a static one: vitest's
// esbuild transform throws a SyntaxError on these .mjs gate scripts. It must be
// top-level (not beforeAll) because `it.each` needs the table at COLLECTION
// time, not at run time.
const scriptPath = path.resolve(
    import.meta.dirname ?? path.join(process.cwd()),
    '../../../scripts/check-idempotency-coverage.mjs',
);
const { collect } = (await import(/* @vite-ignore */ pathToFileURL(scriptPath).href)) as {
    collect: () => Collected;
};

/**
 * '{id}' (the walker's OpenAPI vocabulary) → ':id' (Hono's). Both sides of the
 * anti-vacuity check go through this ONE function, which is where the
 * 27-colon-vs-155-brace split in the baseline dies.
 */
const honoPath = (p: string) => p.replace(/\{([^}]+)\}/g, ':$1');

/** ':key{.+}' → ':key' — Hono's routing table keeps the regex, the walker never had one. */
const stripParamRegex = (p: string) => p.replace(/(:\w+)\{[^}]*\}/g, '$1');

/** A concrete request path: every ':param' becomes a literal segment. */
const concretize = (p: string) => stripParamRegex(p).replace(/:(\w+)/g, 'x');

interface Row {
    /** 'POST /api/x/{id}' exactly as the gate classifies it. */
    route: string;
    method: string;
    /** Hono-normalized, regex-stripped: 'POST /api/x/:id'. */
    normalized: string;
    /** A path with no params left in it. */
    concrete: string;
}

const table: Row[] = collect().map(({ route }) => {
    const [method, p] = route.split(' ');
    return {
        route,
        method,
        normalized: `${method} ${stripParamRegex(honoPath(p))}`,
        concrete: concretize(honoPath(p)),
    };
});

/** Hono's own routing table, normalized through the same two functions. */
const mounted = new Set(
    (app as unknown as { routes: Array<{ method: string; path: string }> }).routes.map(
        (r) => `${r.method.toUpperCase()} ${stripParamRegex(r.path)}`,
    ),
);

/** The env every row is issued with. See the docblock for why `saas`. */
const SAAS_ENV = { APP_MODE: 'saas', DB: {}, JWT_SECRET: 'x' };

function request(row: Pick<Row, 'method' | 'concrete'>, key: string | null) {
    return app.request(
        row.concrete,
        {
            method: row.method,
            headers: {
                ...(key ? { 'Idempotency-Key': key } : {}),
                'content-type': 'application/json',
            },
            body: '{}',
        },
        SAAS_ENV,
    );
}

beforeEach(() => {
    stubTenant.id = 'tenant-a';
    vi.mocked(claimKey).mockClear();
});

describe('idempotency route coverage', { timeout: 120_000 }, () => {
    it('walks a real, non-empty mutating surface', () => {
        // Without this the whole suite could pass VACUOUSLY: no rows, no
        // failures. Same pin as authorization-surface.spec.ts.
        expect(table.length).toBeGreaterThan(300);
        expect(mounted.size).toBeGreaterThan(100);
    });

    it('every table row corresponds to a route the app actually mounts', () => {
        // `app.use('*')` runs even for a path that matches NO route, so
        // "claimKey was called" would pass for a path that does not exist. This
        // is the assertion that keeps the per-row rows meaningful.
        const missing = table.filter((r) => !mounted.has(r.normalized)).map((r) => r.route);
        expect(missing).toEqual([]);
    });

    it.each(table.map((r) => [r.route, r] as const))(
        'claims an idempotency key for %s',
        async (_label, row) => {
            const key = `k-${row.route}`;
            await request(row, key);
            expect(claimKey).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ tenantId: 'tenant-a', key }),
            );
        },
    );
});

describe('the two branches the per-route rows assume', { timeout: 60_000 }, () => {
    const sample = table[0];

    it('does NOT claim without an Idempotency-Key header', async () => {
        await request(sample, null);
        expect(claimKey).not.toHaveBeenCalled();
    });

    it('does NOT claim when no tenant is on the context', async () => {
        // Proved ONCE here rather than 344 times in the table above. In
        // standalone this branch is unreachable (resolveByFixedTenant stamps a
        // tenant on every request), which is exactly why the suite runs saas.
        stubTenant.id = null;
        await request(sample, 'k-no-tenant');
        expect(claimKey).not.toHaveBeenCalled();
    });
});
