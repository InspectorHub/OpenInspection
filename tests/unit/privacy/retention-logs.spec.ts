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
    idempotencyKeys,
    parkedCmdEvents,
    processedCmdEvents,
    processedWebhookEvents,
    smsConsentLog,
    syncOutbox,
    tenants,
} from '../../../server/lib/db/schema';
import { runLogRetentionSweep, RETENTION_EXECUTOR_TABLES } from '../../../server/lib/compliance/retention-logs';
import {
    AUDIT_LOG_ANONYMIZE_MONTHS,
    DEAD_LETTER_RETENTION_DAYS,
    DEDUP_LOG_RETENTION_DAYS,
    IDEMPOTENCY_REPLAY_RETENTION_DAYS,
    SYNC_OUTBOX_RETENTION_DAYS,
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
        // behind is exactly what portal review called an incomplete DSAR, and
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

    // ── sync_outbox ──────────────────────────────────────────────────────────
    // The outbox `payload` is a serialized user-sync CloudEvent: staff email and
    // name, and for `user.password_changed` the password HASH. The structural
    // twin of what `parked_cmd_events` held before OI #276, one table over.

    /** Seed one outbox row. `status` is the whole point of these cases. */
    async function seedOutbox(id: string, status: 'pending' | 'published' | 'failed', createdAt: Date) {
        await db.insert(syncOutbox).values({
            id,
            eventType: 'user.password_changed',
            payload: JSON.stringify({ tenantId: 't1', email: 'staff@example.com', passwordHash: 'pbkdf2$deadbeef' }),
            status,
            attempts: 1,
            createdAt,
        });
    }

    it('deletes TERMINAL outbox rows past the window and keeps the ones inside it', async () => {
        await seedOutbox('o-pub-old', 'published', daysAgo(SYNC_OUTBOX_RETENTION_DAYS + 1));
        await seedOutbox('o-fail-old', 'failed', daysAgo(SYNC_OUTBOX_RETENTION_DAYS + 1));
        await seedOutbox('o-pub-new', 'published', daysAgo(SYNC_OUTBOX_RETENTION_DAYS - 1));

        const summary = await runLogRetentionSweep(db, NOW);
        expect(summary.perTable.sync_outbox).toBe(2);

        const rows = await db.select().from(syncOutbox).all();
        expect(rows.map((r) => r.id)).toEqual(['o-pub-new']);
    });

    it('never deletes a PENDING outbox row, however old', async () => {
        // The one assertion that separates a log clock from a data-loss bug. A
        // `pending` row is UNPUBLISHED WORK: the cron sweeper is still trying to
        // republish it, and portal has never seen the event. Expiring it does not
        // retire a record of something that happened — it destroys a user-account
        // change that never reached the other side, permanently and silently.
        // A pending row this old is an incident, and the row is its evidence.
        await seedOutbox('o-pending-ancient', 'pending', daysAgo(SYNC_OUTBOX_RETENTION_DAYS * 10));

        await runLogRetentionSweep(db, NOW);

        const rows = await db.select().from(syncOutbox).all();
        expect(rows.map((r) => r.id)).toEqual(['o-pending-ancient']);
        expect(rows[0]!.payload).toContain('staff@example.com');
    });

    it('the outbox window is its own number, not a neighbour reused', async () => {
        // A row older than the dead-letter clock but younger than the outbox one
        // must SURVIVE, and a row older than the outbox clock but younger than
        // the dedup one must GO. Together they pin the value between its two
        // neighbours, so silently collapsing it onto either constant goes red.
        expect(SYNC_OUTBOX_RETENTION_DAYS).toBeGreaterThan(DEAD_LETTER_RETENTION_DAYS);
        expect(SYNC_OUTBOX_RETENTION_DAYS).toBeLessThan(DEDUP_LOG_RETENTION_DAYS);
        await seedOutbox('o-above-deadletter', 'published', daysAgo(DEAD_LETTER_RETENTION_DAYS + 1));
        await seedOutbox('o-below-dedup', 'published', daysAgo(DEDUP_LOG_RETENTION_DAYS - 1));

        await runLogRetentionSweep(db, NOW);

        const rows = await db.select().from(syncOutbox).all();
        expect(rows.map((r) => r.id)).toEqual(['o-above-deadletter']);
    });

    // ── idempotency_keys ─────────────────────────────────────────────────────
    // `response_body` is the verbatim success payload of a mutating API call,
    // replayed on retry — so it holds whatever PII that endpoint returns.

    /** Seed one replay row. `expiresAt` is deliberately independent of `createdAt`. */
    async function seedIdemKey(key: string, createdAt: Date, expiresAt: Date, state: 'in_flight' | 'done' = 'done') {
        await db.insert(idempotencyKeys).values({
            tenantId: 't1',
            key,
            fingerprint: 'fp',
            state,
            responseStatus: state === 'done' ? 200 : null,
            responseBody: state === 'done' ? '{"client":{"email":"jane@example.com","name":"Jane Doe"}}' : null,
            createdAt,
            expiresAt,
        });
    }

    it('deletes replay rows past the window and keeps the ones inside it', async () => {
        const ttl = (d: Date) => new Date(d.getTime() + 24 * 60 * 60 * 1000);
        const old = daysAgo(IDEMPOTENCY_REPLAY_RETENTION_DAYS + 1);
        const fresh = daysAgo(IDEMPOTENCY_REPLAY_RETENTION_DAYS - 1);
        await seedIdemKey('k-old', old, ttl(old));
        await seedIdemKey('k-new', fresh, ttl(fresh));
        // A dead claim nobody ever unwound: `releaseKey` runs only from a caught
        // exception, so a CPU kill or a mid-request deploy leaves this forever.
        await seedIdemKey('k-stuck', old, ttl(old), 'in_flight');

        const summary = await runLogRetentionSweep(db, NOW);
        expect(summary.perTable.idempotency_keys).toBe(2);

        const rows = await db.select().from(idempotencyKeys).all();
        expect(rows.map((r) => r.key)).toEqual(['k-new']);
    });

    it('measures the replay window from created_at, NOT from expires_at', async () => {
        // The distinction the whole rule rests on. `expires_at` answers a
        // CONCURRENCY question — may another caller steal this claim — and
        // `claimKey` never even reads it once the row is `done` (the `done`
        // branch returns above the expiry check). So a row can sit years past
        // its own `expires_at` still holding the response body, which is exactly
        // how this exposure was missed. A rule keyed on `expires_at` would look
        // identical and would delete the wrong rows.
        //
        // Row A: created long ago, expiry pushed far into the future.
        // Row B: created today, expiry already in the past.
        // Storage limitation deletes A and keeps B. An `expires_at` rule flips it.
        await seedIdemKey('k-old-created', daysAgo(IDEMPOTENCY_REPLAY_RETENTION_DAYS + 1), daysAgo(-3650));
        await seedIdemKey('k-expired-yesterday', daysAgo(0), daysAgo(1));

        await runLogRetentionSweep(db, NOW);

        const rows = await db.select().from(idempotencyKeys).all();
        expect(rows.map((r) => r.key)).toEqual(['k-expired-yesterday']);
    });

    it('the replay window is a multiple of the feature\'s own declared TTL', async () => {
        // The number is derived, not picked: the store documents a 24h TTL and
        // says a retry older than that "is a different problem". Seven days is a
        // week of margin over the horizon the feature itself declares. Asserted
        // so shortening it below one full TTL — which would start losing
        // legitimate replays and duplicating mutations — cannot pass quietly.
        expect(IDEMPOTENCY_REPLAY_RETENTION_DAYS).toBeGreaterThanOrEqual(1);
        expect(IDEMPOTENCY_REPLAY_RETENTION_DAYS).toBe(7);
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
