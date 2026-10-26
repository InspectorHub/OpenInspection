/**
 * The editor shows the property-facts "auto-fill" button to everyone who can open the
 * editor, so the route must answer the same roles that may edit the facts (owner, manager,
 * inspector). Limiting an inspector to the inspections assigned to them is the inspection scope guard, which
 * covers every route under an inspection id (inspection-path-guard-scope.spec.ts).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { InspectionService } from '../../../server/services/inspection.service';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { makeExecutionContext } from '../helpers/exec-ctx';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
// eslint-disable-next-line import/order
import { inspectionsRoutes } from '../../../server/api/inspections';

const T = '00000000-0000-0000-0000-000000000001';
const ME = '00000000-0000-0000-0000-000000000099';
const LEAD = '00000000-0000-0000-0000-0000000000a1';
const ENV = { DB: {} } as HonoConfig['Bindings'];
const EXEC = makeExecutionContext().ctx;

let db: BetterSQLite3Database<typeof schema>;

function buildApp(role: UserRole) {
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => (err instanceof AppError
        ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
        : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
    const sdb = new ScopedDB(db as never, T);
    app.use('*', async (c, next) => {
        c.set('tenantId', T);
        c.set('userRole', role);
        c.set('user', { sub: ME, role, tenantId: T });
        c.set('sdb', { getById: async () => ({ permissionOverrides: null }) } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', {
            inspection: new InspectionService({} as D1Database, undefined, sdb),
            propertyLookup: { lookup: async () => ({ data: null, source: null, reason: 'NO_API_KEY' }) },
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    return app;
}

const autofill = (role: UserRole, id: string) => buildApp(role).request(`/api/inspections/${id}/property-facts/autofill`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addressString: '1 Main St, Springfield' }),
}, ENV, EXEC);

async function seed(id: string, inspectorId: string) {
    await db.insert(schema.inspections).values({
        id, tenantId: T, propertyAddress: '1 Main St', date: '2026-06-01', inspectorId,
        status: 'scheduled', reportStatus: 'in_progress', paymentStatus: 'unpaid', price: 0, createdAt: new Date(),
    });
}

beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db as BetterSQLite3Database<typeof schema>;
    await setupSchema(fix.sqlite);
    const now = new Date();
    await db.insert(schema.tenants).values({ id: T, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now });
    await db.insert(schema.users).values([
        { id: ME, tenantId: T, email: 'me@example.com', passwordHash: 'h', createdAt: now },
        { id: LEAD, tenantId: T, email: 'lead@example.com', passwordHash: 'h', createdAt: now },
    ]);
    await db.insert(schema.tenantConfigs).values({ tenantId: T, defaultTimezone: 'UTC', updatedAt: now });
});

describe('POST /property-facts/autofill roles', () => {
    it('an inspector on the inspection can use it', async () => {
        await seed('job-1', ME);
        expect((await autofill('inspector', 'job-1')).status).toBe(200);
    });

    it('control: an owner and a manager can use it', async () => {
        await seed('job-1', LEAD);
        expect((await autofill('owner', 'job-1')).status).toBe(200);
        expect((await autofill('manager', 'job-1')).status).toBe(200);
    });

    it('control: a role outside the editor roles is refused', async () => {
        await seed('job-1', ME);
        expect((await autofill('agent', 'job-1')).status).toBe(403);
    });
});
