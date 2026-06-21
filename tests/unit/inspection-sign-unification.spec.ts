import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq, asc } from 'drizzle-orm';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import { AgreementService } from '../../server/services/agreement.service';
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

import {
    TENANT_ID, INSP_ID, AGR_ID, JWT_SECRET, FAKE_ENV,
    makeExecCtx, buildApp, seedBase, createTwoSignerEnvelope, SIG, postSign, postAgreementRequest,
} from './helpers/inspection-sign-unification-setup';

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

    // 6b — legacy envelope (pre-envelope-v2, no signer rows) → findOrCreate
    // synthesizes a default signer on reuse so on-site signing succeeds (no 409).
    it('POST /:id/sign on a legacy signer-less envelope synthesizes a signer and signs', async () => {
        await seedBase(db);
        // Simulate a legacy envelope created before the per-signer tier was added:
        // insert the request row directly with a distributed plaintext token but
        // NO agreement_signers rows (mirrors the old createSigningRequest shape).
        const legacyReqId = crypto.randomUUID();
        const legacyPlainToken = 'legacy-plain-token-' + crypto.randomUUID().replace(/-/g, '');
        await db.insert(schema.agreementRequests).values({
            id: legacyReqId, tenantId: TENANT_ID, inspectionId: INSP_ID, agreementId: AGR_ID,
            clientEmail: 'jane@test.com', clientName: 'Jane',
            token: legacyPlainToken,
            status: 'sent', completionPolicy: 'all', createdAt: new Date(),
        });
        const before = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, legacyReqId)).all();
        expect(before.length).toBe(0);

        // findOrCreate reuse should synthesize exactly one signer.
        const reuseSvc = new AgreementService({} as D1Database, { jwtSecret: JWT_SECRET });
        const reuse = await reuseSvc.findOrCreate(TENANT_ID, INSP_ID);
        expect(reuse.alreadyExists).toBe(true);
        expect(reuse.requestId).toBe(legacyReqId);
        const after = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, legacyReqId)).all();
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
            .where(eq(schema.agreementSigners.requestId, legacyReqId)).all();
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

describe('POST /:id/agreement-requests routes through findOrCreate (Task 2)', () => {
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

    // T2-1 — happy path: creates a 1-signer envelope, status sent, emails client
    it('creates a 1-signer envelope (findOrCreate), returns sent status, emails the client', async () => {
        await seedBase(db);
        const emailAgreementRequest = vi.fn().mockResolvedValue(undefined);
        const { app } = buildApp(db, { emailAgreementRequest });
        const { ctx } = makeExecCtx();

        const res = await app.request(
            `/${INSP_ID}/agreement-requests`,
            postAgreementRequest(),
            FAKE_ENV,
            ctx,
        );
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.success).toBe(true);
        expect(body.data.status).toBe('sent');
        expect(body.data.clientEmail).toBe('jane@test.com');
        expect(body.data.id).toBeTruthy();

        // A 1-signer envelope row + 1 signer row must exist
        const { agreementRequests, agreementSigners } = schema;
        const { eq } = await import('drizzle-orm');
        const reqs = await db.select().from(agreementRequests)
            .where(eq(agreementRequests.inspectionId, INSP_ID)).all();
        expect(reqs.length).toBe(1);
        expect(reqs[0].status).toBe('sent');

        const signers = await db.select().from(agreementSigners)
            .where(eq(agreementSigners.requestId, reqs[0].id)).all();
        expect(signers.length).toBe(1);
        expect(signers[0].email).toBe('jane@test.com');
        expect(signers[0].role).toBe('client');

        // Client must receive the agreement email with a per-signer token URL
        expect(emailAgreementRequest).toHaveBeenCalledTimes(1);
        const [toEmail, , agreementName, signUrl] = emailAgreementRequest.mock.calls[0];
        expect(toEmail).toBe('jane@test.com');
        expect(agreementName).toBe('Standard Agreement');
        expect(signUrl).toContain('/sign/');
    });

    // T2-2 — idempotent: second call reuses the same envelope, does NOT create a second request row
    it('second POST reuses the existing envelope (idempotent findOrCreate)', async () => {
        await seedBase(db);
        const { app } = buildApp(db);
        const ctx1 = makeExecCtx();
        const ctx2 = makeExecCtx();

        await app.request(`/${INSP_ID}/agreement-requests`, postAgreementRequest(), FAKE_ENV, ctx1.ctx);
        const res2 = await app.request(`/${INSP_ID}/agreement-requests`, postAgreementRequest(), FAKE_ENV, ctx2.ctx);
        expect(res2.status).toBe(200);

        const { agreementRequests } = schema;
        const { eq } = await import('drizzle-orm');
        const reqs = await db.select().from(agreementRequests)
            .where(eq(agreementRequests.inspectionId, INSP_ID)).all();
        expect(reqs.length).toBe(1);
    });

    // T2-3 — 422 when no template exists
    it('422 when no agreement template configured', async () => {
        await seedBase(db, { withTemplate: false });
        const { app } = buildApp(db);
        const { ctx } = makeExecCtx();

        const res = await app.request(
            `/${INSP_ID}/agreement-requests`,
            postAgreementRequest(),
            FAKE_ENV,
            ctx,
        );
        expect(res.status).toBe(422);
    });
});
