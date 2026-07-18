/**
 * Task 9b (people-role-profiles) — POST /api/inspections/:id/agreement-requests
 * must resolve the default recipient email/name via
 * PeopleService.getPrimaryClient instead of the legacy
 * inspection.clientEmail/.clientName columns (dropped, Task 13). This spec
 * seeds an inspection with the LEGACY client columns NULL and only
 * inspection_people populated, so it fails against the old implementation
 * (422 "no client email").
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { AgreementService } from '../../../server/services/agreement.service';
import { PeopleService } from '../../../server/services/people.service';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';
const CLIENT = 'contact-client-1';
const USER_ID = '00000000-0000-0000-0000-000000000300';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';
const AGR_ID = '11111111-1111-4111-8111-111111111111';
const SLUG = 'acme';

const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

let db: BetterSQLite3Database<typeof schema>;
let sendAgreementRequest: ReturnType<typeof vi.fn>;

function buildApp(role = 'manager') {
    const app = new OpenAPIHono<HonoConfig>();
    sendAgreementRequest = vi.fn().mockResolvedValue(undefined);
    app.use('*', async (c, next) => {
        c.set('userRole', role as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: USER_ID } as never);
        c.set('requestedTenantSlug', SLUG as never);
        c.set('services', {
            agreement: new AgreementService({} as D1Database, { jwtSecret: 'test-secret' }),
            people: new PeopleService({ DB: {} as D1Database }),
            email: { sendAgreementRequest } as never,
        } as never);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status as never);
        }
        throw err;
    });
    return app;
}

const ENV = { DB: {}, APP_BASE_URL: 'https://acme.example.com' } as never;
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function post(body: unknown, role = 'manager') {
    const req = new Request(`https://acme.example.com/api/inspections/${INSP_ID}/agreement-requests`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return buildApp(role).fetch(req, ENV, CTX);
}

describe('POST /api/inspections/:id/agreement-requests — primary-client resolution (Task 9b)', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: SLUG, status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(db, TENANT, new Date(1));
        await db.insert(schema.contacts).values({
            id: CLIENT, tenantId: TENANT, type: 'client', name: 'Jane Client',
            email: 'jane@example.com', phone: '+15551234567', createdAt: new Date(),
        });
        await db.insert(schema.agreements).values({
            id: AGR_ID, tenantId: TENANT, name: 'Standard Agreement', content: 'AGREEMENT BODY', version: 1, createdAt: new Date(),
        });

        // Legacy client columns are intentionally NULL — only inspection_people
        // carries the primary client for this inspection.
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT,
            propertyAddress: '1 Main St', clientName: null, clientEmail: null,
            date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 50000,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });

        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, INSP_ID, CLIENT, roleProfileId('client'));
    });

    it('happy path — defaults to the primary client resolved via PeopleService', async () => {
        const res = await post({});
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { id: string; status: string; clientEmail: string } };
        expect(body.data.status).toBe('sent');
        expect(body.data.clientEmail).toBe('jane@example.com');

        const row = await db.select().from(schema.agreementRequests)
            .where(eq(schema.agreementRequests.id, body.data.id)).get();
        expect(row?.clientEmail).toBe('jane@example.com');

        expect(sendAgreementRequest).toHaveBeenCalledTimes(1);
        expect(sendAgreementRequest.mock.calls[0][0]).toBe('jane@example.com');
        expect(sendAgreementRequest.mock.calls[0][1]).toBe('Jane Client');
    });

    it('explicit body.email still overrides the resolved primary client', async () => {
        const res = await post({ email: 'override@example.com' });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { clientEmail: string } };
        expect(body.data.clientEmail).toBe('override@example.com');
        expect(sendAgreementRequest.mock.calls[0][0]).toBe('override@example.com');
    });

    it('422 when no primary client and no legacy client email and none supplied', async () => {
        await db.delete(schema.inspectionPeople).where(eq(schema.inspectionPeople.inspectionId, INSP_ID));
        const res = await post({});
        expect(res.status).toBe(422);
        expect(sendAgreementRequest).not.toHaveBeenCalled();
    });
});
