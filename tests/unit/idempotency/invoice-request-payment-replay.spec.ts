/**
 * Tier 1, the last of the money-moving invoice surfaces: asking the client to
 * pay. The hub's "Request payment" button posts here. The endpoint resolves or
 * CREATES the inspection's invoice, marks it sent, mints the recipient's
 * portal token, and emails them a working link to the public payment page.
 *
 * Two of those are already self-limiting and are asserted as characterization,
 * not as evidence: the invoice is reused when one exists, and the portal token
 * is minted idempotently on purpose so older copies of the email keep working.
 * The email is not. A retry sends the client a second "please pay for your
 * inspection" — the one message in this system most likely to be read as a
 * second bill.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import invoiceRoutes from '../../../server/api/invoices';
import { InvoiceService } from '../../../server/services/invoice.service';
import { PeopleService } from '../../../server/services/people.service';
import { PortalAccessService } from '../../../server/services/portal-access.service';
import { idempotencyMiddleware } from '../../../server/lib/middleware/idempotency';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import { asD1Db } from '../helpers/test-db';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000300';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';
const INSP_ID_2 = '550e8400-e29b-41d4-a716-4466554400aa';
const CLIENT = 'contact-client-1';
const SLUG = 'acme';
const JWT_SECRET = 'test-jwt-secret';
const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

let db: BetterSQLite3Database<typeof schema>;
let sendInvoiceRequest: ReturnType<typeof vi.fn>;

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'manager' as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: USER_ID } as never);
        c.set('requestedTenantSlug', SLUG as never);
        c.set('services', {
            invoice: new InvoiceService({} as D1Database),
            people: new PeopleService({ DB: {} as D1Database }),
            portalAccess: new PortalAccessService({} as D1Database, { jwtSecret: JWT_SECRET }),
            email: { sendInvoiceRequest } as never,
            qbo: { upsertInvoice: vi.fn() } as never,
        } as never);
        await next();
    });
    // The mounted shape: tenant on the context first, then the guard.
    app.use('*', idempotencyMiddleware({ getDb: () => db as never }));
    app.route('/api/invoices', invoiceRoutes);
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status as never);
        }
        throw err;
    });
    return app;
}

const ENV = { DB: {}, APP_BASE_URL: 'https://acme.example.com', JWT_SECRET } as never;
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function requestPayment(key: string | null, inspectionId = INSP_ID) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (key) headers['Idempotency-Key'] = key;
    return buildApp().fetch(
        new Request('https://acme.example.com/api/invoices/request-payment', {
            method: 'POST', headers, body: JSON.stringify({ inspectionId }),
        }),
        ENV, CTX,
    );
}

const payUrls = () => sendInvoiceRequest.mock.calls.map(([, , , url]) => url as string);

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    sendInvoiceRequest = vi.fn().mockResolvedValue(undefined);

    await db.insert(schema.tenants).values({
        id: TENANT, slug: SLUG, status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await seedRoleProfiles(asD1Db(db), TENANT, new Date(1));
    await db.insert(schema.contacts).values({
        id: CLIENT, tenantId: TENANT, type: 'client', name: 'Jane',
        email: 'jane@example.com', phone: null, createdAt: new Date(),
    });
    for (const id of [INSP_ID, INSP_ID_2]) {
        await db.insert(schema.inspections).values({
            id, tenantId: TENANT, propertyAddress: '1 Main St', date: '2026-06-01',
            status: 'requested', paymentStatus: 'unpaid', price: 50000,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
    }
    const people = new PeopleService({ DB: {} as D1Database });
    await people.addPerson(TENANT, INSP_ID, CLIENT, roleProfileId('client'));
    await people.addPerson(TENANT, INSP_ID_2, CLIENT, roleProfileId('client'));
});

describe("POST '/api/invoices/request-payment' — replay does not re-bill the client", () => {
    it('emails the payment request once across two posts under one key', async () => {
        const first = await requestPayment('req-1');
        const second = await requestPayment('req-1');

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(sendInvoiceRequest).toHaveBeenCalledTimes(1);
        expect(sendInvoiceRequest.mock.calls[0][0]).toBe('jane@example.com');
    });

    it('replays the original response, flagged — including the original sentAt', async () => {
        const first = await requestPayment('req-1');
        const second = await requestPayment('req-1');

        // Not just cosmetic. Unguarded, the replay reruns markSent and the
        // returned sentAt MOVES, so the invoice's own record of when it was
        // sent is rewritten by a retry the operator never made.
        expect(await second.json()).toEqual(await first.clone().json());
        expect(second.headers.get('Idempotency-Replayed')).toBe('true');
        expect(first.headers.get('Idempotency-Replayed')).toBeNull();
    });

    it('CHARACTERIZATION: the invoice and the pay token are reused, guard or no guard', async () => {
        // Not evidence for the guard — stated so nobody later reads it as such.
        // The handler reuses an existing invoice for the inspection, and
        // PortalAccessService.issueToken is deliberately idempotent so older
        // copies of the email keep working. Both survive an unguarded replay.
        // The EMAIL is the side effect that does not, which is what the first
        // test asserts.
        await requestPayment('req-1');
        await requestPayment('req-2');

        const invoices = await db.select().from(schema.invoices)
            .where(eq(schema.invoices.inspectionId, INSP_ID)).all();
        expect(invoices).toHaveLength(1);
        const urls = payUrls();
        expect(urls).toHaveLength(2);
        expect(urls[1]).toBe(urls[0]);
    });

    it('re-sends under a fresh key — a deliberate chase-up still reaches the client', async () => {
        await requestPayment('req-1');
        await requestPayment('req-2');
        expect(sendInvoiceRequest).toHaveBeenCalledTimes(2);
    });

    it('refuses the key when the inspection changed under it', async () => {
        await requestPayment('req-1', INSP_ID);
        const res = await requestPayment('req-1', INSP_ID_2);

        expect(res.status).toBe(422);
        expect(await res.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
        // The second inspection was never invoiced off the back of the first
        // one's key — an invoice raised against the wrong job is a correction
        // the operator has to make by hand.
        const invoices = await db.select().from(schema.invoices)
            .where(eq(schema.invoices.inspectionId, INSP_ID_2)).all();
        expect(invoices).toHaveLength(0);
        expect(sendInvoiceRequest).toHaveBeenCalledTimes(1);
    });
});
