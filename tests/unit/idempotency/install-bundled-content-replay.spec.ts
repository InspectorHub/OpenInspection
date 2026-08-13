/**
 * Installing the starter content a release ships.
 *
 * The seeder itself is find-or-create by NAME, so a replayed install writes no
 * duplicate library rows — that half is idempotent by construction and is NOT
 * the exposure. Two things repeat without a guard:
 *
 *   1. the `data.import` audit entry, which is the workspace's record of how
 *      many times an operator actually pulled new content in. A second entry
 *      for one click says it happened twice.
 *   2. the seeder run itself — a full re-scan of the bundled fixture (seed
 *      templates, 250+ canned comments, tags, services) against the tenant's
 *      tables, on the shared worker, for a double-clicked button.
 *
 * The route is tenant-authenticated and owner-gated, so the global mount in
 * server/index.ts already spans it. These specs prove the whole tail sits
 * inside that span, and — via the distinct-key case — that the guard keys on
 * the header rather than on the route, so a deliberate second install still
 * works.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// The handler dynamic-imports this so the fixture payload is only pulled in on
// a real install; the mock has to stand in for that same module specifier.
const seedStarterContent = vi.fn();
vi.mock('../../../server/services/starter-content.service', () => ({
    seedStarterContent: (...args: unknown[]) => seedStarterContent(...args),
}));

import { OpenAPIHono } from '@hono/zod-openapi';
import adminRoutes from '../../../server/api/admin';
import { idempotencyMiddleware } from '../../../server/lib/middleware/idempotency';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '11111111-1111-4111-8111-111111111111';

const ZERO_COUNTS = {
    inspectionTemplatesSeeded: 0,
    agreementTemplatesSeeded: 0,
    cannedCommentsSeeded: 0,
    eventTypesSeeded: 0,
    tagsSeeded: 0,
    recommendationsSeeded: 0,
    ratingSystemsSeeded: 0,
    marketplaceLibrariesSeeded: 0,
    contractorTypesSeeded: 0,
    servicesSeeded: 0,
};

let db: BetterSQLite3Database<typeof schema>;
let auditAppend: ReturnType<typeof vi.fn>;

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    const services = {
        auditLog: { append: auditAppend, verifyChain: vi.fn(async () => ({ valid: true })) },
    } as unknown as HonoConfig['Variables']['services'];
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner');
        c.set('tenantId', TENANT);
        c.set('user', { sub: 'u1' } as never);
        c.set('services', services);
        await next();
    });
    // The mounted shape: tenant on the context (the JWT middleware's job in
    // production), then the guard, then the router.
    app.use('*', idempotencyMiddleware({ getDb: () => db as never }));
    app.route('/api/admin', adminRoutes);
    return app;
}

const ENV = { DB: {}, JWT_SECRET: 'test-secret', APP_BASE_URL: 'https://app.test' };
const EXEC = {
    waitUntil: (p: Promise<unknown>) => { void Promise.resolve(p).catch(() => {}); },
    passThroughOnException: () => {},
} as ExecutionContext;

function install(key: string | null) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers['Idempotency-Key'] = key;
    return buildApp().request('/api/admin/data/install-bundled-content', {
        method: 'POST', headers, body: JSON.stringify({}),
    }, ENV, EXEC);
}

// `auditFromContext` does NOT go through `services.auditLog.append` — it calls
// `writeAuditLog`, which inserts straight through drizzle. So the assertion has
// to read the rows, not a spy. (Asserting on the spy passed vacuously: it was
// never called, and "0 calls" reads the same as "guarded correctly".)
const importEvents = async () =>
    db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'data.import')).all();

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    auditAppend = vi.fn(async () => {});
    seedStarterContent.mockReset();
    seedStarterContent.mockResolvedValue({ ...ZERO_COUNTS, cannedCommentsSeeded: 3 });

    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'a', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
});

describe("POST '/api/admin/data/install-bundled-content' — replay does not re-run the seeder", () => {
    it('runs the seeder exactly once across two installs under one key', async () => {
        const first = await install('install-1');
        const second = await install('install-1');

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(seedStarterContent).toHaveBeenCalledTimes(1);
    });

    it('writes ONE data.import entry into the audit chain', async () => {
        await install('install-1');
        await install('install-1');

        expect(await importEvents()).toHaveLength(1);
    });

    it('replays the ORIGINAL counts rather than reporting a second install as empty', async () => {
        // The failure this rules out is subtle and would look like success: if
        // the replay re-ran the seeder, the second response would honestly
        // report all-zero (everything is present now), and the operator would
        // read "nothing to add" for a click that did add three rows.
        const first = await install('install-1');
        seedStarterContent.mockResolvedValue({ ...ZERO_COUNTS });
        const second = await install('install-1');

        const firstBody = await first.json() as { data: typeof ZERO_COUNTS };
        const secondBody = await second.json() as { data: typeof ZERO_COUNTS };
        expect(firstBody.data.cannedCommentsSeeded).toBe(3);
        expect(secondBody.data.cannedCommentsSeeded).toBe(3);
    });

    it('a DISTINCT key installs again — the guard keys on the header, not the route', async () => {
        // A deliberate second install after a later upgrade must still work.
        await install('install-1');
        await install('install-2');

        expect(seedStarterContent).toHaveBeenCalledTimes(2);
        expect(await importEvents()).toHaveLength(2);
    });
});
