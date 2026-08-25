/**
 * Roadmap §7.5 item 1 — viewCommunication gets teeth. The bit was declared,
 * defaulted, returned by /me, editable in InviteSeatDrawer, covered by six
 * unit assertions — and enforced NOWHERE: the Communication endpoint was
 * requireRole-only, so an inspector with the bit explicitly withdrawn still
 * read every recipient address.
 *
 * Asserts the HTTP status (createRoutesStub never runs middleware — see
 * reference_createroutesstub_skips_middleware; a component-level test here
 * would be exactly the fake-green that reference documents).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import communicationRoutes from '../../../server/api/inspections/communication';
import { AppError } from '../../../server/lib/errors';
import { createScopedDb } from '../../../server/lib/db/scoped';
import type { HonoConfig } from '../../../server/types/hono';
import { makeExecutionContext } from '../helpers/exec-ctx';

const TENANT = 't-viewcomm-1';
const USER = 'u-viewcomm-1';
const INSP = 'i-viewcomm-1';

let db: BetterSQLite3Database<typeof schema>;

const ENV = { DB: {} } as never;
// Settled at teardown by the helper. A no-op stub still lets the promise RUN --
// it only removes any way to await it, which is how a run with every test
// passing could still exit 1 on an unhandled teardown rejection.
const CTX = makeExecutionContext().ctx;

async function callCommunication(overrides: Record<string, boolean> | null) {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await db.insert(schema.tenants).values({ id: TENANT, slug: 't-viewcomm', createdAt: new Date() });
    await db.insert(schema.users).values({
        id: USER, tenantId: TENANT, email: 'i@example.com', passwordHash: 'x',
        name: 'Insp', role: 'inspector', createdAt: new Date(),
        permissionOverrides: overrides ? JSON.stringify(overrides) : null,
    } as never);
    await db.insert(schema.inspections).values({
        id: INSP, tenantId: TENANT, propertyAddress: '1 Main', date: '2026-07-01', createdAt: new Date(), price: 0,
    });

    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        throw err;
    });
    app.use('*', async (c, next) => {
        c.set('userRole', 'inspector' as never);
        c.set('user', { sub: USER, role: 'inspector', tenantId: TENANT } as never);
        c.set('tenantId', TENANT);
        c.set('sdb', createScopedDb(db as never, TENANT) as never);
        c.set('services', {
            message: { listForInspection: vi.fn().mockResolvedValue([]), markInspectionReadForStaff: vi.fn() },
            automation: { getCommunicationDeliveries: vi.fn().mockResolvedValue([]) },
        } as never);
        await next();
    });
    app.route('/api/inspections', communicationRoutes);
    return app.request(`/api/inspections/${INSP}/communication`, {}, ENV, CTX);
}

describe('GET /:id/communication wears viewCommunication', () => {
    beforeEach(() => vi.clearAllMocks());

    it('403s an inspector whose viewCommunication override was withdrawn', async () => {
        const res = await callCommunication({ viewCommunication: false });
        expect(res.status).toBe(403);
    });

    it('200s an inspector with the default bit', async () => {
        const res = await callCommunication(null);
        expect(res.status).toBe(200);
    });
});
