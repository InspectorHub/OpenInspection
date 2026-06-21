import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq, asc } from 'drizzle-orm';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { HonoConfig } from '../../server/types/hono';
import { AppError } from '../../server/lib/errors';
import { AgreementService } from '../../server/services/agreement.service';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

/**
 * Track I-a Task 7 — public combined-checkout endpoint.
 *
 * GET /api/public/checkout/:token resolves a SIGNER token (the same tier-2
 * token the public sign page uses) to the snapshot + envelope progress + the
 * inspection's outstanding invoice / payment state + tenant branding, so the
 * combined "Sign & pay" page can render in one round trip.
 *
 * Mirrors agreement-public-routes.spec.ts: drizzle-orm/d1 is mocked to return
 * the better-sqlite3 test DB; a REAL AgreementService drives it.
 */

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Import AFTER the mock is registered.
// eslint-disable-next-line import/order
import { bookingsRoutes } from '../../server/api/bookings';

vi.mock('../../server/lib/rate-limit', () => ({
    checkRateLimit: vi.fn().mockResolvedValue(undefined),
}));

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const INSP_ID = '00000000-0000-0000-0000-000000000010';
const AGR_ID = '00000000-0000-0000-0000-000000000020';
const INV_ID = '00000000-0000-0000-0000-000000000030';
const JWT_SECRET = 'test-secret';

const FAKE_ENV = {
    DB: {},
    APP_NAME: 'OpenInspection',
    APP_BASE_URL: 'https://example.test',
} as unknown as HonoConfig['Bindings'];

function makeExecCtx() {
    const pending: Promise<unknown>[] = [];
    const ctx = {
        waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p).catch(() => {})); },
        passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    return { ctx, settle: () => Promise.all(pending) };
}

function buildApp(db: BetterSQLite3Database<typeof schema>) {
    const agreement = new AgreementService({} as D1Database, { jwtSecret: JWT_SECRET });
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('services', {
            agreement,
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/', bookingsRoutes);
    (mockDrizzle as any).mockReturnValue(db);
    return { app };
}

async function seedBase(
    db: BetterSQLite3Database<typeof schema>,
    inspOver: Partial<typeof schema.inspections.$inferInsert> = {},
) {
    await db.insert(schema.tenants).values({
        id: TENANT_ID, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', maxUsers: 5, createdAt: new Date(),
    } as any);
    await db.insert(schema.tenantConfigs).values({
        tenantId: TENANT_ID, siteName: 'Acme Inspections', primaryColor: '#ff5500', updatedAt: new Date(),
    } as any);
    await db.insert(schema.inspections).values({
        id: INSP_ID, tenantId: TENANT_ID, propertyAddress: '1 Main St', clientName: 'Jane',
        clientEmail: 'jane@test.com', date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
        price: 50000, agreementRequired: true, paymentRequired: true, createdAt: new Date(),
        ...inspOver,
    } as any);
    await db.insert(schema.agreements).values({
        id: AGR_ID, tenantId: TENANT_ID, name: 'Standard Agreement',
        content: 'ORIGINAL agreement text', version: 1, createdAt: new Date(),
    } as any);
}

async function createEnvelope(db: BetterSQLite3Database<typeof schema>) {
    const svc = new AgreementService({} as D1Database, { jwtSecret: JWT_SECRET });
    const r = await svc.findOrCreate(TENANT_ID, INSP_ID, {
        signers: [{ name: 'Jane', email: 'jane@test.com', role: 'client' }],
        completionPolicy: 'all',
    });
    const signers = await db.select().from(schema.agreementSigners)
        .where(eq(schema.agreementSigners.requestId, r.requestId))
        .orderBy(asc(schema.agreementSigners.createdAt)).all();
    return { token: r.token, requestId: r.requestId, signers };
}

describe('GET /api/public/checkout/:token (Track I-a Task 7)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(db);
    });

    afterEach(() => sqlite.close());

    it('200 returns snapshot + envelope progress + invoice + payment + inspection + branding', async () => {
        await seedBase(db);
        await db.insert(schema.invoices).values({
            id: INV_ID, tenantId: TENANT_ID, inspectionId: INSP_ID,
            amountCents: 45000, lineItems: [], createdAt: new Date(),
        } as any);
        // Mutate the live template AFTER creation — the snapshot must NOT follow.
        const { token } = await createEnvelope(db);
        await db.update(schema.agreements).set({ content: 'MUTATED' }).where(eq(schema.agreements.id, AGR_ID));

        const { app } = buildApp(db);
        const { ctx } = makeExecCtx();
        const res = await app.request(`/checkout/${token}`, {}, FAKE_ENV, ctx);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.success).toBe(true);
        const d = body.data;

        expect(d.signer).toEqual({ name: 'Jane', role: 'client', status: expect.any(String) });
        expect(d.agreement.name).toBe('Standard Agreement');
        expect(d.agreement.content).toBe('ORIGINAL agreement text');
        expect(d.agreement.contentHash).toMatch(/^[0-9a-f]{64}$/);
        expect(d.envelope.status).toEqual(expect.any(String));
        expect(d.envelope.completionPolicy).toBe('all');
        expect(d.envelope.progress).toEqual({ signed: 0, total: 1 });
        expect(d.invoice).toEqual({ id: INV_ID, amountCents: 45000, status: expect.any(String) });
        expect(d.payment).toEqual({ required: true, paid: false });
        expect(d.inspection).toEqual({ id: INSP_ID, propertyAddress: '1 Main St' });
        expect(d.branding).toEqual({ companyName: 'Acme Inspections', primaryColor: '#ff5500' });
    });

    it('invoice is null when the inspection has no invoice; payment.paid reflects status', async () => {
        await seedBase(db, { paymentStatus: 'paid', paymentRequired: false });
        const { token } = await createEnvelope(db);

        const { app } = buildApp(db);
        const { ctx } = makeExecCtx();
        const res = await app.request(`/checkout/${token}`, {}, FAKE_ENV, ctx);
        expect(res.status).toBe(200);
        const d = (await res.json() as any).data;
        expect(d.invoice).toBeNull();
        expect(d.payment).toEqual({ required: false, paid: true });
    });

    it('never leaks any signer token / hash / enc blob in the response', async () => {
        await seedBase(db);
        const { token, signers } = await createEnvelope(db);
        const sig = signers[0];

        const { app } = buildApp(db);
        const { ctx } = makeExecCtx();
        const res = await app.request(`/checkout/${token}`, {}, FAKE_ENV, ctx);
        const text = await res.text();
        expect(res.status).toBe(200);
        // No token material of ANY signer may appear in the payload.
        expect(text).not.toContain(token);
        if (sig.tokenHash) expect(text).not.toContain(sig.tokenHash);
        if (sig.tokenEnc) expect(text).not.toContain(sig.tokenEnc);
        const parsed = JSON.parse(text);
        const blob = JSON.stringify(parsed);
        expect(blob).not.toMatch(/tokenHash|tokenEnc|"token"/);
    });

    it('unknown token -> 404', async () => {
        await seedBase(db);
        const { app } = buildApp(db);
        const { ctx } = makeExecCtx();
        const res = await app.request('/checkout/nope-unknown-token', {}, FAKE_ENV, ctx);
        expect(res.status).toBe(404);
    });

    it('marks the signer viewed (same as the standalone sign page)', async () => {
        await seedBase(db);
        const { token, signers } = await createEnvelope(db);
        expect(signers[0].status).toBe('sent');

        const { app } = buildApp(db);
        const { ctx } = makeExecCtx();
        const res = await app.request(`/checkout/${token}`, {}, FAKE_ENV, ctx);
        expect(res.status).toBe(200);
        const d = (await res.json() as any).data;
        // The response itself reflects the post-view state…
        expect(d.signer.status).toBe('viewed');
        // …and it is persisted.
        const after = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.id, signers[0].id)).get();
        expect(after?.status).toBe('viewed');
    });

});

