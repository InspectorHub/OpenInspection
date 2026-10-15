/**
 * The `financial` capability over HTTP: every read that can carry money must
 * leave it out for a caller without the capability, and must still carry it for
 * a caller with it.
 *
 * The seed carries real amounts (price 45000, a deposit, a paid invoice).
 * "No money key in the body" would otherwise pass against an endpoint whose
 * data simply had none, so every case runs its manager positive control first.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { InspectionService } from '../../../server/services/inspection.service';
import { ContactService } from '../../../server/services/contact.service';
import { InspectionRequestService } from '../../../server/services/inspection-request.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { inspectionsRoutes } from '../../../server/api/inspections';
// eslint-disable-next-line import/order
import contactRoutes from '../../../server/api/contacts';
// eslint-disable-next-line import/order
import inspectionRequestsRoutes from '../../../server/api/inspection-requests';

const T = '00000000-0000-0000-0000-000000000001';
const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];
const MONEY_KEY = /"(price|[A-Za-z]*Cents)"\s*:/;

let db: BetterSQLite3Database<typeof schema>;
type Overrides = Record<string, boolean> | null;

function buildApp(role: UserRole, overrides: Overrides = null) {
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    const sdb = new ScopedDB(db as never, T);
    app.use('*', async (c, next) => {
        c.set('tenantId', T);
        c.set('userRole', role);
        c.set('user', { sub: 'actor', role, tenantId: T });
        c.set('sdb', {
            getById: async () => ({ permissionOverrides: overrides }),
        } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', {
            inspection: new InspectionService({} as D1Database, undefined, sdb),
            contact: new ContactService({} as D1Database),
            inspectionRequest: new InspectionRequestService({} as D1Database),
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    app.route('/api/contacts', contactRoutes);
    app.route('/api/inspection-requests', inspectionRequestsRoutes);
    return app;
}

const get = (app: OpenAPIHono<HonoConfig>, url: string) => app.request(url, {}, FAKE_ENV);

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const now = new Date();
    await db.insert(schema.tenants).values({
        id: T, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now,
    });
    await seedRoleProfiles(asD1Db(db), T, new Date(1));
    await db.insert(schema.inspectionRequests).values({
        id: 'req1', tenantId: T, clientName: 'Jane Buyer', propertyAddress: '1 Oak St',
        scheduledAt: now, status: 'pending', createdAt: now, updatedAt: now,
    } as never);
    await db.insert(schema.inspections).values({
        id: 'i1', tenantId: T, propertyAddress: '1 Oak St', date: '2099-01-01', status: 'confirmed',
        paymentStatus: 'unpaid', price: 45000, depositRequiredCents: 9000, requestId: 'req1',
        paymentRequired: false, agreementRequired: false, createdAt: now,
    });
    await db.insert(schema.contacts).values({
        id: 'c1', tenantId: T, type: 'client', name: 'Jane Buyer', email: 'jane@example.com', createdAt: now,
    });
    await new PeopleService({ DB: {} as D1Database })
        .addPerson(T, 'i1', 'c1', `crp_${T}_client`);
    await db.insert(schema.invoices).values({
        id: 'inv1', tenantId: T, inspectionId: 'i1', contactId: 'c1', amountCents: 45000,
        status: 'paid', paidAt: now, createdAt: now,
    } as never);
});

const SURFACES: Array<[string, string]> = [
    ['GET /api/inspections/:id', '/api/inspections/i1'],
    ['GET /api/inspections/dashboard', '/api/inspections/dashboard'],
    ['GET /api/contacts/:id', '/api/contacts/c1'],
    ['GET /api/inspection-requests/by-inspection/:id', '/api/inspection-requests/by-inspection/i1'],
];

describe.each(SURFACES)('%s', (_name, url) => {
    it('positive control: a manager receives money', async () => {
        const res = await get(buildApp('manager'), url);
        expect(res.status).toBe(200);
        expect(await res.text()).toMatch(MONEY_KEY);
    });
    it('an inspector without financial gets no money key anywhere in the body', async () => {
        const res = await get(buildApp('inspector'), url);
        expect(res.status).toBe(200);
        expect(await res.text()).not.toMatch(MONEY_KEY);
    });
    it('an inspector granted financial receives money', async () => {
        const res = await get(buildApp('inspector', { financial: true }), url);
        expect(res.status).toBe(200);
        expect(await res.text()).toMatch(MONEY_KEY);
    });
    it('a manager with financial switched off gets no money key', async () => {
        const res = await get(buildApp('manager', { financial: false }), url);
        expect(res.status).toBe(200);
        expect(await res.text()).not.toMatch(MONEY_KEY);
    });
});

describe('GET /api/inspections (list)', () => {
    // The list projection selects no money column today. Pinned so that adding
    // one is a visible decision: it would have to be redacted like the rest.
    it('carries no money key for any caller, and does return the row', async () => {
        for (const app of [buildApp('manager'), buildApp('inspector')]) {
            const res = await get(app, '/api/inspections');
            expect(res.status).toBe(200);
            const text = await res.text();
            expect(text).toContain('"i1"');
            expect(text).not.toMatch(MONEY_KEY);
        }
    });
});
