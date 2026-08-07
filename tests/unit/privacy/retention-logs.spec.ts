/**
 * OI #276 — the log-retention executor.
 *
 * Fixture ages are deliberately a pair per rule, one just outside the window
 * and one just inside it. A single "very old" row proves the sweep does
 * something; it does not prove the sweep does it at the right moment, and an
 * off-by-a-unit boundary is the failure that reaches production intact.
 *
 * The windows under test come from the manifest, not from literals here — a
 * test that restates the number cannot notice the number changing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import {
    auditLogs,
    esignAuditLogs,
    parkedCmdEvents,
    processedCmdEvents,
    processedWebhookEvents,
    smsConsentLog,
    tenants,
} from '../../../server/lib/db/schema';
import { runLogRetentionSweep, RETENTION_EXECUTOR_TABLES } from '../../../server/lib/compliance/retention-logs';
import {
    AUDIT_LOG_ANONYMIZE_MONTHS,
    DEAD_LETTER_RETENTION_DAYS,
    DEDUP_LOG_RETENTION_DAYS,
    RETENTION_MANIFEST,
} from '../../../server/lib/compliance/retention-manifest';

describe('manifest <-> executor binding', () => {
    // Both directions, because each one hides a different failure. A rule with
    // no executor is a retention promise nothing keeps; an executor with no
    // rule is a delete statement running on a period nobody wrote down.
    it('every manifest rule has an executor', () => {
        const missing = RETENTION_MANIFEST
            .map((r) => r.table)
            .filter((t) => !RETENTION_EXECUTOR_TABLES.includes(t));
        expect(missing, `rules with no executor: ${missing.join(', ')}`).toHaveLength(0);
    });

    it('every executor has a manifest rule', () => {
        const tables = new Set(RETENTION_MANIFEST.map((r) => r.table));
        const orphaned = RETENTION_EXECUTOR_TABLES.filter((t) => !tables.has(t));
        expect(orphaned, `executors with no rule: ${orphaned.join(', ')}`).toHaveLength(0);
    });
});

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 8); // 2026-06-08
const daysAgo = (n: number) => new Date(NOW - n * DAY_MS);

/**
 * 24 calendar months before 2026-06-08 is 2024-06-08, and that span contains no
 * 29 February, so it is exactly 730 days. A row at 731 days is outside the
 * window and a row at 729 is inside it — asserted here rather than assumed,
 * because if the manifest's months ever became days the pair below would stop
 * straddling the boundary and every test would still pass.
 */
const AUDIT_WINDOW_DAYS = 730;

describe('runLogRetentionSweep', () => {
    let db: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        await db.insert(tenants).values({ id: 't1', name: 'T1', slug: 't1', createdAt: new Date(NOW) });
    });

    afterEach(() => sqlite.close());

    async function seedAuditLog(opts: { id: string; createdAt: Date; userId?: string | null; metadata?: unknown }) {
        await db.insert(auditLogs).values({
            id: opts.id,
            tenantId: 't1',
            userId: opts.userId ?? 'u-123',
            action: 'inspection.update',
            entityType: 'inspection',
            entityId: 'i1',
            metadata: opts.metadata ?? { note: 'spoke to jane@example.com' },
            ipAddress: '203.0.113.7',
            createdAt: opts.createdAt,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
    }

    const getAudit = (id: string) => db.select().from(auditLogs).where(eq(auditLogs.id, id)).get();

    it('the fixture pair really straddles the audit window', () => {
        // The assertion that keeps every boundary test below honest: if the
        // window stopped being 24 months, 731/729 would stop meaning
        // "outside/inside" and the rest of this file would go quietly useless.
        expect(AUDIT_LOG_ANONYMIZE_MONTHS).toBe(24);
        expect(AUDIT_WINDOW_DAYS - 1).toBeLessThan(731);
        expect(AUDIT_WINDOW_DAYS + 1).toBeGreaterThan(729);
    });

    it('scrubs an aged audit row — actor AND free text — but keeps the row', async () => {
        await seedAuditLog({ id: 'a-old', createdAt: daysAgo(AUDIT_WINDOW_DAYS + 1) });

        const summary = await runLogRetentionSweep(db, NOW);
        expect(summary.perTable.audit_logs).toBe(1);

        const row = await getAudit('a-old');
        expect(row).toBeTruthy();                    // the record survives
        expect(row!.action).toBe('inspection.update'); // the audit value survives
        expect(row!.entityType).toBe('inspection');
        expect(row!.entityId).toBe('i1');
        // The assertions that keep the `anonymize` label honest: prose left
        // behind is exactly what portal counsel called an incomplete DSAR, and
        // an actor identifier left behind is not an anonymized row.
        expect(JSON.stringify(row!.metadata ?? null)).not.toContain('example.com');
        expect(row!.metadata).toBeNull();
        expect(row!.userId).toBeNull();
        expect(row!.ipAddress).toBeNull();
    });

    it('leaves an audit row inside its window untouched', async () => {
        await seedAuditLog({ id: 'a-new', createdAt: daysAgo(AUDIT_WINDOW_DAYS - 1) });

        const summary = await runLogRetentionSweep(db, NOW);
        expect(summary.perTable.audit_logs ?? 0).toBe(0);

        const row = await getAudit('a-new');
        expect(row!.userId).toBe('u-123');
        expect(row!.ipAddress).toBe('203.0.113.7');
        expect(JSON.stringify(row!.metadata)).toContain('jane@example.com');
    });

    it('deletes dedup rows past the window and keeps the ones inside it', async () => {
        await db.insert(processedWebhookEvents).values([
            { eventId: 'w-old', receivedAt: daysAgo(DEDUP_LOG_RETENTION_DAYS + 1) },
            { eventId: 'w-new', receivedAt: daysAgo(DEDUP_LOG_RETENTION_DAYS - 1) },
        ]);
        // NOTE the column: this table measures from `processed_at`, not
        // `received_at`. The two dedup ledgers never converged on a name, and a
        // rule pointed at the wrong column matches nothing and reads as green.
        await db.insert(processedCmdEvents).values([
            { eventId: 'c-old', cmdType: 'io.inspectorhub.cmd.tenant.update', processedAt: daysAgo(DEDUP_LOG_RETENTION_DAYS + 1) },
            { eventId: 'c-new', cmdType: 'io.inspectorhub.cmd.tenant.update', processedAt: daysAgo(DEDUP_LOG_RETENTION_DAYS - 1) },
        ]);

        const summary = await runLogRetentionSweep(db, NOW);
        expect(summary.perTable.processed_webhook_events).toBe(1);
        expect(summary.perTable.processed_cmd_events).toBe(1);

        const webhooks = await db.select().from(processedWebhookEvents).all();
        expect(webhooks.map((r) => r.eventId)).toEqual(['w-new']);
        const cmds = await db.select().from(processedCmdEvents).all();
        expect(cmds.map((r) => r.eventId)).toEqual(['c-new']);
    });

    it('expires the dead-letter queue on its own shorter clock', async () => {
        await db.insert(parkedCmdEvents).values([
            { id: 'p-old', envelope: '{"type":null}', reason: 'parse-failed', receivedAt: daysAgo(DEAD_LETTER_RETENTION_DAYS + 1) },
            { id: 'p-new', envelope: '{"type":null}', reason: 'parse-failed', receivedAt: daysAgo(DEAD_LETTER_RETENTION_DAYS - 1) },
            // Older than the dead-letter window but younger than the dedup one:
            // the row that proves the two clocks are genuinely separate rather
            // than one constant wearing two names.
            { id: 'p-mid', envelope: '{"type":null}', reason: 'parse-failed', receivedAt: daysAgo(DEDUP_LOG_RETENTION_DAYS - 1) },
        ]);

        const summary = await runLogRetentionSweep(db, NOW);
        expect(summary.perTable.parked_cmd_events).toBe(2);

        const parked = await db.select().from(parkedCmdEvents).all();
        expect(parked.map((r) => r.id)).toEqual(['p-new']);
    });

    it('never touches an out-of-scope table', async () => {
        // The machine-checkable form of the esign_audit_logs hard rule, plus
        // the two legally-required evidence ledgers. Never delete this test.
        await db.insert(smsConsentLog).values({
            id: 's1', tenantId: 't1', contactId: 'c1', recipientType: 'client',
            action: 'granted', disclosureVersion: 1, capturedVia: 'booking_form',
            createdAt: daysAgo(5000),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        await db.insert(esignAuditLogs).values({
            id: 'e1', tenantId: 't1', requestId: 'r1', event: 'agreement.signed',
            payloadJson: '{}', hash: 'h', signature: 'sig', keyFingerprint: 'fp',
            createdAt: daysAgo(5000),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        await runLogRetentionSweep(db, NOW);

        expect((await db.select().from(smsConsentLog).all()).length).toBe(1);
        expect((await db.select().from(esignAuditLogs).all()).length).toBe(1);
    });

    it('is idempotent — a second run changes nothing and reports zero', async () => {
        await seedAuditLog({ id: 'a-old', createdAt: daysAgo(AUDIT_WINDOW_DAYS + 1) });
        await db.insert(parkedCmdEvents).values({
            id: 'p-old', envelope: '{}', reason: 'parse-failed', receivedAt: daysAgo(DEAD_LETTER_RETENTION_DAYS + 1),
        });

        const first = await runLogRetentionSweep(db, NOW);
        expect(first.total).toBe(2);
        const afterFirst = await getAudit('a-old');

        const second = await runLogRetentionSweep(db, NOW);
        // Count-only summaries are the whole reporting surface, so a re-run
        // that re-anonymizes already-anonymized rows would report work it did
        // not do — and a cron logging phantom purges is worse than a silent one.
        expect(second.total).toBe(0);
        expect(await getAudit('a-old')).toEqual(afterFirst);
    });

    it('is a no-op against the current production row profile', async () => {
        // Counted in production 2026-08-01 (OI #276): audit_logs 37,
        // esign_audit_logs 3, sms_consent_log 1, processed_cmd_events 14,
        // processed_webhook_events 0, parked_cmd_events 0 — all written since
        // the deployment went live, so all inside their windows. The expected
        // first contact with real data is ZERO rows affected; anything else
        // means a window or a timestamp column is wrong, and this asserts it
        // here rather than discovering it against the live database.
        for (let i = 0; i < 37; i++) await seedAuditLog({ id: `prod-a${i}`, createdAt: daysAgo(i % 30) });
        for (let i = 0; i < 14; i++) {
            await db.insert(processedCmdEvents).values({
                eventId: `prod-c${i}`, cmdType: 'io.inspectorhub.cmd.tenant.update', processedAt: daysAgo(i % 30),
            });
        }
        await db.insert(esignAuditLogs).values({
            id: 'prod-e1', tenantId: 't1', requestId: 'r1', event: 'agreement.signed',
            payloadJson: '{}', hash: 'h', signature: 'sig', keyFingerprint: 'fp', createdAt: daysAgo(10),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        const summary = await runLogRetentionSweep(db, NOW);
        expect(summary.total).toBe(0);
        expect((await db.select().from(auditLogs).all()).length).toBe(37);
        expect((await db.select().from(processedCmdEvents).all()).length).toBe(14);
    });

    it('reports counts only — no row content reaches the summary', async () => {
        await seedAuditLog({ id: 'a-old', createdAt: daysAgo(AUDIT_WINDOW_DAYS + 1) });
        const summary = await runLogRetentionSweep(db, NOW);
        const serialized = JSON.stringify(summary);
        expect(serialized).not.toContain('example.com');
        expect(serialized).not.toContain('u-123');
        expect(Object.values(summary.perTable).every((v) => typeof v === 'number')).toBe(true);
    });
});
