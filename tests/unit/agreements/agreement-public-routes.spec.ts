import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq, asc } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import { AgreementService } from '../../../server/services/agreement.service';
import { hashToken } from '../../../server/lib/token-hash';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

/**
 * Track I-a Task 4 — public per-signer sign / view / decline routes.
 *
 * The route handlers + AgreementService call `drizzle(c.env.DB)`, so we mock
 * drizzle-orm/d1 to return our better-sqlite3 test DB instance and inject a
 * REAL AgreementService (driving the test DB) plus spied auditLog / automation /
 * notification / email stubs through the services context variable.
 */

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Import AFTER the mock is registered.
// eslint-disable-next-line import/order
import { bookingsRoutes } from '../../../server/api/bookings';

vi.mock('../../../server/lib/rate-limit', () => ({
    checkRateLimit: vi.fn().mockResolvedValue(undefined),
}));

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const INSP_ID = '00000000-0000-0000-0000-000000000010';
const AGR_ID = '00000000-0000-0000-0000-000000000020';
const JWT_SECRET = 'test-secret';

const FAKE_ENV = {
    DB: {},
    APP_NAME: 'OpenInspection',
    APP_BASE_URL: 'https://example.test',
    // SIGN_COMPLETION_WORKFLOW injected per-test (see buildApp)
} as unknown as HonoConfig['Bindings'];

/**
 * Tracks every promise scheduled via waitUntil so a test can `await` them all
 * after app.request() returns (fire-and-forget effects settle out-of-band).
 */
function makeExecCtx() {
    const pending: Promise<unknown>[] = [];
    const ctx = {
        waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p).catch(() => {})); },
        passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    return { ctx, settle: () => Promise.all(pending) };
}

interface Stubs {
    auditAppend?: ReturnType<typeof vi.fn>;
    automationTrigger?: ReturnType<typeof vi.fn>;
    notificationCreate?: ReturnType<typeof vi.fn>;
    emailConfirm?: ReturnType<typeof vi.fn>;
    workflowCreate?: ReturnType<typeof vi.fn>;
}

function buildApp(db: BetterSQLite3Database<typeof schema>, stubs: Stubs = {}) {
    const auditAppend = stubs.auditAppend ?? vi.fn().mockResolvedValue({ id: 'a', hash: 'h' });
    const automationTrigger = stubs.automationTrigger ?? vi.fn().mockResolvedValue(undefined);
    const notificationCreate = stubs.notificationCreate ?? vi.fn().mockResolvedValue(undefined);
    const emailConfirm = stubs.emailConfirm ?? vi.fn().mockResolvedValue(undefined);
    const workflowCreate = stubs.workflowCreate ?? vi.fn().mockResolvedValue(undefined);

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
            auditLog: { append: auditAppend },
            automation: { trigger: automationTrigger },
            notification: { createForAllAdmins: notificationCreate },
            email: { sendAgreementSignedConfirmation: emailConfirm },
        } as unknown as HonoConfig['Variables']['services']);
        // Wire the workflow binding onto env so the completion pipeline can fire.
        Object.assign(c.env, { SIGN_COMPLETION_WORKFLOW: { create: workflowCreate } });
        await next();
    });
    app.route('/', bookingsRoutes);
    (mockDrizzle as any).mockReturnValue(db);

    return { app, auditAppend, automationTrigger, notificationCreate, emailConfirm, workflowCreate };
}

async function seedBase(db: BetterSQLite3Database<typeof schema>) {
    await db.insert(schema.tenants).values({
        id: TENANT_ID, slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', maxUsers: 5, createdAt: new Date(),
    } as any);
    await db.insert(schema.inspections).values({
        id: INSP_ID, tenantId: TENANT_ID, propertyAddress: '1 Main St',
        date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
        price: 50000, agreementRequired: true, paymentRequired: false, createdAt: new Date(),
    } as any);
    await db.insert(schema.agreements).values({
        id: AGR_ID, tenantId: TENANT_ID, name: 'Standard Agreement',
        content: 'ORIGINAL agreement text', version: 1, createdAt: new Date(),
    } as any);
}

/** Create a 2-signer envelope; return { token (signer 1), requestId } and signer rows. */
async function createTwoSignerEnvelope(
    db: BetterSQLite3Database<typeof schema>,
    policy: 'all' | 'one' = 'all',
) {
    const svc = new AgreementService({} as D1Database, { jwtSecret: JWT_SECRET });
    const r = await svc.findOrCreate(TENANT_ID, INSP_ID, {
        signers: [
            { name: 'Jane', email: 'jane@test.com', role: 'client' },
            { name: 'John', email: 'john@test.com', role: 'co_client' },
        ],
        completionPolicy: policy,
    });
    const signers = await db.select().from(schema.agreementSigners)
        .where(eq(schema.agreementSigners.requestId, r.requestId))
        .orderBy(asc(schema.agreementSigners.createdAt)).all();
    // signer-1 link = r.token; mint signer-2 link from the service
    const token2 = await svc.getSignerLink(TENANT_ID, r.requestId, signers[1].id);
    return { token1: r.token, token2, requestId: r.requestId, signers };
}

const SIG = 'data:image/png;base64,aGVsbG8=';

function signReq(body: Record<string, unknown>) {
    return {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    } as RequestInit;
}

describe('public agreement routes — per-signer (Track I-a)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(db);
        await seedBase(db);
    });

    afterEach(() => sqlite.close());

    it('GET by signer token serves the SNAPSHOT (not the live template) + signer/progress/policy', async () => {
        const { token1, requestId } = await createTwoSignerEnvelope(db, 'all');
        // mutate the live template AFTER envelope creation
        await db.update(schema.agreements).set({ content: 'MUTATED' }).where(eq(schema.agreements.id, AGR_ID));

        const { app } = buildApp(db);
        const { ctx } = makeExecCtx();
        const res = await app.request(`/agreements/${token1}`, {}, FAKE_ENV, ctx);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.success).toBe(true);
        expect(body.data.agreementContent).toBe('ORIGINAL agreement text');
        expect(body.data.agreementName).toBe('Standard Agreement');
        expect(body.data.signer).toEqual({ name: 'Jane', role: 'client', status: expect.any(String) });
        expect(body.data.progress).toEqual({ signed: 0, total: 2 });
        expect(body.data.completionPolicy).toBe('all');

        // signer row marked viewed
        const signers = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, requestId)).all();
        const jane = signers.find(s => s.email === 'jane@test.com')!;
        expect(jane.status).toBe('viewed');
    });

    it('GET by ENVELOPE token opens the page when the row carries the HASH, and 404s on plaintext alone', async () => {
        // A signer-less envelope: the route synthesizes one. It used to resolve
        // from the plaintext column; envelope lookup is hash-only now, so the
        // row has to carry `token_hash` to be reachable at all.
        const envToken = 'envelopetoken1234567890';
        const reqId = '00000000-0000-0000-0000-0000000000aa';
        await db.insert(schema.agreementRequests).values({
            id: reqId, tenantId: TENANT_ID, inspectionId: INSP_ID, agreementId: AGR_ID,
            clientEmail: 'jane@test.com', clientName: 'Jane', token: envToken,
            tokenHash: await hashToken(envToken),
            status: 'sent', completionPolicy: 'all',
            contentSnapshot: 'LEGACY SNAPSHOT', contentHash: await hashToken('LEGACY SNAPSHOT'),
            createdAt: new Date(),
        } as any);

        const { app } = buildApp(db);
        const { ctx } = makeExecCtx();
        const res = await app.request(`/agreements/${envToken}`, {}, FAKE_ENV, ctx);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.data.agreementContent).toBe('LEGACY SNAPSHOT');
        expect(body.data.signer.name).toBe('Jane');
        expect(body.data.progress.total).toBe(1);

        // The control. Same shape, plaintext stored but no hash — the state
        // every remaining un-upgraded row in production is in, all of them
        // expired. It must not open.
        const plainOnly = 'plaintextonlytoken0987654321';
        await db.insert(schema.agreementRequests).values({
            id: '00000000-0000-0000-0000-0000000000ab', tenantId: TENANT_ID,
            inspectionId: INSP_ID, agreementId: AGR_ID,
            clientEmail: 'no@test.com', clientName: 'No', token: plainOnly,
            status: 'sent', completionPolicy: 'all',
            contentSnapshot: 'X', contentHash: await hashToken('X'), createdAt: new Date(),
        } as any);
        const denied = await app.request(`/agreements/${plainOnly}`, {}, FAKE_ENV, makeExecCtx().ctx);
        expect(denied.status).toBe(404);
    });

    it('POST sign signer 1 of 2 (all): envelope NOT signed, workflow NOT created; signer 2 completes -> envelope signed, workflow once, verificationToken set, notification + email fire', async () => {
        const { token1, token2, requestId } = await createTwoSignerEnvelope(db, 'all');
        const { app, workflowCreate, notificationCreate, emailConfirm } = buildApp(db);

        const ec1 = makeExecCtx();
        const r1 = await app.request(`/agreements/${token1}/sign`, signReq({ signatureBase64: SIG }), FAKE_ENV, ec1.ctx);
        await ec1.settle();
        expect(r1.status).toBe(200);

        let env = await db.select().from(schema.agreementRequests)
            .where(eq(schema.agreementRequests.id, requestId)).get();
        expect(env!.status).not.toBe('signed');
        expect(workflowCreate).not.toHaveBeenCalled();
        // No ENVELOPE-completion side-effects until the envelope completes.
        expect(notificationCreate).not.toHaveBeenCalled();
        // IA-46 — but the remote signer still gets their own per-signer receipt
        // (with the verify link) at their own email the moment they sign.
        expect(emailConfirm).toHaveBeenCalledTimes(1);
        expect(emailConfirm.mock.calls[0][0]).toBe('jane@test.com');
        expect(emailConfirm.mock.calls[0][4]).toBe(`https://example.test/verify/${requestId}`);

        const ec2 = makeExecCtx();
        const r2 = await app.request(`/agreements/${token2}/sign`, signReq({ signatureBase64: SIG }), FAKE_ENV, ec2.ctx);
        await ec2.settle();
        expect(r2.status).toBe(200);

        env = await db.select().from(schema.agreementRequests)
            .where(eq(schema.agreementRequests.id, requestId)).get();
        expect(env!.status).toBe('signed');
        expect(env!.verificationToken).toMatch(/^[0-9a-f]{64}$/);
        expect(workflowCreate).toHaveBeenCalledTimes(1);
        expect(workflowCreate).toHaveBeenCalledWith(expect.objectContaining({ id: requestId }));

        // B3 — the completion effect no longer writes a staff notification
        // itself. It used to fetch the agreement's display name purely to build
        // a hard-coded title; the office alert is now the seeded
        // `Office alert — agreement signed` rule, raised by the
        // `agreement.signed` trigger this same effect already fires. Asserted
        // positively in tests/unit/automations/staff-alerts-via-rules.spec.ts.
        expect(notificationCreate).not.toHaveBeenCalled();
        // IA-46 — three emails total across both signs: signer-1 receipt (jane),
        // the envelope-completion email (jane, the client), and signer-2's own
        // receipt (john). John is a remote co-signer who previously got NOTHING.
        const recipients = emailConfirm.mock.calls.map((call) => call[0]);
        expect(recipients.filter((r) => r === 'jane@test.com')).toHaveLength(2);
        expect(recipients.filter((r) => r === 'john@test.com')).toHaveLength(1);
        // Every delivered link is the human /verify page, never the JSON API.
        for (const call of emailConfirm.mock.calls) {
            expect(call[4]).toBe(`https://example.test/verify/${requestId}`);
            expect(call[4]).not.toContain('/api/');
        }
    });

    it('idempotent re-sign: POST same signer token twice -> 200 both times, workflow created EXACTLY once, no second notification', async () => {
        // Single-signer 'one' envelope so the FIRST sign already completes it.
        const svc = new AgreementService({} as D1Database, { jwtSecret: JWT_SECRET });
        const r = await svc.findOrCreate(TENANT_ID, INSP_ID, {
            signers: [{ name: 'Jane', email: 'jane@test.com', role: 'client' }],
            completionPolicy: 'one',
        });
        const { app, workflowCreate, notificationCreate } = buildApp(db);

        const ec1 = makeExecCtx();
        const first = await app.request(`/agreements/${r.token}/sign`, signReq({ signatureBase64: SIG }), FAKE_ENV, ec1.ctx);
        await ec1.settle();
        expect(first.status).toBe(200);
        expect(workflowCreate).toHaveBeenCalledTimes(1);
        // B3 — the staff notification is a rule now; the single-fire gate this
        // case guards is the WORKFLOW, which is still asserted above.
        expect(notificationCreate).not.toHaveBeenCalled();

        const ec2 = makeExecCtx();
        const second = await app.request(`/agreements/${r.token}/sign`, signReq({ signatureBase64: SIG }), FAKE_ENV, ec2.ctx);
        await ec2.settle();
        expect(second.status).toBe(200);
        // The single-fire completion gate must NOT re-trigger on a repeat sign.
        expect(workflowCreate).toHaveBeenCalledTimes(1);
        // B3 — the staff notification is a rule now; the single-fire gate this
        // case guards is the WORKFLOW, which is still asserted above.
        expect(notificationCreate).not.toHaveBeenCalled();
    });

    it('POST sign persists onBehalfOf / onBehalfDisclaimer on the signer row', async () => {
        const { token1, requestId } = await createTwoSignerEnvelope(db, 'all');
        const { app } = buildApp(db);
        const { ctx, settle } = makeExecCtx();
        const res = await app.request(`/agreements/${token1}/sign`,
            signReq({ signatureBase64: SIG, onBehalfOf: 'Acme LLC', onBehalfDisclaimer: 'Authorized agent' }), FAKE_ENV, ctx);
        await settle();
        expect(res.status).toBe(200);

        const jane = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, requestId)).all();
        const row = jane.find(s => s.email === 'jane@test.com')!;
        expect(row.status).toBe('signed');
        expect(row.onBehalfOf).toBe('Acme LLC');
        expect(row.onBehalfDisclaimer).toBe('Authorized agent');
        expect(row.channel).toBe('remote');
    });

    it('POST decline signer 1 (all) -> envelope declined; (one) with pending other -> envelope NOT declined', async () => {
        // policy 'all' — one decline drags the envelope to declined
        {
            const { token1, requestId } = await createTwoSignerEnvelope(db, 'all');
            const { app } = buildApp(db);
            const { ctx, settle } = makeExecCtx();
            const res = await app.request(`/agreements/${token1}/decline`, signReq({ reason: 'changed mind' }), FAKE_ENV, ctx);
            await settle();
            expect(res.status).toBe(200);
            const env = await db.select().from(schema.agreementRequests)
                .where(eq(schema.agreementRequests.id, requestId)).get();
            expect(env!.status).toBe('declined');
        }
        // policy 'one' — single decline with other still pending does NOT decline envelope
        {
            await db.delete(schema.agreementSigners);
            await db.delete(schema.agreementRequests);
            const { token1, requestId } = await createTwoSignerEnvelope(db, 'one');
            const { app } = buildApp(db);
            const { ctx, settle } = makeExecCtx();
            const res = await app.request(`/agreements/${token1}/decline`, signReq({ reason: 'no' }), FAKE_ENV, ctx);
            await settle();
            expect(res.status).toBe(200);
            const env = await db.select().from(schema.agreementRequests)
                .where(eq(schema.agreementRequests.id, requestId)).get();
            expect(env!.status).not.toBe('declined');
        }
    });

    it('fires automation: per-signer agreement.signer_signed on each sign; envelope agreement.signed once on completion; agreement.declined only when envelope declines', async () => {
        const { token1, token2 } = await createTwoSignerEnvelope(db, 'all');
        const { app, automationTrigger } = buildApp(db);

        const ec1 = makeExecCtx();
        await app.request(`/agreements/${token1}/sign`, signReq({ signatureBase64: SIG }), FAKE_ENV, ec1.ctx);
        await ec1.settle();
        // after signer 1: only signer-level automation, no envelope-level
        const eventsAfter1 = automationTrigger.mock.calls.map(c => c[0].triggerEvent);
        expect(eventsAfter1).toContain('agreement.signer_signed');
        expect(eventsAfter1).not.toContain('agreement.signed');

        const ec2 = makeExecCtx();
        await app.request(`/agreements/${token2}/sign`, signReq({ signatureBase64: SIG }), FAKE_ENV, ec2.ctx);
        await ec2.settle();
        const allEvents = automationTrigger.mock.calls.map(c => c[0].triggerEvent);
        expect(allEvents.filter(e => e === 'agreement.signer_signed')).toHaveLength(2);
        expect(allEvents.filter(e => e === 'agreement.signed')).toHaveLength(1);
    });

    it('audit: signer.signed appended on each sign; agreement.signed appended on envelope completion', async () => {
        const { token1, token2 } = await createTwoSignerEnvelope(db, 'all');
        const { app, auditAppend } = buildApp(db);

        const ec1 = makeExecCtx();
        await app.request(`/agreements/${token1}/sign`, signReq({ signatureBase64: SIG }), FAKE_ENV, ec1.ctx);
        await ec1.settle();
        let events = auditAppend.mock.calls.map(c => c[2]);
        expect(events).toContain('signer.signed');
        expect(events).not.toContain('agreement.signed');

        const ec2 = makeExecCtx();
        await app.request(`/agreements/${token2}/sign`, signReq({ signatureBase64: SIG }), FAKE_ENV, ec2.ctx);
        await ec2.settle();
        events = auditAppend.mock.calls.map(c => c[2]);
        expect(events.filter(e => e === 'signer.signed')).toHaveLength(2);
        expect(events).toContain('agreement.signed');
    });

    it('audit: signer.declined appended on decline', async () => {
        const { token1 } = await createTwoSignerEnvelope(db, 'all');
        const { app, auditAppend } = buildApp(db);
        const { ctx, settle } = makeExecCtx();
        await app.request(`/agreements/${token1}/decline`, signReq({ reason: 'nope' }), FAKE_ENV, ctx);
        await settle();
        const events = auditAppend.mock.calls.map(c => c[2]);
        expect(events).toContain('signer.declined');
    });

    it('GET / POST with unknown token -> 404', async () => {
        const { app } = buildApp(db);
        const ec = makeExecCtx();
        const g = await app.request('/agreements/nope-unknown-token', {}, FAKE_ENV, ec.ctx);
        expect(g.status).toBe(404);
        const p = await app.request('/agreements/nope-unknown-token/sign', signReq({ signatureBase64: SIG }), FAKE_ENV, ec.ctx);
        expect(p.status).toBe(404);
    });
});
