import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { applySubjectErase, type SubjectErasedReply } from '../../../server/portal/apply-subject-commands';
import {
    cmdSubjectEraseDataSchema,
    cmdSubjectExportDataSchema,
    isKnownCmd,
} from '../../../server/lib/sync-events/cmd-envelope';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

/**
 * Privacy P3 — what core sends back on `cmd.subject.erase`.
 *
 * Portal marks a DSAR `completed` only when the coverage disclosure has landed,
 * so the reply payload IS the compliance record. These assertions are about the
 * two ways that record can be false: a disclosure that is missing, and a
 * "completed" emitted for a run that did not complete.
 */

const TENANT_A = '00000000-0000-0000-0000-0000000000c1';
const SUBJECT = 'erase-me@example.com';
const REPLYTO = 'dsar:req-42';

/**
 * Narrow a reply to the branch that actually erased something.
 *
 * `SubjectErasedReply` became a union when a preservation order gained its own
 * outcome, and every assertion in this file is about the erased branch. The
 * discriminant is ASSERTED rather than cast: a reply that came back `held`
 * should fail here saying so, not fail three lines later on a missing property.
 */
function erased(reply: SubjectErasedReply): Extract<SubjectErasedReply, { outcome: 'erased' }> {
    expect(reply.outcome).toBe('erased');
    if (reply.outcome !== 'erased') throw new Error(`expected an erased reply, got '${reply.outcome}'`);
    return reply;
}

describe('applySubjectErase', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: { close: () => void; exec: (sql: string) => unknown };

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite as unknown as typeof sqlite;
        await setupSchema(fixture.sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT_A, slug: 'a', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(asD1Db(db), TENANT_A, new Date(1));
        await db.insert(schema.contacts).values({
            id: 'c-1', tenantId: TENANT_A, type: 'client', name: 'Subject',
            email: SUBJECT, phone: '+15555550123', createdAt: new Date(),
        });
        await db.insert(schema.inspections).values({
            id: 'insp-1', tenantId: TENANT_A, propertyAddress: '1 Main St', date: '2026-06-01',
            status: 'completed', paymentStatus: 'unpaid', price: 50000, createdAt: new Date(),
        });
        await db.insert(schema.inspectionPeople).values({
            id: 'ip-1', tenantId: TENANT_A, inspectionId: 'insp-1', contactId: 'c-1',
            roleProfileId: `crp_${TENANT_A}_client`, createdAt: new Date(),
        });
        await db.insert(schema.notificationPreferences).values({
            id: 'np-1', tenantId: TENANT_A, subjectKind: 'contact', subjectId: 'c-1',
            classId: 'report_ready', channel: 'email', enabled: false,
            createdAt: new Date(), updatedAt: new Date(),
        });
    });

    it('replies with a coverage disclosure — the thing portal refuses to complete without', async () => {
        const reply = erased(await applySubjectErase(db, { tenantId: TENANT_A, subjectEmail: SUBJECT }, { requestedBy: REPLYTO }));
        expect(reply.coverage).toBeDefined();
        expect(reply.coverage.catalogueIsAdvisory).toBe(true);
        expect(reply.coverage.pendingRules.length).toBe(reply.coverage.pendingEnforcementCount);
        // eslint-disable-next-line no-console
        console.log(`[erase] executedTables=${reply.coverage.executedTables.join(', ')}; deleted=${reply.deletedCount}, anonymized=${reply.anonymizedCount}, retained=${reply.retainedCount}`);
        expect(reply.coverage.executedTables).toContain('contacts');
        expect(reply.deletedCount).toBeGreaterThan(0);
    });

    it('discloses the EMAIL axis, because that is the only axis runErasure has', async () => {
        const reply = erased(await applySubjectErase(db, { tenantId: TENANT_A, subjectEmail: SUBJECT }));
        expect(reply.coverage.subjectAxis).toBe('email');
    });

    it('actually erases — the contact is gone and the log row records why', async () => {
        await applySubjectErase(db, { tenantId: TENANT_A, subjectEmail: SUBJECT }, { requestedBy: REPLYTO });
        const remaining = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.email, SUBJECT)).all();
        expect(remaining).toEqual([]);
        const log = await db.select().from(schema.erasureLog)
            .where(eq(schema.erasureLog.subjectEmail, SUBJECT)).get();
        expect(log?.status).toBe('completed');
        // The console record that authorised the run travels into the
        // append-only log, so the accountability trail points both ways.
        expect(log?.requestedBy).toBe(REPLYTO);
        expect(log?.identityBasis).toBe('portal_dsar');
    });

    it('a PARTIAL run throws instead of replying — no "completed" for tables nothing touched', async () => {
        // `notification_preferences` is reached only from inside a fail-closed
        // step(), so removing it produces exactly the partial run this guard is
        // for, without derailing the whole orchestrator.
        sqlite.exec('DROP TABLE notification_preferences;');
        await expect(applySubjectErase(db, { tenantId: TENANT_A, subjectEmail: SUBJECT }))
            .rejects.toThrow(/partially_completed/);
        // The erasure that DID happen is still recorded — the refusal is about
        // what core tells portal, not about rolling work back.
        const log = await db.select().from(schema.erasureLog)
            .where(eq(schema.erasureLog.subjectEmail, SUBJECT)).get();
        expect(log?.status).toBe('partially_completed');
    });

    it('is idempotent — a queue redelivery finds nothing left and still completes', async () => {
        const first = erased(await applySubjectErase(db, { tenantId: TENANT_A, subjectEmail: SUBJECT }));
        const second = erased(await applySubjectErase(db, { tenantId: TENANT_A, subjectEmail: SUBJECT }));
        expect(first.deletedCount).toBeGreaterThan(0);
        expect(second.deletedCount).toBe(0);
        expect(second.coverage.executedTables).toEqual([]);
    });
});

describe('subject command payload contracts', () => {
    it('cmd.subject.erase REFUSES a phone rather than accepting and dropping it', () => {
        // The failure mode this prevents: a phone that validates, rides the
        // queue, reaches the applier, is ignored by every query, and leaves
        // portal recording a completed erasure for data nothing examined.
        const withPhone = { tenantId: 't1', subjectEmail: 'a@b.com', subjectPhone: '+15555550123' };
        expect(cmdSubjectEraseDataSchema.safeParse(withPhone).success).toBe(false);
        expect(cmdSubjectEraseDataSchema.safeParse({ tenantId: 't1', subjectEmail: 'a@b.com' }).success).toBe(true);
    });

    it('cmd.subject.export ACCEPTS a phone, because the assembler queries on it', () => {
        const parsed = cmdSubjectExportDataSchema.safeParse({
            tenantId: 't1', subjectEmail: 'a@b.com', subjectPhone: '+15555550123', r2Key: 'k',
        });
        expect(parsed.success).toBe(true);
        // Still strict about everything else.
        expect(cmdSubjectExportDataSchema.safeParse({
            tenantId: 't1', subjectEmail: 'a@b.com', r2Key: 'k', subjectSsn: '000',
        }).success).toBe(false);
    });

    it('both types are registered at v1 and nothing else', () => {
        expect(isKnownCmd('io.inspectorhub.cmd.subject.export', 'cmd-subject-export/v1')).toBe(true);
        expect(isKnownCmd('io.inspectorhub.cmd.subject.erase', 'cmd-subject-erase/v1')).toBe(true);
        expect(isKnownCmd('io.inspectorhub.cmd.subject.erase', 'cmd-subject-erase/v2')).toBe(false);
    });
});
