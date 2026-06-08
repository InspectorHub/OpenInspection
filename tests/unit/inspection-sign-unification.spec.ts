import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq, asc } from 'drizzle-orm';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { HonoConfig } from '../../server/types/hono';
import { AppError } from '../../server/lib/errors';
import { AgreementService } from '../../server/services/agreement.service';
import { InspectionService } from '../../server/services/inspection.service';
import { ScopedDB } from '../../server/lib/db/scoped';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

/**
 * Track I-a Task 5 — on-site (in-app) signing rides the agreement ENVELOPE.
 *
 * The three authed in-app routes (GET /:id/sign-status, GET /:id/agreement,
 * POST /:id/sign) used to read/write the bare legacy `inspection_agreements`
 * table. They now ride the agreement_requests + agreement_signers envelope so
 * on-site signatures carry the same snapshot + audit chain + receipt as the
 * emailed envelope, and the dashboard 📋 / signedByClient truth is unified.
 *
 * Same harness style as agreement-public-routes.spec: mock drizzle-orm/d1 to
 * the in-memory better-sqlite3 db, inject a REAL AgreementService + spied
 * effect stubs through the services context variable.
 */

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

vi.mock('../../server/lib/rate-limit', () => ({
    checkRateLimit: vi.fn().mockResolvedValue(undefined),
}));

// Import AFTER the mock is registered.
// eslint-disable-next-line import/order
import { inspectionsRoutes } from '../../server/api/inspections';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const INSP_ID = '00000000-0000-0000-0000-000000000010';
const AGR_ID = '00000000-0000-0000-0000-000000000020';
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
        c.set('tenantId', TENANT_ID);
        c.set('services', {
            agreement,
            inspection: new InspectionService({} as D1Database, undefined, new ScopedDB(db as never, TENANT_ID)),
            auditLog: { append: auditAppend },
            automation: { trigger: automationTrigger },
            notification: { createForAllAdmins: notificationCreate },
            email: { sendAgreementSignedConfirmation: emailConfirm },
        } as unknown as HonoConfig['Variables']['services']);
        (c.env as Record<string, unknown>).SIGN_COMPLETION_WORKFLOW = { create: workflowCreate };
        await next();
    });
    app.route('/', inspectionsRoutes);
    (mockDrizzle as any).mockReturnValue(db);

    return { app, auditAppend, automationTrigger, notificationCreate, emailConfirm, workflowCreate };
}

async function seedBase(db: BetterSQLite3Database<typeof schema>, opts: { withTemplate?: boolean } = {}) {
    await db.insert(schema.tenants).values({
        id: TENANT_ID, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', maxUsers: 5, createdAt: new Date(),
    } as any);
    await db.insert(schema.inspections).values({
        id: INSP_ID, tenantId: TENANT_ID, propertyAddress: '1 Main St', clientName: 'Jane',
        clientEmail: 'jane@test.com', date: '2026-06-01', status: 'draft', paymentStatus: 'unpaid',
        price: 50000, agreementRequired: true, paymentRequired: false, createdAt: new Date(),
    } as any);
    if (opts.withTemplate ?? true) {
        await db.insert(schema.agreements).values({
            id: AGR_ID, tenantId: TENANT_ID, name: 'Standard Agreement',
            content: 'ORIGINAL agreement text', version: 1, createdAt: new Date(),
        } as any);
    }
}

/** Seed a 2-signer envelope directly via the service. */
async function createTwoSignerEnvelope(db: BetterSQLite3Database<typeof schema>, policy: 'all' | 'one' = 'all') {
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
    return { requestId: r.requestId, signers };
}

const SIG = 'data:image/png;base64,aGVsbG8=';

function postSign(body: Record<string, unknown>) {
    return {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    } as RequestInit;
}

describe('in-app on-site signing rides the envelope (Track I-a Task 5)', () => {
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

    // 1
    it('GET /:id/agreement creates the envelope+signer on first call and returns the SNAPSHOT', async () => {
        await seedBase(db);
        const { app } = buildApp(db);
        const { ctx } = makeExecCtx();

        const res = await app.request(`/${INSP_ID}/agreement`, {}, FAKE_ENV, ctx);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.data.agreement.id).toBe(AGR_ID);
        expect(body.data.agreement.name).toBe('Standard Agreement');
        expect(body.data.agreement.content).toBe('ORIGINAL agreement text');
        expect(body.data.requestId).toBeTruthy();
        expect(Array.isArray(body.data.signers)).toBe(true);
        expect(body.data.signers.length).toBe(1);
        expect(body.data.completionPolicy).toBe('all');

        // a signer row now exists
        const signers = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, body.data.requestId)).all();
        expect(signers.length).toBe(1);

        // mutate template AFTER first call → second GET returns the pinned snapshot
        await db.update(schema.agreements).set({ content: 'MUTATED' }).where(eq(schema.agreements.id, AGR_ID));
        const res2 = await app.request(`/${INSP_ID}/agreement`, {}, FAKE_ENV, makeExecCtx().ctx);
        const body2 = await res2.json() as any;
        expect(body2.data.agreement.content).toBe('ORIGINAL agreement text');
    });

    // 2
    it('GET /:id/agreement with NO template → { agreement: null } 200', async () => {
        await seedBase(db, { withTemplate: false });
        const { app } = buildApp(db);
        const res = await app.request(`/${INSP_ID}/agreement`, {}, FAKE_ENV, makeExecCtx().ctx);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.data.agreement).toBeNull();
    });

    // 3
    it('POST /:id/sign default signer signs in_person, no inspection_agreements row, single-signer envelope completes', async () => {
        await seedBase(db);
        const { app, workflowCreate } = buildApp(db);
        const { ctx, settle } = makeExecCtx();

        const res = await app.request(`/${INSP_ID}/sign`, postSign({ signatureBase64: SIG }), FAKE_ENV, ctx);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.data.signed).toBe(true);
        expect(body.data.signerId).toBeTruthy();
        expect(body.data.envelopeStatus).toBe('signed');
        await settle();

        // signer row signed with channel in_person
        const signers = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.tenantId, TENANT_ID)).all();
        expect(signers.length).toBe(1);
        expect(signers[0].status).toBe('signed');
        expect(signers[0].channel).toBe('in_person');

        // NO legacy inspection_agreements row written
        const legacy = await db.select().from(schema.inspectionAgreements)
            .where(eq(schema.inspectionAgreements.inspectionId, INSP_ID)).all();
        expect(legacy.length).toBe(0);

        // sign-status reflects the envelope
        const statusRes = await app.request(`/${INSP_ID}/sign-status`, {}, FAKE_ENV, makeExecCtx().ctx);
        const statusBody = await statusRes.json() as any;
        expect(statusBody.data.signed).toBe(true);

        // completion workflow fired exactly once
        expect(workflowCreate).toHaveBeenCalledTimes(1);
    });

    // 4
    it('POST /:id/sign with signerId targets that signer; other stays pending; envelope viewed not signed (all policy)', async () => {
        await seedBase(db);
        const { signers } = await createTwoSignerEnvelope(db, 'all');
        const signerB = signers[1];
        const { app, workflowCreate } = buildApp(db);
        const { ctx, settle } = makeExecCtx();

        const res = await app.request(`/${INSP_ID}/sign`, postSign({ signatureBase64: SIG, signerId: signerB.id }), FAKE_ENV, ctx);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.data.signerId).toBe(signerB.id);
        expect(body.data.envelopeStatus).not.toBe('signed');
        await settle();

        const fresh = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, signerB.requestId))
            .orderBy(asc(schema.agreementSigners.createdAt)).all();
        expect(fresh[0].status).toBe('sent'); // signer A untouched (pending/sent)
        expect(fresh[1].status).toBe('signed'); // signer B signed

        // envelope NOT completed → no workflow
        expect(workflowCreate).not.toHaveBeenCalled();
    });

    // 5
    it('POST /:id/sign twice → second returns alreadySigned, no double workflow/notification', async () => {
        await seedBase(db);
        const { app, workflowCreate, notificationCreate } = buildApp(db);

        const first = makeExecCtx();
        await app.request(`/${INSP_ID}/sign`, postSign({ signatureBase64: SIG }), FAKE_ENV, first.ctx);
        await first.settle();
        expect(workflowCreate).toHaveBeenCalledTimes(1);

        const second = makeExecCtx();
        const res2 = await app.request(`/${INSP_ID}/sign`, postSign({ signatureBase64: SIG }), FAKE_ENV, second.ctx);
        const body2 = await res2.json() as any;
        await second.settle();
        expect(body2.data.signed).toBe(true);
        expect(body2.data.alreadySigned).toBe(true);
        expect(workflowCreate).toHaveBeenCalledTimes(1); // not 2
        expect(notificationCreate).toHaveBeenCalledTimes(1); // not 2
    });

    // 6b — legacy envelope (createSigningRequest, no signer rows) → findOrCreate
    // synthesizes a default signer on reuse so on-site signing succeeds (no 409).
    it('POST /:id/sign on a legacy signer-less envelope synthesizes a signer and signs', async () => {
        await seedBase(db);
        // Create a legacy envelope via createSigningRequest — it has a distributed
        // plaintext token but NO agreement_signers rows.
        const legacySvc = new AgreementService({} as D1Database, { jwtSecret: JWT_SECRET });
        const legacy = await legacySvc.createSigningRequest(TENANT_ID, {
            agreementId: AGR_ID, clientEmail: 'jane@test.com', clientName: 'Jane', inspectionId: INSP_ID,
        });
        const before = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, legacy.id)).all();
        expect(before.length).toBe(0);

        // findOrCreate reuse should synthesize exactly one signer.
        const reuseSvc = new AgreementService({} as D1Database, { jwtSecret: JWT_SECRET });
        const reuse = await reuseSvc.findOrCreate(TENANT_ID, INSP_ID);
        expect(reuse.alreadyExists).toBe(true);
        expect(reuse.requestId).toBe(legacy.id);
        const after = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, legacy.id)).all();
        expect(after.length).toBe(1);

        // The on-site sign flow now succeeds (no spurious Conflict).
        const { app } = buildApp(db);
        const { ctx, settle } = makeExecCtx();
        const res = await app.request(`/${INSP_ID}/sign`, postSign({ signatureBase64: SIG }), FAKE_ENV, ctx);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.data.signed).toBe(true);
        expect(body.data.signerId).toBeTruthy();
        await settle();

        // Still only one signer row, now signed in_person.
        const signed = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, legacy.id)).all();
        expect(signed.length).toBe(1);
        expect(signed[0].status).toBe('signed');
        expect(signed[0].channel).toBe('in_person');
    });

    // 6
    it('POST /:id/sign with NO template → 409 no_agreement_template', async () => {
        await seedBase(db, { withTemplate: false });
        const { app } = buildApp(db);
        const res = await app.request(`/${INSP_ID}/sign`, postSign({ signatureBase64: SIG }), FAKE_ENV, makeExecCtx().ctx);
        expect(res.status).toBe(409);
        const body = await res.json() as any;
        expect(body.error.code).toBe('no_agreement_template');
    });

    // 8a — receipt email to the SIGNER on a non-completing in-person sign
    it('non-completing in-person sign emails the signer once (their own address)', async () => {
        await seedBase(db);
        const { signers } = await createTwoSignerEnvelope(db, 'all');
        const signerB = signers[1]; // john@test.com
        const { app, emailConfirm } = buildApp(db);
        const { ctx, settle } = makeExecCtx();

        await app.request(`/${INSP_ID}/sign`, postSign({ signatureBase64: SIG, signerId: signerB.id }), FAKE_ENV, ctx);
        await settle();

        expect(emailConfirm).toHaveBeenCalledTimes(1);
        expect(emailConfirm.mock.calls[0][0]).toBe('john@test.com');
    });

    // 8b — completing sign by the envelope client: only the completion email (no duplicate receipt)
    it('completing sign by the envelope client emails exactly once (completion only)', async () => {
        await seedBase(db);
        // single-signer envelope: the lone client both signs AND completes
        const { app, emailConfirm } = buildApp(db);
        const { ctx, settle } = makeExecCtx();

        await app.request(`/${INSP_ID}/sign`, postSign({ signatureBase64: SIG }), FAKE_ENV, ctx);
        await settle();

        expect(emailConfirm).toHaveBeenCalledTimes(1);
        expect(emailConfirm.mock.calls[0][0]).toBe('jane@test.com');
    });

    // 9 — terminal-state guard: declined signer → 409, no phantom audit event
    it('POST /:id/sign with signerId of a declined signer → 409, auditAppend NOT called, status stays declined', async () => {
        await seedBase(db);
        const { signers } = await createTwoSignerEnvelope(db, 'all');
        const signerA = signers[0];

        // Force signer A to declined state directly in DB.
        await db.update(schema.agreementSigners)
            .set({ status: 'declined' })
            .where(eq(schema.agreementSigners.id, signerA.id));

        const auditAppend = vi.fn().mockResolvedValue({ id: 'a', hash: 'h' });
        const { app } = buildApp(db, { auditAppend });
        const { ctx } = makeExecCtx();

        const res = await app.request(
            `/${INSP_ID}/sign`,
            postSign({ signatureBase64: SIG, signerId: signerA.id }),
            FAKE_ENV,
            ctx,
        );
        expect(res.status).toBe(409);

        // No phantom audit event must have been written.
        expect(auditAppend).not.toHaveBeenCalled();

        // DB row stays declined.
        const fresh = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.id, signerA.id)).get();
        expect(fresh?.status).toBe('declined');
    });

    // 10 — happy-path audit: auditAppend called with signer.signed + channel in_person
    it('POST /:id/sign (happy path) calls auditAppend with event signer.signed and channel in_person', async () => {
        await seedBase(db);
        const auditAppend = vi.fn().mockResolvedValue({ id: 'a', hash: 'h' });
        const { app } = buildApp(db, { auditAppend });
        const { ctx, settle } = makeExecCtx();

        const res = await app.request(`/${INSP_ID}/sign`, postSign({ signatureBase64: SIG }), FAKE_ENV, ctx);
        expect(res.status).toBe(200);
        await settle();

        // At least one audit call must be signer.signed with channel in_person.
        // (Single-signer envelope also fires agreement.signed on completion — that's fine.)
        expect(auditAppend).toHaveBeenCalled();
        const signerSignedCall = auditAppend.mock.calls.find((call) => call[2] === 'signer.signed');
        expect(signerSignedCall).toBeTruthy();
        // Fourth argument is the payload object.
        expect(signerSignedCall![3]).toMatchObject({ channel: 'in_person' });
    });
});

describe('signedByClient + dashboard truth read from the envelope (Track I-a Task 5)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(db);
        await db.insert(schema.tenants).values({
            id: TENANT_ID, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', maxUsers: 5, createdAt: new Date(),
        } as any);
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT_ID, propertyAddress: '1 Main St', clientName: 'Jane',
            clientEmail: 'jane@test.com', date: '2026-06-01', status: 'draft', paymentStatus: 'unpaid',
            price: 50000, agreementRequired: true, paymentRequired: false, createdAt: new Date(),
        } as any);
        await db.insert(schema.agreements).values({
            id: AGR_ID, tenantId: TENANT_ID, name: 'Standard Agreement',
            content: 'ORIGINAL agreement text', version: 1, createdAt: new Date(),
        } as any);
    });

    afterEach(() => sqlite.close());

    it('getInspection().signedByClient true from a signed envelope (no inspection_agreements row)', async () => {
        await db.insert(schema.agreementRequests).values({
            id: 'req-signed-1', tenantId: TENANT_ID, inspectionId: INSP_ID, agreementId: AGR_ID,
            clientEmail: 'jane@test.com', clientName: 'Jane', token: crypto.randomUUID(),
            status: 'signed', completionPolicy: 'all', createdAt: new Date(),
        } as any);

        const sdb = new ScopedDB(db as never, TENANT_ID);
        const svc = new InspectionService({} as D1Database, undefined, sdb);
        const { inspection } = await svc.getInspection(INSP_ID, TENANT_ID);
        expect(inspection.signedByClient).toBe(true);
    });

    it('getInspection().signedByClient false when only non-signed envelopes exist', async () => {
        await db.insert(schema.agreementRequests).values({
            id: 'req-sent-1', tenantId: TENANT_ID, inspectionId: INSP_ID, agreementId: AGR_ID,
            clientEmail: 'jane@test.com', clientName: 'Jane', token: crypto.randomUUID(),
            status: 'sent', completionPolicy: 'all', createdAt: new Date(),
        } as any);

        const sdb = new ScopedDB(db as never, TENANT_ID);
        const svc = new InspectionService({} as D1Database, undefined, sdb);
        const { inspection } = await svc.getInspection(INSP_ID, TENANT_ID);
        expect(inspection.signedByClient).toBe(false);
    });

    it('dashboard buckets agreementSigned flag reads from signed envelopes', async () => {
        // Date today so the inspection surfaces in the `today` bucket (a signed
        // envelope keeps it OUT of needsAttention, so it must be a dated bucket).
        const todayStr = new Date().toISOString().slice(0, 10);
        await db.update(schema.inspections).set({ date: todayStr, status: 'confirmed' })
            .where(eq(schema.inspections.id, INSP_ID));
        await db.insert(schema.agreementRequests).values({
            id: 'req-signed-2', tenantId: TENANT_ID, inspectionId: INSP_ID, agreementId: AGR_ID,
            clientEmail: 'jane@test.com', clientName: 'Jane', token: crypto.randomUUID(),
            status: 'signed', completionPolicy: 'all', createdAt: new Date(),
        } as any);

        const svc = new InspectionService({} as D1Database);
        const buckets = await svc.getDashboardBuckets(TENANT_ID) as Record<string, any>;
        const all = ['needsAttention', 'today', 'thisWeek', 'later', 'recentReports', 'cancelled']
            .flatMap((k) => (Array.isArray(buckets[k]) ? buckets[k] : []));
        const row = all.find((r: any) => r.id === INSP_ID);
        expect(row).toBeTruthy();
        expect((row as any).statusFlags.agreementSigned).toBe(true);
    });
});
