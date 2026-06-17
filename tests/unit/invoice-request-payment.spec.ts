import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../server/lib/db/schema';
import { createTestDb, setupSchema } from './db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import invoiceRoutes from '../../server/api/invoices';
import { InvoiceService } from '../../server/services/invoice.service';
import { AppError } from '../../server/lib/errors';
import type { HonoConfig } from '../../server/types/hono';

/**
 * Task 8 (Issue #111) — POST /api/invoices/request-payment.
 *
 * The hub's Invoice card "Request payment" button posts here. The endpoint
 * resolves (or creates) the inspection's invoice per the money authority chain
 * (Σ service snapshots → inspections.price), marks it sent, and emails the
 * client a link to the public `/invoice/:id` payment page. These tests
 * exercise the REAL mounted route (RBAC + zod + handler) against an in-memory
 * SQLite DB, mirroring inspection-agreement-request.spec.ts. The invoice
 * service is the real one (so the row is actually written); the email service
 * is a spy so we can assert the send happened with the pay URL.
 */

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-0000000000ff';
const USER_ID = '00000000-0000-0000-0000-000000000300';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_INSP_ID = '550e8400-e29b-41d4-a716-4466554400ff';
const SVC_ID = '660e8400-e29b-41d4-a716-446655440000';
const SLUG = 'acme';

let db: BetterSQLite3Database<typeof schema>;
let sendInvoiceRequest: ReturnType<typeof vi.fn>;

function buildApp(role = 'manager') {
    const app = new OpenAPIHono<HonoConfig>();
    sendInvoiceRequest = vi.fn().mockResolvedValue(undefined);
    app.use('*', async (c, next) => {
        c.set('userRole', role as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: USER_ID } as never);
        c.set('requestedTenantSlug', SLUG as never);
        c.set('services', {
            invoice: new InvoiceService({} as D1Database),
            email: { sendInvoiceRequest } as never,
            qbo: { upsertInvoice: vi.fn() } as never,
        } as never);
        await next();
    });
    app.route('/api/invoices', invoiceRoutes);
    // Mirror the production onError AppError→status mapping (server/index.ts).
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
    const req = new Request('https://acme.example.com/api/invoices/request-payment', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return buildApp(role).fetch(req, ENV, CTX);
}

describe('POST /api/invoices/request-payment (Task 8, #111)', () => {
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
            date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 50000,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
    });

    async function seedService(priceSnapshot = 30000, priceOverride: number | null = null) {
        await db.insert(schema.services).values({
            id: SVC_ID, tenantId: TENANT, name: 'Home Inspection',
            price: priceSnapshot, active: true, createdAt: new Date(),
        });
        await db.insert(schema.inspectionServices).values({
            id: crypto.randomUUID(), tenantId: TENANT, inspectionId: INSP_ID,
            serviceId: SVC_ID, nameSnapshot: 'Home Inspection',
            priceSnapshot, priceOverride,
        });
    }

    it('no invoice — creates one, marks it sent, and emails the client the pay URL', async () => {
        const res = await post({ inspectionId: INSP_ID });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { id: string; status: string; amountCents: number; sentAt: string | null };
        expect(body.status).toBe('sent');
        expect(body.sentAt).not.toBeNull();
        // No services → falls through to inspections.price (50000).
        expect(body.amountCents).toBe(50000);

        // Exactly one invoice row persisted, flipped to sent.
        const rows = await db.select().from(schema.invoices).where(eq(schema.invoices.inspectionId, INSP_ID)).all();
        expect(rows).toHaveLength(1);
        expect(rows[0].sentAt).not.toBeNull();
        expect(rows[0].amountCents).toBe(50000);

        // Email sent to the client with a /invoice/{id} pay URL.
        expect(sendInvoiceRequest).toHaveBeenCalledTimes(1);
        expect(sendInvoiceRequest.mock.calls[0][0]).toBe('jane@example.com');
        const payUrl = sendInvoiceRequest.mock.calls.flat().find((a) => typeof a === 'string' && a.includes('/invoice/'));
        expect(payUrl).toContain(`/invoice/${INSP_ID}`);
    });

    it('services present — amount is the Σ of service snapshots (override ?? snapshot), not inspections.price', async () => {
        await seedService(30000, 12000); // override wins
        const res = await post({ inspectionId: INSP_ID });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { amountCents: number };
        expect(body.amountCents).toBe(12000);
        const rows = await db.select().from(schema.invoices).where(eq(schema.invoices.inspectionId, INSP_ID)).all();
        expect(rows[0].amountCents).toBe(12000);
    });

    it('existing draft invoice — reused (no second row) and marked sent', async () => {
        const svc = new InvoiceService(db as unknown as D1Database);
        const created = await svc.createInvoice(TENANT, {
            inspectionId: INSP_ID, clientName: 'Jane', clientEmail: 'jane@example.com',
            amountCents: 42000, lineItems: [{ description: 'Inspection services', amountCents: 42000 }],
        });

        const res = await post({ inspectionId: INSP_ID });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { id: string; status: string; amountCents: number };
        expect(body.id).toBe(created.id);
        expect(body.status).toBe('sent');
        expect(body.amountCents).toBe(42000);

        const rows = await db.select().from(schema.invoices).where(eq(schema.invoices.inspectionId, INSP_ID)).all();
        expect(rows).toHaveLength(1);
        expect(rows[0].sentAt).not.toBeNull();
        expect(sendInvoiceRequest).toHaveBeenCalledTimes(1);
    });

    it('already paid invoice — 409, no email', async () => {
        const svc = new InvoiceService(db as unknown as D1Database);
        const created = await svc.createInvoice(TENANT, {
            inspectionId: INSP_ID, clientName: 'Jane', clientEmail: 'jane@example.com',
            amountCents: 42000, lineItems: [{ description: 'Inspection services', amountCents: 42000 }],
        });
        await svc.markPaid(created.id, TENANT);

        const res = await post({ inspectionId: INSP_ID });
        expect(res.status).toBe(409);
        expect(sendInvoiceRequest).not.toHaveBeenCalled();
    });

    it('no client email — 422, no invoice created, no email', async () => {
        await db.update(schema.inspections).set({ clientEmail: null }).where(eq(schema.inspections.id, INSP_ID));
        const res = await post({ inspectionId: INSP_ID });
        expect(res.status).toBe(422);
        const rows = await db.select().from(schema.invoices).where(eq(schema.invoices.inspectionId, INSP_ID)).all();
        expect(rows).toHaveLength(0);
        expect(sendInvoiceRequest).not.toHaveBeenCalled();
    });

    it('zero amount — no services and null price → 422, no invoice, no email', async () => {
        await db.update(schema.inspections).set({ price: 0 }).where(eq(schema.inspections.id, INSP_ID));
        const res = await post({ inspectionId: INSP_ID });
        expect(res.status).toBe(422);
        const rows = await db.select().from(schema.invoices).where(eq(schema.invoices.inspectionId, INSP_ID)).all();
        expect(rows).toHaveLength(0);
        expect(sendInvoiceRequest).not.toHaveBeenCalled();
    });

    it('cross-tenant inspection — 404, no email', async () => {
        await db.insert(schema.tenants).values({
            id: OTHER, name: 'Other', slug: 'other', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.inspections).values({
            id: OTHER_INSP_ID, tenantId: OTHER, propertyAddress: 'X',
            clientName: 'X', clientEmail: 'x@y.com', date: '2026-06-01', status: 'requested',
            paymentStatus: 'unpaid', price: 10000, agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
        const res = await post({ inspectionId: OTHER_INSP_ID });
        expect(res.status).toBe(404);
        expect(sendInvoiceRequest).not.toHaveBeenCalled();
    });
});
