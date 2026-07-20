/**
 * Task 7c (people-role-profiles fix, CRITICAL) — POST /api/admin/import
 * (bulk historical data import) inserts `inspections` directly with
 * ins.clientName/ins.clientEmail on the legacy inline columns, but never
 * created a client contact or an inspection_people row. getInspection/
 * listInspections (Task 9c-reads) resolve the client ONLY via
 * inspection_people, so every imported inspection with a client showed a
 * null client — and would break entirely once Task 13 drops the legacy
 * columns.
 *
 * For each imported inspection with a client name/email, the route now
 * upserts a client contact (ContactService.upsertClientContact, same
 * idempotent match used elsewhere) and mirrors it into inspection_people as
 * `client`. Per-row non-fatal: one bad row must not abort the whole import.
 *
 * Mounts the real adminDataImportRoutes on OpenAPIHono with the DI services
 * container populated with REAL ContactService/PeopleService over an
 * in-memory better-sqlite3 DB (mirrors booking-people.spec.ts's harness).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { tenants, inspections } from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { ContactService } from '../../../server/services/contact.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { logger } from '../../../server/lib/logger';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import adminDataImportRoutes from '../../../server/api/admin/admin-data-import';

const TENANT = '00000000-0000-0000-0000-000000000001';

const FAKE_ENV: HonoConfig['Bindings'] = { DB: {} as D1Database } as unknown as HonoConfig['Bindings'];
const FAKE_EXEC_CTX: ExecutionContext = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };

function buildApp(contact: ContactService, people: PeopleService) {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner');
        c.set('tenantId', TENANT);
        c.set('user', { sub: 'admin-1' } as HonoConfig['Variables']['user']);
        c.set('services', { contact, people } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/', adminDataImportRoutes);
    return app;
}

describe('POST /import — writes inspection_people for imported clients (Task 7c)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;
    let contact: ContactService;
    let people: PeopleService;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);

        contact = new ContactService({} as D1Database);
        people = new PeopleService({ DB: {} as D1Database });

        await db.insert(tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as never);
        await seedRoleProfiles(db as never, TENANT, new Date(1));
    });

    afterEach(() => {
        sqlite.close();
        vi.restoreAllMocks();
    });

    it('CRITICAL — writes a client inspection_people row for an imported inspection with a client', async () => {
        const app = buildApp(contact, people);
        const res = await app.request('/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                inspections: [{
                    id: 'imp-insp-1',
                    propertyAddress: '1 Import Ave',
                    clientName: 'Imported Client',
                    clientEmail: 'imported@example.com',
                }],
            }),
        }, FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean };
        expect(body.success).toBe(true);

        const insp = await db.select().from(inspections).where(eq(inspections.id, 'imp-insp-1')).get();
        expect(insp).toBeTruthy();

        const rows = await people.listPeople(TENANT, 'imp-insp-1');
        expect(rows.map(r => r.roleKey)).toEqual(['client']);
        expect(rows[0]?.name).toBe('Imported Client');
        expect(rows[0]?.email).toBe('imported@example.com');
    });

    it('writes nothing when the imported row has no client name/email', async () => {
        const app = buildApp(contact, people);
        const res = await app.request('/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                inspections: [{ id: 'imp-insp-noclient', propertyAddress: '2 Import Ave' }],
            }),
        }, FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);

        const rows = await people.listPeople(TENANT, 'imp-insp-noclient');
        expect(rows).toEqual([]);
    });

    it('does not abort the import when the people-write throws for one row (non-fatal, per-row)', async () => {
        const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
        const addPersonSpy = vi.spyOn(PeopleService.prototype, 'addPerson').mockRejectedValue(new Error('boom'));

        const app = buildApp(contact, people);
        const res = await app.request('/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                inspections: [{
                    id: 'imp-insp-2',
                    propertyAddress: '3 Import Ave',
                    clientName: 'Fragile Client',
                    clientEmail: 'fragile@example.com',
                }],
            }),
        }, FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean };
        expect(body.success).toBe(true);

        const insp = await db.select().from(inspections).where(eq(inspections.id, 'imp-insp-2')).get();
        expect(insp).toBeTruthy();
        expect(addPersonSpy).toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalled();
    });

    it('handles multiple imported inspections, each getting its own client row', async () => {
        const app = buildApp(contact, people);
        const res = await app.request('/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                inspections: [
                    { id: 'imp-multi-1', propertyAddress: '1 A St', clientName: 'Client One', clientEmail: 'one@example.com' },
                    { id: 'imp-multi-2', propertyAddress: '2 B St', clientName: 'Client Two', clientEmail: 'two@example.com' },
                ],
            }),
        }, FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);

        const rows1 = await people.listPeople(TENANT, 'imp-multi-1');
        const rows2 = await people.listPeople(TENANT, 'imp-multi-2');
        expect(rows1[0]?.email).toBe('one@example.com');
        expect(rows2[0]?.email).toBe('two@example.com');
    });
});
