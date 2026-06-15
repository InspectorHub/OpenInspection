/**
 * Track I-a Task 9 — multi-signer admin send + per-signer reminders / copy-link.
 *
 * Pins the admin agreement router contract:
 *   1. POST /agreements/send with { signers, completionPolicy } routes through
 *      AgreementService.findOrCreate (envelope + signer rows + snapshot pinned)
 *      and the response carries requestId + signer statuses with NO token material.
 *   2. Legacy POST /agreements/send (no signers) still works.
 *   3. GET .../requests/:requestId/signers returns rows without token material.
 *   4. POST .../signers/:signerId/remind re-sends + sets lastRemindedAt; second
 *      call within 1h -> 429 rate_limited; terminal signer -> 409.
 *   5. GET .../signers/:signerId/link returns { url } (persistent link).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, asc } from 'drizzle-orm';
import * as schema from '../../server/lib/db/schema';
import { createTestDb, setupSchema } from './db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import adminRoutes from '../../server/api/admin';
import type { HonoConfig } from '../../server/types/hono';
import { AgreementService } from '../../server/services/agreement.service';
import { AppError } from '../../server/lib/errors';

function attachErrorHandler(app: OpenAPIHono<HonoConfig>) {
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
}

const TENANT = '11111111-1111-4111-8111-111111111111';
const INSP_ID = '22222222-2222-4222-8222-222222222222';
const AGR_ID = '33333333-3333-4333-8333-333333333333';

let db: BetterSQLite3Database<typeof schema>;
let emailSend: ReturnType<typeof vi.fn>;

async function seed() {
    await db.insert(schema.tenants).values({ id: TENANT, name: 'A', slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
    await db.insert(schema.inspections).values({ id: INSP_ID, tenantId: TENANT, propertyAddress: '1 Main St', clientName: 'Jane', clientEmail: 'jane@test.com', date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 50000, agreementRequired: true, paymentRequired: false, createdAt: new Date() });
    await db.insert(schema.agreements).values({ id: AGR_ID, tenantId: TENANT, name: 'Standard Agreement', content: 'Agreement text...', version: 1, createdAt: new Date() });
}

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    attachErrorHandler(app);
    const agreement = new AgreementService({} as D1Database, { jwtSecret: 'test-secret' });
    emailSend = vi.fn(async () => {});
    const services = {
        agreement,
        email: { sendAgreementRequest: emailSend },
        auditLog: { append: vi.fn(async () => {}), verifyChain: vi.fn(async () => ({ valid: true })) },
    } as unknown as HonoConfig['Variables']['services'];
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner');
        c.set('tenantId', TENANT);
        c.set('user', { sub: 'u1' } as never);
        c.set('services', services);
        await next();
    });
    app.route('/api/admin', adminRoutes);
    return app;
}

const ENV = { DB: {}, JWT_SECRET: 'test-secret', APP_BASE_URL: 'https://app.test' };
const EXEC = {
    waitUntil: (p: Promise<unknown>) => { void Promise.resolve(p).catch(() => {}); },
    passThroughOnException: () => {},
} as ExecutionContext;

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    await seed();
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
});

describe('POST /api/admin/agreements/send — multi-signer', () => {
    it('with signers + completionPolicy routes through findOrCreate (signer rows + snapshot) and response has NO token material', async () => {
        const res = await buildApp().request('/api/admin/agreements/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agreementId: AGR_ID,
                clientEmail: 'jane@test.com',
                inspectionId: INSP_ID,
                completionPolicy: 'one',
                signers: [
                    { name: 'Jane', email: 'jane@test.com', role: 'client' },
                    { name: 'John', email: 'john@test.com', role: 'co_client' },
                ],
            }),
        }, ENV, EXEC);
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { requestId: string; signers: Array<{ id: string; status: string; role: string }> } };
        expect(body.success).toBe(true);
        expect(body.data.requestId).toBeTruthy();
        expect(body.data.signers).toHaveLength(2);
        for (const s of body.data.signers) {
            expect(s.status).toBeTruthy();
        }
        // NO token material anywhere in the response
        const raw = JSON.stringify(body);
        expect(raw).not.toContain('tokenHash');
        expect(raw).not.toContain('tokenEnc');
        expect(raw).not.toMatch(/"token"/);

        // signer rows + snapshot pinned in DB
        const env = await db.select().from(schema.agreementRequests).all();
        expect(env.length).toBe(1);
        expect(env[0].contentSnapshot).toBe('Agreement text...');
        expect(env[0].completionPolicy).toBe('one');
        const signers = await db.select().from(schema.agreementSigners).all();
        expect(signers.length).toBe(2);

        // each signer emailed their OWN link
        expect(emailSend).toHaveBeenCalledTimes(2);
        const urls = emailSend.mock.calls.map((c) => c[3]);
        expect(new Set(urls).size).toBe(2);
    });

    it('signers-only send WITHOUT clientEmail succeeds (multi-signer path ignores clientEmail)', async () => {
        const res = await buildApp().request('/api/admin/agreements/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agreementId: AGR_ID,
                inspectionId: INSP_ID,
                completionPolicy: 'all',
                signers: [
                    { name: 'Jane', email: 'jane@test.com', role: 'client' },
                    { name: 'John', email: 'john@test.com', role: 'co_client' },
                ],
            }),
        }, ENV, EXEC);
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { requestId: string; signers: unknown[] } };
        expect(body.success).toBe(true);
        expect(body.data.requestId).toBeTruthy();
        expect(body.data.signers).toHaveLength(2);
        expect(emailSend).toHaveBeenCalledTimes(2);
    });

    it('rejects a request with neither clientEmail nor signers', async () => {
        const res = await buildApp().request('/api/admin/agreements/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agreementId: AGR_ID, inspectionId: INSP_ID }),
        }, ENV, EXEC);
        // zod refine rejects before the handler runs.
        expect(res.status).toBe(400);
    });

    it('signers provided WITHOUT inspectionId -> 400 with clear message', async () => {
        const res = await buildApp().request('/api/admin/agreements/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agreementId: AGR_ID,
                clientEmail: 'jane@test.com',
                // no inspectionId
                signers: [{ name: 'Jane', email: 'jane@test.com', role: 'client' }],
            }),
        }, ENV, EXEC);
        expect(res.status).toBe(400);
        const body = await res.json() as { error?: { message?: string }; message?: string };
        const message = body.error?.message ?? body.message ?? '';
        expect(message).toMatch(/inspectionId is required when sending to multiple signers/i);
    });

    it('legacy send (no signers) still succeeds', async () => {
        const res = await buildApp().request('/api/admin/agreements/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agreementId: AGR_ID, clientEmail: 'jane@test.com', inspectionId: INSP_ID }),
        }, ENV, EXEC);
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean };
        expect(body.success).toBe(true);
        expect(emailSend).toHaveBeenCalled();
    });
});

describe('signer endpoints', () => {
    async function sendTwo() {
        const res = await buildApp().request('/api/admin/agreements/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agreementId: AGR_ID, clientEmail: 'jane@test.com', inspectionId: INSP_ID,
                completionPolicy: 'all',
                signers: [
                    { name: 'Jane', email: 'jane@test.com', role: 'client' },
                    { name: 'John', email: 'john@test.com', role: 'co_client' },
                ],
            }),
        }, ENV, EXEC);
        const body = await res.json() as { data: { requestId: string } };
        return body.data.requestId;
    }

    it('GET signers returns rows w/ status/role/lastRemindedAt, NO token material', async () => {
        const requestId = await sendTwo();
        const res = await buildApp().request(`/api/admin/agreements/requests/${requestId}/signers`, {}, ENV, EXEC);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: Array<Record<string, unknown>> };
        expect(body.data).toHaveLength(2);
        for (const s of body.data) {
            expect(s.id).toBeTruthy();
            expect(s.status).toBeTruthy();
            expect(s.role).toBeTruthy();
            expect('lastRemindedAt' in s).toBe(true);
            expect('tokenHash' in s).toBe(false);
            expect('tokenEnc' in s).toBe(false);
            expect('token' in s).toBe(false);
        }
    });

    it('copy-link returns { url } with a persistent link', async () => {
        const requestId = await sendTwo();
        const signers = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, requestId))
            .orderBy(asc(schema.agreementSigners.createdAt)).all();
        const res = await buildApp().request(`/api/admin/agreements/requests/${requestId}/signers/${signers[0].id}/link`, {}, ENV, EXEC);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { url: string } };
        expect(body.data.url).toMatch(/^https?:\/\//);
        // persistent: a second call returns the same URL
        const res2 = await buildApp().request(`/api/admin/agreements/requests/${requestId}/signers/${signers[0].id}/link`, {}, ENV, EXEC);
        const body2 = await res2.json() as { data: { url: string } };
        expect(body2.data.url).toBe(body.data.url);
    });

    it('remind re-sends + sets lastRemindedAt; second call within 1h -> 429 rate_limited', async () => {
        const requestId = await sendTwo();
        const signers = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, requestId))
            .orderBy(asc(schema.agreementSigners.createdAt)).all();
        emailSend.mockClear();
        const res = await buildApp().request(`/api/admin/agreements/requests/${requestId}/signers/${signers[0].id}/remind`, { method: 'POST' }, ENV, EXEC);
        expect(res.status).toBe(200);
        expect(emailSend).toHaveBeenCalledTimes(1);
        const row = await db.select().from(schema.agreementSigners).where(eq(schema.agreementSigners.id, signers[0].id)).get();
        expect(row!.lastRemindedAt).toBeTruthy();

        const res2 = await buildApp().request(`/api/admin/agreements/requests/${requestId}/signers/${signers[0].id}/remind`, { method: 'POST' }, ENV, EXEC);
        expect(res2.status).toBe(429);
        const body2 = await res2.json() as { error?: { code?: string }; code?: string };
        const code = body2.code ?? body2.error?.code;
        expect(code).toBe('rate_limited');
    });

    it('remind on terminal (signed) signer -> 409', async () => {
        const requestId = await sendTwo();
        const signers = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, requestId))
            .orderBy(asc(schema.agreementSigners.createdAt)).all();
        await db.update(schema.agreementSigners).set({ status: 'signed' }).where(eq(schema.agreementSigners.id, signers[0].id));
        const res = await buildApp().request(`/api/admin/agreements/requests/${requestId}/signers/${signers[0].id}/remind`, { method: 'POST' }, ENV, EXEC);
        expect(res.status).toBe(409);
    });

    it('cross-tenant signers request -> 404 (tenant scope)', async () => {
        const requestId = await sendTwo();
        // build an app whose tenant differs
        const app = new OpenAPIHono<HonoConfig>();
        attachErrorHandler(app);
        const agreement = new AgreementService({} as D1Database, { jwtSecret: 'test-secret' });
        const services = {
            agreement,
            email: { sendAgreementRequest: vi.fn(async () => {}) },
            auditLog: { append: vi.fn(async () => {}) },
        } as unknown as HonoConfig['Variables']['services'];
        app.use('*', async (c, next) => {
            c.set('userRole', 'owner');
            c.set('tenantId', '00000000-0000-0000-0000-0000000000ff');
            c.set('user', { sub: 'u2' } as never);
            c.set('services', services);
            await next();
        });
        app.route('/api/admin', adminRoutes);
        const res = await app.request(`/api/admin/agreements/requests/${requestId}/signers`, {}, ENV, EXEC);
        expect(res.status).toBe(404);
    });
});

describe('GET /api/admin/agreements/requests — per-envelope signer progress', () => {
    it('returns signersTotal/signersSigned via one grouped count (no N+1)', async () => {
        // send a 2-signer envelope, then sign one
        const sendRes = await buildApp().request('/api/admin/agreements/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agreementId: AGR_ID, clientEmail: 'jane@test.com', inspectionId: INSP_ID,
                completionPolicy: 'all',
                signers: [
                    { name: 'Jane', email: 'jane@test.com', role: 'client' },
                    { name: 'John', email: 'john@test.com', role: 'co_client' },
                ],
            }),
        }, ENV, EXEC);
        const requestId = (await sendRes.json() as { data: { requestId: string } }).data.requestId;
        const signers = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, requestId))
            .orderBy(asc(schema.agreementSigners.createdAt)).all();
        await db.update(schema.agreementSigners).set({ status: 'signed' }).where(eq(schema.agreementSigners.id, signers[0].id));

        const res = await buildApp().request('/api/admin/agreements/requests', {}, ENV, EXEC);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: Array<{ id: string; signersTotal: number; signersSigned: number }> };
        const row = body.data.find((r) => r.id === requestId)!;
        expect(row.signersTotal).toBe(2);
        expect(row.signersSigned).toBe(1);
    });
});
