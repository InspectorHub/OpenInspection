import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../server/lib/db/schema';
import { createTestDb, setupSchema } from './db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../server/api/inspections';
import { AgreementService } from '../../server/services/agreement.service';
import { AppError } from '../../server/lib/errors';
import type { HonoConfig } from '../../server/types/hono';

/**
 * Task 7 (Issue #111) — POST /api/inspections/:id/agreement-requests.
 *
 * The hub's Agreement card "Send agreement" button posts here. The endpoint
 * creates a signing request, emails it to the client, flips the row to 'sent',
 * and returns the created request. These tests exercise the REAL mounted route
 * (RBAC + zod + handler) against an in-memory SQLite DB, mirroring
 * inspection-patch-settings.spec.ts. The agreement service is the real one
 * (so the row is actually written); the email service is a spy so we can
 * assert the send happened.
 */

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-0000000000ff';
const USER_ID = '00000000-0000-0000-0000-000000000300';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';
const AGR_ID = '11111111-1111-4111-8111-111111111111';
const AGR_ID_2 = '22222222-2222-4222-8222-222222222222';
const AGR_OTHER = '33333333-3333-4333-8333-333333333333';
const SLUG = 'acme';

let db: BetterSQLite3Database<typeof schema>;
let sendAgreementRequest: ReturnType<typeof vi.fn>;

function buildApp(role = 'admin') {
    const app = new OpenAPIHono<HonoConfig>();
    sendAgreementRequest = vi.fn().mockResolvedValue(undefined);
    app.use('*', async (c, next) => {
        c.set('userRole', role as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: USER_ID } as never);
        c.set('requestedTenantSlug', SLUG as never);
        c.set('services', {
            agreement: new AgreementService({} as D1Database),
            email: { sendAgreementRequest } as never,
        } as never);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    // Mirror the production onError AppError→status mapping (server/index.ts) so
    // thrown 404/422 surface as real status codes in this minimal harness.
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status as never);
        }
        throw err;
    });
    return app;
}

const ENV = { DB: {}, APP_BASE_URL: 'https://acme.example.com' } as never;
// auditFromContext reads c.executionCtx.waitUntil — supply a stub.
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function send(path: string, body: string, role = 'admin') {
    const req = new Request(`https://acme.example.com${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body,
    });
    return buildApp(role).fetch(req, ENV, CTX);
}

async function post(body: unknown, role = 'admin') {
    return send(`/api/inspections/${INSP_ID}/agreement-requests`, JSON.stringify(body), role);
}

describe('POST /api/inspections/:id/agreement-requests (Task 7, #111)', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: SLUG, status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT,
            propertyAddress: '1 Main St', clientName: 'Jane', clientEmail: 'jane@example.com',
            date: '2026-06-01', status: 'draft', paymentStatus: 'unpaid', price: 50000,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
    });

    async function seedAgreement(id = AGR_ID, name = 'Standard Agreement') {
        await db.insert(schema.agreements).values({
            id, tenantId: TENANT, name, content: 'AGREEMENT BODY', version: 1, createdAt: new Date(),
        });
    }

    it('happy path — defaults agreement + email, creates a sent request and emails the client', async () => {
        await seedAgreement();
        const res = await post({});
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { id: string; status: string; clientEmail: string } };
        expect(body.data.status).toBe('sent');
        expect(body.data.clientEmail).toBe('jane@example.com');

        // Row persisted + flipped to 'sent'.
        const row = await db.select().from(schema.agreementRequests)
            .where(eq(schema.agreementRequests.id, body.data.id)).get();
        expect(row?.status).toBe('sent');
        expect(row?.inspectionId).toBe(INSP_ID);
        expect(row?.agreementId).toBe(AGR_ID);
        expect(row?.clientEmail).toBe('jane@example.com');
        // sentAt stamped alongside the status flip.
        expect(row?.sentAt).not.toBeNull();

        // Email sent to the resolved client with the agreement name.
        expect(sendAgreementRequest).toHaveBeenCalledTimes(1);
        expect(sendAgreementRequest.mock.calls[0][0]).toBe('jane@example.com');
        expect(sendAgreementRequest.mock.calls[0][2]).toBe('Standard Agreement');
    });

    it('accepts a non-UUID agreementId (agreements.id is TEXT, not a UUID column)', async () => {
        // Regression: the body schema once gated agreementId with .uuid(), which
        // 422'd legitimate non-UUID rows (seeded/imported templates). agreements.id
        // is plain TEXT; tenant ownership — not id format — is what gates the send.
        const TEXT_ID = 'agr-seeded-not-a-uuid';
        await seedAgreement(TEXT_ID, 'Seeded Agreement');
        const res = await post({ agreementId: TEXT_ID });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { id: string } };
        const row = await db.select().from(schema.agreementRequests)
            .where(eq(schema.agreementRequests.id, body.data.id)).get();
        expect(row?.agreementId).toBe(TEXT_ID);
        expect(sendAgreementRequest).toHaveBeenCalledTimes(1);
    });

    it('explicit body overrides win over the defaults', async () => {
        await seedAgreement(AGR_ID, 'First');
        await seedAgreement(AGR_ID_2, 'Second');
        const res = await post({ agreementId: AGR_ID_2, email: 'override@example.com' });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { id: string; clientEmail: string } };
        const row = await db.select().from(schema.agreementRequests)
            .where(eq(schema.agreementRequests.id, body.data.id)).get();
        expect(row?.agreementId).toBe(AGR_ID_2);
        expect(row?.clientEmail).toBe('override@example.com');
        expect(sendAgreementRequest.mock.calls[0][0]).toBe('override@example.com');
    });

    it('422 when no agreement template exists for the tenant', async () => {
        const res = await post({});
        expect(res.status).toBe(422);
        expect(sendAgreementRequest).not.toHaveBeenCalled();
    });

    it('422 when no email is resolvable (inspection has none and none supplied)', async () => {
        await seedAgreement();
        await db.update(schema.inspections).set({ clientEmail: null })
            .where(eq(schema.inspections.id, INSP_ID));
        const res = await post({});
        expect(res.status).toBe(422);
        expect(sendAgreementRequest).not.toHaveBeenCalled();
    });

    it('422 when the provided agreementId belongs to another tenant', async () => {
        await seedAgreement();
        await db.insert(schema.tenants).values({
            id: OTHER, name: 'Other', slug: 'other', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.agreements).values({
            id: AGR_OTHER, tenantId: OTHER, name: 'Other Agr', content: 'x', version: 1, createdAt: new Date(),
        });
        const res = await post({ agreementId: AGR_OTHER });
        expect(res.status).toBe(422);
        expect(sendAgreementRequest).not.toHaveBeenCalled();
    });

    it('404 for a cross-tenant inspection', async () => {
        await seedAgreement();
        await db.insert(schema.tenants).values({
            id: OTHER, name: 'Other', slug: 'other', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.inspections).values({
            id: 'insp-other', tenantId: OTHER, propertyAddress: 'X',
            clientName: null, clientEmail: 'x@y.com', date: '2026-06-01', status: 'draft',
            paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
        const res = await send(`/api/inspections/insp-other/agreement-requests`, '{}');
        expect(res.status).toBe(404);
        expect(sendAgreementRequest).not.toHaveBeenCalled();
    });
});
