import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { applyCmdEnvelope } from '../../server/portal/cmd-consumer';
import update from '../fixtures/cmd-events/cmd-tenant-update-v1.json';
import quota from '../fixtures/cmd-events/cmd-tenant-sync-quota-v1.json';
import updateReplyto from '../fixtures/cmd-events/cmd-tenant-update-replyto-v1.json';
import seed from '../fixtures/cmd-events/cmd-tenant-seed-starter-content-v1.json';
import migAck from '../fixtures/cmd-events/cmd-migration-acknowledge-v1.json';
import migDeliver from '../fixtures/cmd-events/cmd-migration-deliver-v1.json';
import migDecline from '../fixtures/cmd-events/cmd-migration-decline-v1.json';
import { ACCOUNT_ACCEPTANCES_TEST_DDL, ACCOUNT_ACCEPTANCES_TEST_INDEX_DDL, AUDIT_LOGS_TEST_DDL, MIGRATION_BATCHES_TEST_DDL, MIGRATION_ROWS_TEST_DDL, TENANTS_TEST_DDL, TENANT_CONFIGS_TEST_DDL, USERS_TEST_DDL } from '../helpers/inline-ddl';
import { isKnownCmd } from '../../server/lib/sync-events/cmd-envelope';

// Batch 2: the seed fixture exercises the consumer pipeline, not the content
// seeder (which touches 8 tables and has its own coverage) — stubbed here.
vi.mock('../../server/services/starter-content.service', () => ({
    seedStarterContent: vi.fn(async () => ({
        inspectionTemplatesSeeded: 7,
        agreementTemplatesSeeded: 1,
        cannedCommentsSeeded: 254,
        eventTypesSeeded: 3,
        tagsSeeded: 4,
        recommendationsSeeded: 80,
        ratingSystemsSeeded: 4,
        marketplaceLibrariesSeeded: 2,
    })),
}));

const b = env as unknown as { DB: D1Database };

describe('cmd golden fixtures — consumer can apply every fixture (A-21)', () => {
    beforeAll(async () => {
        await b.DB.exec(
            TENANTS_TEST_DDL,
        );
        // Batch 2: replies (the replyto fixture) append to the sync outbox.
        await b.DB.exec(
            "CREATE TABLE IF NOT EXISTS sync_outbox (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_tried_at INTEGER, last_error TEXT);",
        );
        // Full users DDL — the replyto fixture carries credentials, and the
        // drizzle insert binds every column of the table even for a partial
        // values() object. Shared with cmd-consumer.spec.ts and guarded by
        // inline-ddl-schema-sync.spec.ts; it used to be a second copy here,
        // which is how three columns went missing without a local gate noticing.
        await b.DB.exec(USERS_TEST_DDL);
        // The acceptance rows ride the SAME batch as the users insert, so this
        // table is not optional scenery: without it the credential apply rolls
        // the account back too.
        // The unique index comes with it — it is what makes a redelivered
        // command unable to mint a second acceptance, and this seam is
        // at-least-once.
        await b.DB.exec(ACCOUNT_ACCEPTANCES_TEST_DDL);
        await b.DB.exec(ACCOUNT_ACCEPTANCES_TEST_INDEX_DDL);
        await b.DB.exec('CREATE TABLE IF NOT EXISTS processed_cmd_events (event_id TEXT PRIMARY KEY, cmd_type TEXT NOT NULL, processed_at INTEGER NOT NULL);');
        await b.DB.exec('CREATE TABLE IF NOT EXISTS parked_cmd_events (id TEXT PRIMARY KEY, envelope TEXT NOT NULL, reason TEXT NOT NULL, received_at INTEGER NOT NULL);');
        // The update fixture carries `name` → PortalProvider initializes
        // tenant_configs.companyName (IA-27). Columns unconstrained on purpose —
        // only (tenant_id, company_name, updated_at) are written by this path.
        // Shared with cmd-consumer; guarded against schema drift by
        // inline-ddl-schema-sync.spec.ts.
        await b.DB.exec(TENANT_CONFIGS_TEST_DDL);
        // batch 4 - the assisted-import tables the cmd.migration.* commands write.
        await b.DB.exec(MIGRATION_BATCHES_TEST_DDL);
        await b.DB.exec(MIGRATION_ROWS_TEST_DDL);
        await b.DB.exec(AUDIT_LOGS_TEST_DDL);
        await b.DB.exec('CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT, archived_at INTEGER);');
        await b.DB.exec(
            'CREATE TABLE IF NOT EXISTS usage_counters (tenant_id TEXT NOT NULL, metric TEXT NOT NULL, period_key TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, metric, period_key));',
        );
    });

    it('applies both fixtures in order', async () => {
        expect(await applyCmdEnvelope(b.DB, undefined, update)).toBe('applied');
        expect(await applyCmdEnvelope(b.DB, undefined, quota)).toBe('applied');
        const t = await b.DB.prepare('SELECT max_users, applied_cmd_seq FROM tenants WHERE id = ?')
            .bind('fixture-tenant-1').first<{ max_users: number; applied_cmd_seq: number }>();
        expect(t?.max_users).toBe(10);
        expect(t?.applied_cmd_seq).toBe(2);
    });

    it('batch 2: replyto fixture applies, advances both streams, and emits the reply matching the reply fixture', async () => {
        const sent: Array<Record<string, unknown>> = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const queue = { send: async (e: unknown) => { sent.push(e as Record<string, unknown>); } } as any;
        expect(await applyCmdEnvelope(b.DB, undefined, updateReplyto, queue)).toBe('applied');

        const t = await b.DB.prepare('SELECT applied_cmd_seq, applied_cred_seq FROM tenants WHERE id = ?')
            .bind('fixture-tenant-2').first<{ applied_cmd_seq: number; applied_cred_seq: number }>();
        expect(t?.applied_cmd_seq).toBe(1);
        expect(t?.applied_cred_seq).toBe(1);
        const u = await b.DB.prepare('SELECT password_hash FROM users WHERE email = ?')
            .bind('fix2@example.com').first<{ password_hash: string }>();
        expect(u?.password_hash).toBe('pbkdf2$fixture');

        // The emitted reply must match the cross-repo golden fixture
        // (tests/fixtures/sync-events/reply-tenant-updated.v1.json) on every
        // field except id/time (runtime-generated).
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({
            specversion: '1.0',
            type: 'io.inspectorhub.reply.tenant.updated',
            source: 'core',
            dataschema: 'reply-tenant-updated/v1',
            data: {
                tenantId: 'fixture-tenant-2',
                correlationId: 'wf:onboarding:fixture-tenant-2:sync-to-core',
                replyto: 'wf:onboarding:fixture-tenant-2',
                result: 'applied',
            },
        });
    });

    it('batch 2: seed fixture applies via the shared implementation', async () => {
        expect(await applyCmdEnvelope(b.DB, undefined, seed)).toBe('applied');
        const { seedStarterContent } = await import('../../server/services/starter-content.service');
        // D1 binding arg not asserted — inspecting it across workerd throws DATA_CLONE_ERR.
        expect(vi.mocked(seedStarterContent).mock.calls.at(-1)?.[1]).toBe('fixture-tenant-2');
        const t = await b.DB.prepare('SELECT applied_cmd_seq FROM tenants WHERE id = ?')
            .bind('fixture-tenant-2').first<{ applied_cmd_seq: number }>();
        expect(t?.applied_cmd_seq).toBe(2);
    });

    /**
     * The three `cmd.migration.*` fixtures, applied IN THE ORDER a person would
     * press them: pick the file up, deliver the conversion, and — on a re-opened
     * run — hand one back.
     *
     * A fixture that is never fed through `applyCmdEnvelope` proves only that
     * somebody wrote a JSON file. The coverage control at the bottom of this
     * file prints how many of the fixtures in this directory that describes.
     */
    it('batch 4: the migration fixtures apply, in the order an operator presses them', async () => {
        const now = Date.now();
        const insertRun = (id: string) => b.DB.prepare(
            'INSERT OR REPLACE INTO migration_batches (id, tenant_id, created_by, intent, vendor, adapter_name, adapter_version, manifest, status, created_at, source_key, expires_at, upload_authorized_by, upload_authorized_at, upload_authorization_version, staff_access_authorized_by, staff_access_authorized_at, staff_access_authorization_version)'
            + " VALUES (?, 'fixture-tenant-5', 'u1', 'contacts.import', 'csv_generic', 'none', '0', '{\"warnings\":[]}', 'needs_assistance', ?, 'k', ?, 'u1', ?, 'v1', 'u1', ?, 'v1')",
        ).bind(id, now, now + 86_400_000, now, now).run();

        await b.DB.prepare("INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES ('fixture-tenant-5', 'fixture-5', ?)").bind(now).run();
        await insertRun('fixture-batch-1');

        expect(await applyCmdEnvelope(b.DB, undefined, migAck)).toBe('applied');
        // Acknowledging does NOT move the run — the deadline to deliver or
        // decline is still running, which is why the next command can land.
        expect((await b.DB.prepare('SELECT status FROM migration_batches WHERE id = ?')
            .bind('fixture-batch-1').first<{ status: string }>())?.status).toBe('needs_assistance');

        expect(await applyCmdEnvelope(b.DB, undefined, migDeliver)).toBe('applied');
        const rows = await b.DB.prepare('SELECT count(*) AS n FROM migration_rows WHERE batch_id = ?')
            .bind('fixture-batch-1').first<{ n: number }>();
        expect(rows?.n).toBe(1);

        // The decline fixture names the same run, which the delivery has now
        // moved on. Re-open a fresh one rather than weakening the fixture: what
        // is being proved is that the consumer can apply it, not that two
        // answers can be given to one run.
        await insertRun('fixture-batch-1');
        expect(await applyCmdEnvelope(b.DB, undefined, migDecline)).toBe('applied');
        expect((await b.DB.prepare('SELECT status FROM migration_batches WHERE id = ?')
            .bind('fixture-batch-1').first<{ status: string }>())?.status).toBe('declined');
    });
});

/**
 * THE CONTROL ON THE SUITE ABOVE, and it exists because that suite's own
 * description overstates what it does.
 *
 * Every assertion above is driven by a hand-written import list, so the suite
 * covers only what somebody remembered to add. Measured when this was written:
 * the directory held twelve fixtures and the suite fed seven of them through the
 * consumer. A green run says nothing about the other five — and the sync seam
 * next door learned exactly this lesson expensively: an event type absent from
 * that suite's list was one it never looked at, and it shipped emitting a name
 * no consumer could key on.
 *
 * This does NOT demand that every fixture be applied. Several name bindings the
 * harness does not build, and forcing them in would be a red build with no
 * defect behind it. It demands the weaker property that is cheap to check and
 * would still have caught that failure: every fixture in the directory names a
 * `type` + `dataschema` the consumer's registry recognises. And it PRINTS BOTH
 * NUMBERS, so the gap between "present" and "exercised" is visible on the day it
 * is green rather than only when it breaks.
 */
describe('every cmd fixture names a command the consumer registry knows', () => {
    /** Fed through `applyCmdEnvelope` by the suite above. Update when that does. */
    const EXERCISED = [
        'cmd-tenant-update-v1.json',
        'cmd-tenant-sync-quota-v1.json',
        'cmd-tenant-update-replyto-v1.json',
        'cmd-tenant-seed-starter-content-v1.json',
        'cmd-migration-acknowledge-v1.json',
        'cmd-migration-deliver-v1.json',
        'cmd-migration-decline-v1.json',
    ];

    // A module glob rather than a second hand-written list: the build tool
    // enumerates the directory, which is the whole point. `readdir` is not
    // available inside workerd.
    const modules = import.meta.glob('../fixtures/cmd-events/*.json', { eager: true }) as
        Record<string, { default: { type?: string; dataschema?: string } }>;
    const present = Object.entries(modules).map(([path, mod]) => ({
        file: path.slice(path.lastIndexOf('/') + 1),
        envelope: mod.default,
    }));

    it('the directory is non-empty — an empty glob would make the next tests vacuously green', () => {
        expect(present.length).toBeGreaterThan(0);
    });

    it('reports coverage: how many fixtures exist against how many this suite applies', () => {
        const missing = EXERCISED.filter((f) => !present.some((p) => p.file === f));
        expect(missing, `EXERCISED names fixtures that do not exist: ${missing.join(', ')}`).toEqual([]);
        const applied = present.filter((p) => EXERCISED.includes(p.file)).length;
        expect(applied, `cmd fixtures present ${present.length}, applied by this suite ${applied}`)
            .toBeGreaterThan(0);
    });

    it('no fixture names a command type or version this consumer cannot recognise', () => {
        const unknown = present
            .filter((p) => !isKnownCmd(p.envelope.type ?? '', p.envelope.dataschema ?? ''))
            .map((p) => `${p.file} (${p.envelope.type} / ${p.envelope.dataschema})`);
        expect(unknown, `fixtures naming an unregistered command: ${unknown.join(', ') || '(none)'}`)
            .toEqual([]);
    });
});

