// Privacy P3 — the two DSAR commands through the real consumer pipeline.
//
// The ASSEMBLERS are stubbed here on purpose: the subject export has real
// coverage in tests/unit/privacy/subject-export.spec.ts (against better-sqlite3
// and a fake R2), and the erasure orchestrator has had its own suite since
// Track I-a. What only workerd can answer is the seam — dispatch, the stale
// guard, dedup, and whether the reply that reaches the queue carries the
// coverage disclosure portal refuses to complete a request without.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { applyCmdEnvelope } from '../../server/portal/cmd-consumer';
import exportCmd from '../fixtures/cmd-events/cmd-subject-export-v1.json';
import eraseCmd from '../fixtures/cmd-events/cmd-subject-erase-v1.json';

vi.mock('../../server/services/subject-export.service', () => ({
    SubjectExportService: class {
        async buildZipToR2(_loc: unknown, _bucket: unknown, _key: string) {
            return { rows: 7, photos: 2, photosEmbedded: 2 };
        }
    },
}));

// The orchestrator is the piece whose real behaviour matters least HERE and
// most everywhere else; stubbing it keeps this spec about the seam. The two
// shapes it can return — completed and partially_completed — are both driven,
// because the difference between them decides whether portal is told anything
// at all.
/** Rebuilt per test — see the reset in `clearTables`. A shared array here is
 *  what let one case's failed step leak into every case after it. */
const cleanDecisions = (): Array<Record<string, unknown>> => [
    { table: 'contacts', action: 'delete', count: 1 },
    { table: 'agreement_signers', action: 'anonymize', count: 1, legalBasis: 'art_17_3_e' },
];

const erasureSummary = {
    status: 'completed' as 'completed' | 'partially_completed',
    anonymizedCount: 1,
    deletedCount: 2,
    retainedCount: 1,
    // Zero, and stated rather than omitted: this stub stands in for a run that
    // was NOT covered by a legal hold, which is the only kind that reaches the
    // reply path at all.
    preservedCount: 0,
    decisions: cleanDecisions(),
    logId: 'log-1',
};
vi.mock('../../server/lib/compliance/erasure-orchestrator', () => ({
    runErasure: async () => erasureSummary,
}));

const b = env as unknown as { DB: D1Database; PHOTOS: R2Bucket; EXPORTS_BUCKET: R2Bucket };
const kvStub = { delete: async () => {} } as unknown as KVNamespace;

async function seedSchema(): Promise<void> {
    await b.DB.exec(
        "CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, tier TEXT NOT NULL DEFAULT 'free', stripe_connect_account_id TEXT, status TEXT NOT NULL DEFAULT 'pending', max_users INTEGER NOT NULL DEFAULT 5, deployment_mode TEXT NOT NULL DEFAULT 'shared', applied_cmd_seq INTEGER NOT NULL DEFAULT 0, applied_cred_seq INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);",
    );
    await b.DB.exec('CREATE TABLE IF NOT EXISTS processed_cmd_events (event_id TEXT PRIMARY KEY, cmd_type TEXT NOT NULL, processed_at INTEGER NOT NULL);');
    await b.DB.exec('CREATE TABLE IF NOT EXISTS parked_cmd_events (id TEXT PRIMARY KEY, envelope TEXT NOT NULL, reason TEXT NOT NULL, received_at INTEGER NOT NULL);');
    await b.DB.exec(
        "CREATE TABLE IF NOT EXISTS sync_outbox (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_tried_at INTEGER, last_error TEXT);",
    );
    // `applySubjectErase` reads the per-tenant retention window before running.
    await b.DB.exec('CREATE TABLE IF NOT EXISTS tenant_configs (tenant_id TEXT PRIMARY KEY, agreement_retention_years INTEGER);');
}

async function clearTables(): Promise<void> {
    for (const t of ['processed_cmd_events', 'parked_cmd_events', 'sync_outbox', 'tenants', 'tenant_configs']) {
        await b.DB.exec(`DELETE FROM ${t};`);
    }
    await b.DB.prepare("INSERT INTO tenants (id, slug, created_at) VALUES ('fixture-tenant-4', 'ws-f4', 1)").run();
    // BOTH fields, not just the status. The partial-run case replaces
    // `decisions` wholesale, and the refusal is read off the DECISIONS rather
    // than the status string — so resetting only the status left every later
    // case running against a failed step it never set up. Each passed alone and
    // two failed together, which is the shape this reset exists to remove.
    erasureSummary.status = 'completed';
    erasureSummary.decisions = cleanDecisions();
}

function fakeQueue() {
    const sent: Array<Record<string, unknown>> = [];
    return {
        sent,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        queue: { send: async (e: unknown) => { sent.push(e as Record<string, unknown>); } } as any,
    };
}

const buckets = () => ({ photos: b.PHOTOS, exports: b.EXPORTS_BUCKET });

describe('cmd consumer — DSAR subject commands (Privacy P3)', () => {
    beforeAll(seedSchema);
    beforeEach(clearTables);

    it('subject.export applies and replies with the key core WROTE plus a manifest', async () => {
        const q = fakeQueue();
        expect(await applyCmdEnvelope(b.DB, kvStub, exportCmd, q.queue, buckets())).toBe('applied');
        expect(q.sent).toHaveLength(1);
        expect(q.sent[0]).toMatchObject({
            type: 'io.inspectorhub.reply.subject.exported',
            source: 'core',
            dataschema: 'reply-subject-exported/v1',
            data: {
                tenantId: 'fixture-tenant-4',
                correlationId: exportCmd.id,
                replyto: exportCmd.replyto,
                r2Key: exportCmd.data.r2Key,
                manifest: { rows: 7, photos: 2, photosEmbedded: 2 },
            },
        });
    });

    it('subject.erase replies WITH the coverage disclosure — portal completes on nothing less', async () => {
        const q = fakeQueue();
        expect(await applyCmdEnvelope(b.DB, kvStub, eraseCmd, q.queue, buckets())).toBe('applied');
        const data = (q.sent[0] as { data: Record<string, unknown> }).data;
        expect(q.sent[0]).toMatchObject({
            type: 'io.inspectorhub.reply.subject.erased',
            dataschema: 'reply-subject-erased/v1',
        });
        expect(data['replyto']).toBe(eraseCmd.replyto);
        expect(data['anonymizedCount']).toBe(1);
        expect(data['deletedCount']).toBe(2);
        const coverage = data['coverage'] as Record<string, unknown>;
        expect(coverage, 'reply carried no coverage — portal would refuse this and the DSAR would stick').toBeDefined();
        expect(coverage['catalogueIsAdvisory']).toBe(true);
        expect(coverage['subjectAxis']).toBe('email');
        expect((coverage['pendingRules'] as string[]).length).toBe(coverage['pendingEnforcementCount']);
        expect(coverage['executedTables']).toEqual(['agreement_signers', 'contacts']);
        // Catalogue sizes are reported, never asserted against a literal — they
        // move whenever a PII column is catalogued.
        expect(coverage['manifestRuleCount']).toBeGreaterThan(0);
    });

    it('a PARTIAL erasure emits NO reply and throws — a stuck DSAR beats a false completion', async () => {
        erasureSummary.status = 'partially_completed';
        erasureSummary.decisions = [
            { table: 'contacts', action: 'delete', count: 1 },
            { table: 'notification_preferences', action: 'delete', count: 0, error: 'no such table' },
        ];
        const q = fakeQueue();
        await expect(applyCmdEnvelope(b.DB, kvStub, eraseCmd, q.queue, buckets()))
            .rejects.toThrow(/partially_completed/);
        expect(q.sent).toHaveLength(0);
        const n = await b.DB.prepare('SELECT count(*) AS n FROM sync_outbox').first<{ n: number }>();
        expect(n?.n).toBe(0);
        // Dedup marker rolled back, so the queue retry genuinely re-runs.
        const marker = await b.DB.prepare('SELECT count(*) AS n FROM processed_cmd_events').first<{ n: number }>();
        expect(marker?.n).toBe(0);
    });

    it('subject.export without the R2 bindings throws rather than replying to an archive that does not exist', async () => {
        await expect(applyCmdEnvelope(b.DB, kvStub, exportCmd, undefined, undefined))
            .rejects.toThrow(/EXPORTS_BUCKET not bound|PHOTOS/);
    });

    it('a phone on subject.erase fails at the boundary instead of being silently dropped', async () => {
        const poisoned = { ...eraseCmd, id: 'erase-with-phone', data: { ...eraseCmd.data, subjectPhone: '+15555550123' } };
        // Strict parse throws inside applyKnownCmd -> retried -> DLQ -> a FAILED
        // cmd row on the portal console. The alternative is core recording a
        // completed erasure over an axis it never queried.
        await expect(applyCmdEnvelope(b.DB, kvStub, poisoned, fakeQueue().queue, buckets())).rejects.toThrow();
    });

    it('a duplicate does NOT re-emit — the reply\'s durability is the sync outbox, not a re-run', async () => {
        // Deliberately different from `reply.tenant.updated`, which re-emits on
        // duplicate. Re-running an erasure to reconstruct its reply would
        // produce a SECOND, near-empty decision set and overwrite the real one
        // on the portal record. The reply is instead made durable by being
        // appended to `sync_outbox` before publishing, with the cron sweeper
        // republishing stragglers.
        const q = fakeQueue();
        expect(await applyCmdEnvelope(b.DB, kvStub, eraseCmd, q.queue, buckets())).toBe('applied');
        expect(await applyCmdEnvelope(b.DB, kvStub, eraseCmd, q.queue, buckets())).toBe('duplicate');
        expect(q.sent).toHaveLength(1);
        const n = await b.DB.prepare('SELECT count(*) AS n FROM sync_outbox').first<{ n: number }>();
        expect(n?.n).toBe(1);
    });

    it('an OVERTAKEN subject command still runs — the tenant-state stale guard must not drop a DSAR', async () => {
        // The hazard: portal draws `tenantseq` from ONE per-tenant counter, so a
        // quota sync published a moment later can be applied first and leave the
        // erasure looking stale. Guarded, it would be dropped with no reply and
        // the request would sit at `fulfilling` until the statutory month ran
        // out — for a reason (a seat-count change) that supersedes nothing.
        await b.DB.prepare('UPDATE tenants SET applied_cmd_seq = 99 WHERE id = ?').bind('fixture-tenant-4').run();
        const q = fakeQueue();
        expect(await applyCmdEnvelope(b.DB, kvStub, eraseCmd, q.queue, buckets())).toBe('applied');
        expect(q.sent).toHaveLength(1);
        // …and it does NOT drag the high-water mark backwards, so a genuinely
        // stale tenant update cannot slip through behind it.
        const t = await b.DB.prepare('SELECT applied_cmd_seq FROM tenants WHERE id = ?')
            .bind('fixture-tenant-4').first<{ applied_cmd_seq: number }>();
        expect(t?.applied_cmd_seq).toBe(99);
    });
});
