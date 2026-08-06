/**
 * Tier 1 of the burn-down: creating an invoice is a money document. A retried
 * POST that writes a second row does not just duplicate a record — it doubles
 * what the tenant believes is owed, and (when QuickBooks is connected) pushes
 * the duplicate out to their books where a human has to unpick it.
 *
 * The route is tenant-authenticated, so `app.use('*', idempotencyGuard)` in
 * server/index.ts already sits in front of it (order pinned by
 * tests/unit/platform/middleware-order.spec.ts). What that mount does NOT tell
 * you is whether the endpoint's side effects all happen INSIDE the guard's
 * span: the QBO push is fired through `executionCtx.waitUntil` from the
 * handler, and a side effect scheduled outside the guarded window would repeat
 * on every replay while the invoice row correctly did not.
 *
 * So this drives the REAL router behind the REAL middleware over a real
 * (in-memory) D1 schema, and counts rows and provider calls rather than
 * trusting the 201.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

// InvoiceService resolves its own drizzle handle off the D1 binding, so the
// fixture DB is injected the way the rest of the invoice suites do it.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import invoiceRoutes from '../../../server/api/invoices';
import { InvoiceService } from '../../../server/services/invoice.service';
import { idempotencyMiddleware } from '../../../server/lib/middleware/idempotency';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER_TENANT = '00000000-0000-0000-0000-000000000002';
const USER_ID = '00000000-0000-0000-0000-000000000300';

let db: BetterSQLite3Database<typeof schema>;
let qboUpsertInvoice: ReturnType<typeof vi.fn>;

/**
 * The mounted shape: tenant on the context first (the JWT middleware's job in
 * production), then the guard, then the real router. The guard reads the tenant
 * off `c.var` — mounting it before the tenant exists is the cross-tenant leak
 * the middleware header warns about, so the order here is the order that ships.
 */
function buildApp(tenantId = TENANT) {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'manager' as never);
        c.set('tenantId', tenantId);
        c.set('user', { sub: USER_ID } as never);
        c.set('services', {
            invoice: new InvoiceService({} as D1Database),
            qbo: { upsertInvoice: qboUpsertInvoice } as never,
        } as never);
        await next();
    });
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

// QBO_CLIENT_ID present, so the push the handler schedules is live and a
// duplicate would be observable rather than compiled out.
const ENV = { DB: {}, QBO_CLIENT_ID: 'qbo-test-client' } as never;
const CTX = { waitUntil: (p: Promise<unknown>) => void p, passThroughOnException: () => {} } as never;

const BODY = {
    inspectionId: null,
    clientName: 'Dana Buyer',
    amountCents: 45000,
    lineItems: [{ description: 'Inspection', amountCents: 45000 }],
    dueDate: null,
    notes: null,
};

function createInvoice(key: string | null, body: unknown = BODY, tenantId = TENANT) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (key) headers['Idempotency-Key'] = key;
    const req = new Request('https://acme.example.com/api/invoices', {
        method: 'POST', headers, body: JSON.stringify(body),
    });
    return buildApp(tenantId).fetch(req, ENV, CTX);
}

async function invoiceRows(tenantId = TENANT) {
    return db.select().from(schema.invoices).where(eq(schema.invoices.tenantId, tenantId)).all();
}

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    qboUpsertInvoice = vi.fn().mockResolvedValue(undefined);

    for (const [id, slug] of [[TENANT, 'acme'], [OTHER_TENANT, 'globex']] as const) {
        await db.insert(schema.tenants).values({
            id, name: slug, slug, status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
    }
    await db.insert(schema.users).values({
        id: USER_ID, tenantId: TENANT, email: 'dana@acme.example.com',
        passwordHash: 'x', name: 'Dana Inspector', role: 'manager', createdAt: new Date(),
    });
});

describe("POST '/api/invoices' — replay does not create a second invoice", () => {
    it('writes ONE invoice row when the same key is posted twice', async () => {
        const first = await createInvoice('key-1');
        const second = await createInvoice('key-1');

        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        expect(await invoiceRows()).toHaveLength(1);
    });

    it('returns the SAME invoice id on the replay, and marks it as replayed', async () => {
        const first = await createInvoice('key-1');
        const second = await createInvoice('key-1');

        const a = await first.json() as { data: { invoice: { id: string } } };
        const b = await second.json() as { data: { invoice: { id: string } } };
        // A fresh id would mean a second row was written after all — the count
        // assertion above and this one fail for different reasons.
        expect(b.data.invoice.id).toBe(a.data.invoice.id);
        expect(second.headers.get('Idempotency-Replayed')).toBe('true');
        expect(first.headers.get('Idempotency-Replayed')).toBeNull();
    });

    it('does not push the duplicate to QuickBooks', async () => {
        // The push is scheduled through executionCtx.waitUntil INSIDE the
        // handler. A replay that never reaches the handler cannot schedule it —
        // which is exactly what has to be proven, because a side effect fired
        // outside the guarded span would repeat while the row did not.
        await createInvoice('key-1');
        await createInvoice('key-1');
        expect(qboUpsertInvoice).toHaveBeenCalledTimes(1);
    });

    it('creates again under a fresh key — the guard is not a global mute', async () => {
        await createInvoice('key-1');
        await createInvoice('key-2');
        expect(await invoiceRows()).toHaveLength(2);
    });

    it('creates again with no key at all', async () => {
        await createInvoice(null);
        await createInvoice(null);
        expect(await invoiceRows()).toHaveLength(2);
    });

    it('refuses the key when the payload changed under it', async () => {
        await createInvoice('key-1');
        const res = await createInvoice('key-1', { ...BODY, amountCents: 90000 });

        expect(res.status).toBe(422);
        expect(await res.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
        // And critically: the $900 invoice was NOT written, and the $450 one was
        // not overwritten.
        const rows = await invoiceRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].amountCents).toBe(45000);
    });

    it('scopes the key to the tenant — the same key in another tenant still creates', async () => {
        await createInvoice('key-1');
        await createInvoice('key-1', BODY, OTHER_TENANT);

        expect(await invoiceRows(TENANT)).toHaveLength(1);
        expect(await invoiceRows(OTHER_TENANT)).toHaveLength(1);
        const claims = await db.select().from(schema.idempotencyKeys)
            .where(and(eq(schema.idempotencyKeys.key, 'key-1'), eq(schema.idempotencyKeys.tenantId, OTHER_TENANT)))
            .all();
        expect(claims).toHaveLength(1);
    });
});
