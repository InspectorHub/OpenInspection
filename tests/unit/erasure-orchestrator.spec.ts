import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { runErasure } from '../../server/lib/compliance/erasure-orchestrator';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-000000000002';
const SUBJECT_EMAIL = 'erase-me@test.com';
const OTHER_EMAIL = 'keep-me@test.com';

async function seedTenants(db: BetterSQLite3Database<typeof schema>) {
    await db.insert(schema.tenants).values([
        { id: TENANT_A, name: 'A', slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        { id: TENANT_B, name: 'B', slug: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    ]);
    await db.insert(schema.agreements).values([
        { id: 'agr-1', tenantId: TENANT_A, name: 'Standard', content: 'Agreement text', version: 1, createdAt: new Date() },
    ]);
}

/**
 * Seed a SIGNED multi-signer envelope for the subject (terminal state) plus a
 * second signer (co-client) with different PII, an inspection carrying the
 * subject's client columns, a contact row, and a tamper-evident audit chain.
 */
async function seedSignedEnvelope(db: BetterSQLite3Database<typeof schema>, signedAtMs: number) {
    const inspId = 'insp-signed';
    const reqId = 'req-signed';
    await db.insert(schema.inspections).values({
        id: inspId, tenantId: TENANT_A, propertyAddress: '1 Main St',
        clientName: 'Jane Subject', clientEmail: SUBJECT_EMAIL, clientPhone: '555-1111',
        date: '2026-06-01', status: 'completed', paymentStatus: 'unpaid', price: 50000, createdAt: new Date(),
    });
    await db.insert(schema.agreementRequests).values({
        id: reqId, tenantId: TENANT_A, inspectionId: inspId, agreementId: 'agr-1',
        clientEmail: SUBJECT_EMAIL, clientName: 'Jane Subject', token: 'tok-signed',
        status: 'signed', signatureBase64: 'env-sig-keep', signedAt: new Date(signedAtMs),
        completionPolicy: 'all', contentSnapshot: 'Agreement text', contentHash: 'hash-keep',
        createdAt: new Date(),
    });
    await db.insert(schema.agreementSigners).values([
        {
            id: 'signer-subject', tenantId: TENANT_A, requestId: reqId,
            name: 'Jane Subject', email: SUBJECT_EMAIL, role: 'client', status: 'signed',
            signatureBase64: 'subject-sig-keep', signedAt: new Date(signedAtMs), viewedAt: new Date(signedAtMs - 1000),
            ipAddress: '9.9.9.9', userAgent: 'Mozilla/Subject', channel: 'remote',
            onBehalfOf: 'Someone Else', onBehalfDisclaimer: 'authorized agent',
            createdAt: new Date(),
        },
        {
            id: 'signer-coclient', tenantId: TENANT_A, requestId: reqId,
            name: 'John Other', email: OTHER_EMAIL, role: 'co_client', status: 'signed',
            signatureBase64: 'other-sig-keep', signedAt: new Date(signedAtMs), channel: 'remote',
            ipAddress: '8.8.8.8', userAgent: 'Mozilla/Other',
            createdAt: new Date(),
        },
    ]);
    await db.insert(schema.contacts).values({
        id: 'contact-subject', tenantId: TENANT_A, type: 'client',
        name: 'Jane Subject', email: SUBJECT_EMAIL, phone: '555-1111', createdAt: new Date(),
    });
    // Tamper-evident audit chain — must remain UNTOUCHED.
    await db.insert(schema.esignAuditLogs).values([
        {
            id: 'audit-1', tenantId: TENANT_A, requestId: reqId, event: 'agreement.signed',
            payloadJson: JSON.stringify({ email: SUBJECT_EMAIL }), prevHash: null,
            hash: 'h1', signature: 'sig-chain-1', keyFingerprint: 'fp', createdAt: signedAtMs,
        },
    ]);
    return { inspId, reqId };
}

describe('runErasure', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: { close: () => void };

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(fixture.sqlite);
        await seedTenants(db);
    });

    it('signed agreement -> anonymized PII, signature + chain KEPT, log row w/ retentionExpiry + legalBasis', async () => {
        const signedAtMs = Date.UTC(2024, 0, 1);
        await seedSignedEnvelope(db, signedAtMs);

        const summary = await runErasure(db, {
            tenantId: TENANT_A, subjectEmail: SUBJECT_EMAIL, retentionYears: 6,
            requestedBy: 'admin-sub', identityBasis: 'admin_action',
        });

        expect(summary.status).toBe('completed');
        expect(summary.anonymizedCount).toBeGreaterThan(0);
        // retainedCount = 1 signer row + 1 envelope row anonymized under Art. 17(3)(e).
        expect(summary.retainedCount).toBe(2);
        expect(summary.logId).toBeTruthy();

        // Subject signer: PII fields cleared. name/email are NOT NULL columns ->
        // sentinel-cleared (no PII); nullable PII columns -> NULL.
        const subjectSigner = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.id, 'signer-subject')).get();
        expect(subjectSigner!.name).toBe('[erased]');
        expect(subjectSigner!.email).toBe('[erased]');
        expect(subjectSigner!.ipAddress).toBeNull();
        expect(subjectSigner!.userAgent).toBeNull();
        expect(subjectSigner!.onBehalfOf).toBeNull();
        expect(subjectSigner!.onBehalfDisclaimer).toBeNull();
        // KEPT evidence.
        expect(subjectSigner!.signatureBase64).toBe('subject-sig-keep');
        expect(subjectSigner!.signedAt).toBeTruthy();
        expect(subjectSigner!.viewedAt).toBeTruthy();
        expect(subjectSigner!.role).toBe('client');
        expect(subjectSigner!.channel).toBe('remote');

        // Envelope: clientName/clientEmail cleared, signature + snapshot/hash kept.
        const env = await db.select().from(schema.agreementRequests)
            .where(eq(schema.agreementRequests.id, 'req-signed')).get();
        expect(env!.clientName).toBeNull();
        expect(env!.clientEmail).toBe('[erased]'); // NOT NULL -> sentinel-cleared
        expect(env!.signatureBase64).toBe('env-sig-keep');
        expect(env!.contentSnapshot).toBe('Agreement text');
        expect(env!.contentHash).toBe('hash-keep');
        expect(env!.status).toBe('signed');

        // Audit chain UNTOUCHED.
        const audit = await db.select().from(schema.esignAuditLogs).all();
        expect(audit.length).toBe(1);
        expect(audit[0].signature).toBe('sig-chain-1');
        expect(audit[0].hash).toBe('h1');

        // Decision log written with anonymize + legalBasis + retentionExpiry.
        const logs = await db.select().from(schema.erasureLog).all();
        expect(logs.length).toBe(1);
        expect(logs[0].status).toBe('completed');
        expect(logs[0].subjectEmail).toBe(SUBJECT_EMAIL);
        expect(logs[0].requestedBy).toBe('admin-sub');
        const decisions = JSON.parse(logs[0].decisionsJson) as Array<Record<string, unknown>>;
        const signerDecision = decisions.find(d => d.table === 'agreement_signers' && d.action === 'anonymize');
        expect(signerDecision).toBeTruthy();
        expect(signerDecision!.legalBasis).toBe('art_17_3_e');
        // retentionExpiry = signedAt + 6 years, ms integer.
        const expectedExpiry = Date.UTC(2030, 0, 1);
        expect(signerDecision!.retentionExpiry).toBe(expectedExpiry);
    });

    it('other signers PII on the same envelope is NOT touched', async () => {
        await seedSignedEnvelope(db, Date.UTC(2024, 0, 1));
        await runErasure(db, { tenantId: TENANT_A, subjectEmail: SUBJECT_EMAIL, retentionYears: 6 });

        const coclient = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.id, 'signer-coclient')).get();
        expect(coclient!.name).toBe('John Other');
        expect(coclient!.email).toBe(OTHER_EMAIL);
        expect(coclient!.ipAddress).toBe('8.8.8.8');
    });

    it('draft/unsigned envelope -> envelope + signer rows DELETED', async () => {
        const inspId = 'insp-draft';
        const reqId = 'req-draft';
        await db.insert(schema.inspections).values({
            id: inspId, tenantId: TENANT_A, propertyAddress: '2 Main', clientName: 'Drafty',
            clientEmail: SUBJECT_EMAIL, date: '2026-06-02', status: 'draft', paymentStatus: 'unpaid', price: 1, createdAt: new Date(),
        });
        await db.insert(schema.agreementRequests).values({
            id: reqId, tenantId: TENANT_A, inspectionId: inspId, agreementId: 'agr-1',
            clientEmail: SUBJECT_EMAIL, clientName: 'Drafty', token: 'tok-draft',
            status: 'viewed', completionPolicy: 'all', createdAt: new Date(),
        });
        await db.insert(schema.agreementSigners).values({
            id: 'signer-draft', tenantId: TENANT_A, requestId: reqId,
            name: 'Drafty', email: SUBJECT_EMAIL, role: 'client', status: 'viewed', createdAt: new Date(),
        });

        const summary = await runErasure(db, { tenantId: TENANT_A, subjectEmail: SUBJECT_EMAIL, retentionYears: 6 });
        expect(summary.deletedCount).toBeGreaterThan(0);

        const env = await db.select().from(schema.agreementRequests)
            .where(eq(schema.agreementRequests.id, reqId)).get();
        expect(env).toBeUndefined();
        const signer = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.id, 'signer-draft')).get();
        expect(signer).toBeUndefined();

        const logs = await db.select().from(schema.erasureLog).all();
        const decisions = JSON.parse(logs[0].decisionsJson) as Array<Record<string, unknown>>;
        expect(decisions.some(d => d.action === 'delete')).toBe(true);
    });

    it('partially-signed envelope (policy=all, subject signed, co-signer pending) -> anonymize (NOT delete), evidence kept', async () => {
        // Envelope is NOT terminally signed (status 'viewed', signed_at NULL) but
        // ONE signer (the subject) has already signed with collected evidence.
        // Under completionPolicy 'all' the envelope stays incomplete until the
        // co-signer signs. The subject's signed row holds legal evidence that must
        // be anonymized-and-retained, NOT hard-deleted.
        const inspId = 'insp-partial';
        const reqId = 'req-partial';
        const subjectSignedAtMs = Date.UTC(2024, 5, 15);
        await db.insert(schema.inspections).values({
            id: inspId, tenantId: TENANT_A, propertyAddress: '4 Main',
            clientName: 'Jane Subject', clientEmail: SUBJECT_EMAIL, clientPhone: '555-2222',
            date: '2026-06-04', status: 'in_progress', paymentStatus: 'unpaid', price: 1, createdAt: new Date(),
        });
        await db.insert(schema.agreementRequests).values({
            id: reqId, tenantId: TENANT_A, inspectionId: inspId, agreementId: 'agr-1',
            clientEmail: SUBJECT_EMAIL, clientName: 'Jane Subject', token: 'tok-partial',
            status: 'viewed', signedAt: null, completionPolicy: 'all',
            contentSnapshot: 'Agreement text', contentHash: 'hash-partial', createdAt: new Date(),
        });
        await db.insert(schema.agreementSigners).values([
            {
                id: 'signer-partial-subject', tenantId: TENANT_A, requestId: reqId,
                name: 'Jane Subject', email: SUBJECT_EMAIL, role: 'client', status: 'signed',
                signatureBase64: 'partial-subject-sig-keep',
                signedAt: new Date(subjectSignedAtMs), viewedAt: new Date(subjectSignedAtMs - 1000),
                ipAddress: '7.7.7.7', userAgent: 'Mozilla/Subject', channel: 'remote', createdAt: new Date(),
            },
            {
                id: 'signer-partial-pending', tenantId: TENANT_A, requestId: reqId,
                name: 'John Pending', email: OTHER_EMAIL, role: 'co_client', status: 'pending',
                createdAt: new Date(),
            },
        ]);

        const summary = await runErasure(db, {
            tenantId: TENANT_A, subjectEmail: SUBJECT_EMAIL, retentionYears: 6,
        });

        // The envelope must NOT be deleted.
        const env = await db.select().from(schema.agreementRequests)
            .where(eq(schema.agreementRequests.id, reqId)).get();
        expect(env).toBeTruthy();
        expect(env!.clientName).toBeNull();
        expect(env!.clientEmail).toBe('[erased]'); // NOT NULL -> sentinel-cleared
        expect(env!.status).toBe('viewed'); // status untouched

        // Subject's signed row: anonymized but signature + signed_at KEPT.
        const subjectSigner = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.id, 'signer-partial-subject')).get();
        expect(subjectSigner).toBeTruthy();
        expect(subjectSigner!.name).toBe('[erased]');
        expect(subjectSigner!.email).toBe('[erased]');
        expect(subjectSigner!.ipAddress).toBeNull();
        expect(subjectSigner!.userAgent).toBeNull();
        expect(subjectSigner!.signatureBase64).toBe('partial-subject-sig-keep');
        expect(subjectSigner!.signedAt).toBeTruthy();

        // Decision log: anonymize action with legalBasis art_17_3_e (NOT delete).
        const logs = await db.select().from(schema.erasureLog).all();
        const decisions = JSON.parse(logs[0].decisionsJson) as Array<Record<string, unknown>>;
        const signerDecision = decisions.find(d => d.table === 'agreement_signers' && d.action === 'anonymize');
        expect(signerDecision).toBeTruthy();
        expect(signerDecision!.legalBasis).toBe('art_17_3_e');
        // retentionExpiry anchors to the subject signer's signed_at (envelope signedAt is NULL).
        expect(signerDecision!.retentionExpiry).toBe(Date.UTC(2030, 5, 15));
        // No delete decision for the agreement tables.
        expect(decisions.some(d => d.table === 'agreement_requests' && d.action === 'delete')).toBe(false);
    });

    it('non-agreement client PII (inspections + contacts) -> nulled', async () => {
        await seedSignedEnvelope(db, Date.UTC(2024, 0, 1));
        await runErasure(db, { tenantId: TENANT_A, subjectEmail: SUBJECT_EMAIL, retentionYears: 6 });

        const insp = await db.select().from(schema.inspections)
            .where(eq(schema.inspections.id, 'insp-signed')).get();
        expect(insp!.clientName).toBeNull();
        expect(insp!.clientEmail).toBeNull();
        expect(insp!.clientPhone).toBeNull();

        // contacts.name is NOT NULL -> the CRM contact row is deleted outright.
        const contact = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.id, 'contact-subject')).get();
        expect(contact).toBeUndefined();
    });

    it('tenant-scoped: other tenant rows with same email untouched', async () => {
        await seedSignedEnvelope(db, Date.UTC(2024, 0, 1));
        await db.insert(schema.inspections).values({
            id: 'insp-other-tenant', tenantId: TENANT_B, propertyAddress: '3 Main',
            clientName: 'Cross', clientEmail: SUBJECT_EMAIL, date: '2026-06-03',
            status: 'draft', paymentStatus: 'unpaid', price: 1, createdAt: new Date(),
        });

        await runErasure(db, { tenantId: TENANT_A, subjectEmail: SUBJECT_EMAIL, retentionYears: 6 });

        const other = await db.select().from(schema.inspections)
            .where(eq(schema.inspections.id, 'insp-other-tenant')).get();
        expect(other!.clientName).toBe('Cross');
        expect(other!.clientEmail).toBe(SUBJECT_EMAIL);
    });

    it('idempotent re-run -> 0 new anonymizations, still writes a log row', async () => {
        await seedSignedEnvelope(db, Date.UTC(2024, 0, 1));
        const first = await runErasure(db, { tenantId: TENANT_A, subjectEmail: SUBJECT_EMAIL, retentionYears: 6 });
        expect(first.anonymizedCount).toBeGreaterThan(0);

        const second = await runErasure(db, { tenantId: TENANT_A, subjectEmail: SUBJECT_EMAIL, retentionYears: 6 });
        expect(second.anonymizedCount).toBe(0);
        expect(second.deletedCount).toBe(0);
        expect(second.status).toBe('completed');

        const logs = await db.select().from(schema.erasureLog).all();
        expect(logs.length).toBe(2);
    });

    it('partial failure -> status partially_completed, landed decisions still recorded', async () => {
        await seedSignedEnvelope(db, Date.UTC(2024, 0, 1));

        // Force the inspections UPDATE step to throw by monkeypatching db.update
        // so that ONLY the inspections table call rejects; everything else lands.
        const realUpdate = db.update.bind(db);
        const spy = vi.spyOn(db, 'update').mockImplementation(((table: unknown) => {
            if (table === schema.inspections) {
                return {
                    set: () => ({ where: () => ({ run: () => { throw new Error('forced inspections failure'); } }) }),
                } as never;
            }
            return realUpdate(table as never);
        }) as never);

        const summary = await runErasure(db, { tenantId: TENANT_A, subjectEmail: SUBJECT_EMAIL, retentionYears: 6 });
        spy.mockRestore();

        expect(summary.status).toBe('partially_completed');

        // The signer anonymize (different step) still landed.
        const subjectSigner = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.id, 'signer-subject')).get();
        expect(subjectSigner!.email).toBe('[erased]');

        // A log row was written reflecting the partial status, with the error noted.
        const logs = await db.select().from(schema.erasureLog).all();
        expect(logs.length).toBe(1);
        expect(logs[0].status).toBe('partially_completed');
        const decisions = JSON.parse(logs[0].decisionsJson) as Array<Record<string, unknown>>;
        expect(decisions.some(d => d.error)).toBe(true);
    });
});
