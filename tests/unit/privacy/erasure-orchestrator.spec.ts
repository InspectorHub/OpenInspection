import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { runErasure } from '../../../server/lib/compliance/erasure-orchestrator';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { PeopleService } from '../../../server/services/people.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// PeopleService.getPrimaryClient resolves `drizzle(env.DB)` internally
// (drizzle-orm/d1); mock it to return this test's better-sqlite3 instance so
// the compliance-proof assertion below exercises the SAME live read path
// production code uses (getInspection/listInspections/agreements all call
// through PeopleService too).
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

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
 * second signer (co-client) with different PII, an inspection linked to the
 * subject via `inspection_people` (the LIVE client-identity path — the
 * `inspections.client_*` columns are a frozen, unread cache and are
 * intentionally left NULL here to prove the orchestrator does not depend on
 * them), a contact row, and a tamper-evident audit chain.
 */
async function seedSignedEnvelope(db: BetterSQLite3Database<typeof schema>, signedAtMs: number) {
    const inspId = 'insp-signed';
    const reqId = 'req-signed';
    await seedRoleProfiles(db, TENANT_A, new Date(1));
    await db.insert(schema.inspections).values({
        id: inspId, tenantId: TENANT_A, propertyAddress: '1 Main St',
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
    // The live client-identity link (inspection <-> contact <-> 'client' role).
    await db.insert(schema.inspectionPeople).values({
        id: 'ip-subject', tenantId: TENANT_A, inspectionId: inspId,
        contactId: 'contact-subject', roleProfileId: `crp_${TENANT_A}_client`, createdAt: new Date(),
    });
    // Tamper-evident audit chain — must remain UNTOUCHED.
    await db.insert(schema.esignAuditLogs).values([
        {
            id: 'audit-1', tenantId: TENANT_A, requestId: reqId, event: 'agreement.signed',
            payloadJson: JSON.stringify({ email: SUBJECT_EMAIL }), prevHash: null,
            hash: 'h1', signature: 'sig-chain-1', keyFingerprint: 'fp', createdAt: new Date(signedAtMs),
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
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
            clientEmail: SUBJECT_EMAIL, date: '2026-06-02', status: 'requested', paymentStatus: 'unpaid', price: 1, createdAt: new Date(),
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
            date: '2026-06-04', status: 'completed', reportStatus: 'in_progress', paymentStatus: 'unpaid', price: 1, createdAt: new Date(),
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

    it('non-agreement client PII (contacts + inspection_people) -> actually erased from every live read path', async () => {
        const { inspId } = await seedSignedEnvelope(db, Date.UTC(2024, 0, 1));
        const summary = await runErasure(db, { tenantId: TENANT_A, subjectEmail: SUBJECT_EMAIL, retentionYears: 6 });

        // contacts.name is NOT NULL -> the CRM contact row (the LIVE source of
        // client PII) is deleted outright.
        const contact = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.id, 'contact-subject')).get();
        expect(contact).toBeUndefined();

        // The inspection_people row that linked the inspection to that contact
        // is gone too — orphan cleanup, ordered BEFORE the contacts delete so
        // it can still resolve the contact id via contacts.email.
        const ip = await db.select().from(schema.inspectionPeople)
            .where(eq(schema.inspectionPeople.contactId, 'contact-subject')).all();
        expect(ip.length).toBe(0);

        // Compliance proof: the SAME primary-client join production code reads
        // through (getInspection/listInspections/agreements all call
        // PeopleService.getPrimaryClient) now resolves to null for this subject
        // — the client is provably gone, not just relocated.
        const people = new PeopleService({ DB: {} as D1Database });
        const primary = await people.getPrimaryClient(TENANT_A, inspId);
        expect(primary).toBeNull();

        // Decision log recorded both steps.
        const decisions = summary.decisions;
        expect(decisions.some(d => d.table === 'contacts' && d.action === 'delete' && d.count > 0)).toBe(true);
        expect(decisions.some(d => d.table === 'inspection_people' && d.action === 'delete' && d.count > 0)).toBe(true);

        // Task 13 — inspections.client_name/client_email/client_phone (the
        // legacy cache this orchestrator never wrote) are dropped columns now,
        // not just an unread cache. Nothing left to assert on that row.
        const insp = await db.select().from(schema.inspections)
            .where(eq(schema.inspections.id, inspId)).get();
        expect(insp).toBeTruthy();
    });

    it('tenant-scoped: other tenant contact + inspection_people rows with same email untouched', async () => {
        await seedSignedEnvelope(db, Date.UTC(2024, 0, 1));
        await seedRoleProfiles(db, TENANT_B, new Date(1));
        await db.insert(schema.inspections).values({
            id: 'insp-other-tenant', tenantId: TENANT_B, propertyAddress: '3 Main',
            date: '2026-06-03', status: 'requested', paymentStatus: 'unpaid', price: 1, createdAt: new Date(),
        });
        await db.insert(schema.contacts).values({
            id: 'contact-other-tenant', tenantId: TENANT_B, type: 'client',
            name: 'Cross', email: SUBJECT_EMAIL, createdAt: new Date(),
        });
        await db.insert(schema.inspectionPeople).values({
            id: 'ip-other-tenant', tenantId: TENANT_B, inspectionId: 'insp-other-tenant',
            contactId: 'contact-other-tenant', roleProfileId: `crp_${TENANT_B}_client`, createdAt: new Date(),
        });

        await runErasure(db, { tenantId: TENANT_A, subjectEmail: SUBJECT_EMAIL, retentionYears: 6 });

        const otherContact = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.id, 'contact-other-tenant')).get();
        expect(otherContact).toBeTruthy();
        expect(otherContact!.email).toBe(SUBJECT_EMAIL);

        const otherIp = await db.select().from(schema.inspectionPeople)
            .where(eq(schema.inspectionPeople.id, 'ip-other-tenant')).get();
        expect(otherIp).toBeTruthy();
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

        // Force the inspection_people orphan-cleanup DELETE to throw by
        // monkeypatching db.delete so that ONLY that step rejects; everything
        // else (signer anonymize, the later contacts delete) still lands.
        const realDelete = db.delete.bind(db);
        const spy = vi.spyOn(db, 'delete').mockImplementation(((table: unknown) => {
            if (table === schema.inspectionPeople) {
                return {
                    where: () => ({ run: () => { throw new Error('forced inspection_people failure'); } }),
                } as never;
            }
            return realDelete(table as never);
        }) as never);

        const summary = await runErasure(db, { tenantId: TENANT_A, subjectEmail: SUBJECT_EMAIL, retentionYears: 6 });
        spy.mockRestore();

        expect(summary.status).toBe('partially_completed');

        // The signer anonymize (different step) still landed.
        const subjectSigner = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.id, 'signer-subject')).get();
        expect(subjectSigner!.email).toBe('[erased]');

        // The contacts delete (a later, independent step) still landed too —
        // the subject's client PII is still actually erased even though the
        // orphan-cleanup step failed.
        const contact = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.id, 'contact-subject')).get();
        expect(contact).toBeUndefined();

        // A log row was written reflecting the partial status, with the error noted.
        const logs = await db.select().from(schema.erasureLog).all();
        expect(logs.length).toBe(1);
        expect(logs[0].status).toBe('partially_completed');
        const decisions = JSON.parse(logs[0].decisionsJson) as Array<Record<string, unknown>>;
        expect(decisions.some(d => d.error)).toBe(true);
    });
});
