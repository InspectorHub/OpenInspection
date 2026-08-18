/**
 * A legal hold outranks every scheduled deletion — proved per table, not asserted.
 *
 * Counsel round 33 made this a global invariant rather than a per-table note, and
 * the way an invariant like this actually fails is not that somebody disagrees
 * with it: it is that one executor out of twelve forgets the filter, compiles,
 * passes every type check, and deletes under a preservation order. Nothing in
 * the type system can catch that, and a grep-style gate would pass on an
 * executor that called `notHeld` against the wrong column.
 *
 * So the guard is behavioural and DERIVED FROM THE MANIFEST. For every rule
 * declaring `legalHold: 'tenant_scoped'`, this file seeds one long-overdue row
 * for a held tenant and an identical one for an unheld tenant, runs the real
 * sweep, and asserts that exactly one of them went. A new tenant-scoped rule
 * with no seeder here fails the coverage test below rather than being quietly
 * skipped — because a table-driven suite that silently covers eleven of twelve
 * tables is the same green as one that covers all of them.
 *
 * ── The positive control is the point ───────────────────────────────────────
 * Every case asserts BOTH halves: the held row survives AND the unheld row is
 * gone. Only the first half is about legal hold, but a filter that accidentally
 * matched everything — `notInArray` against the wrong column, a stray `and()`
 * that swallowed the age predicate — would satisfy it perfectly while breaking
 * retention entirely. The unheld row is what makes the surviving row mean
 * "preserved" rather than "the sweep did nothing".
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import { asAnyDb } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { legalHolds, tenants } from '../../../server/lib/db/schema';
import { runLogRetentionSweep } from '../../../server/lib/compliance/retention-logs';
import { RETENTION_MANIFEST } from '../../../server/lib/compliance/retention-manifest';

const NOW = Date.UTC(2026, 5, 8); // 2026-06-08
/** Older than the longest window in the catalogue (report_pdfs, 84 months). */
const LONG_AGO = NOW - 4000 * 24 * 60 * 60 * 1000;

const HELD = 'tenant-held';
const FREE = 'tenant-free';

/** An R2 stub that actually holds objects — report_pdfs refuses without one. */
function makeR2() {
    const store = new Set<string>(['pdf-held', 'pdf-free']);
    return {
        delete: async (keys: string | string[]) => {
            for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
        },
    } as unknown as R2Bucket;
}

/**
 * One long-overdue row per tenant-scoped table.
 *
 * `survivesWhere` is the SQL that counts rows still holding what the rule was
 * about to take. It is `1=1` for a `delete` rule — the row itself is the
 * answer — and a column predicate for the one `erase_in_place` rule, where the
 * row survives either way and only its actor columns tell you whether the sweep
 * reached it. Taking it from `rule.action` rather than restating it means a rule
 * that changes verb cannot leave a test asserting the old one.
 */
interface Seeder {
    seed: (sqlite: ReturnType<typeof createTestDb>['sqlite'], tenantId: string, id: string) => void;
    survivesWhere?: string;
}

const SEEDERS: Record<string, Seeder> = {
    audit_logs: {
        // The one erase_in_place rule: the row is kept and the actor is cleared,
        // so "survives" has to mean "still identifies somebody".
        survivesWhere: 'user_id is not null',
        seed: (s, t, id) => s.prepare(
            `insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, ip_address, created_at)
             values (?, ?, 'u-1', 'inspection.update', 'inspection', 'i1', '203.0.113.7', ?)`,
        ).run(id, t, LONG_AGO),
    },
    idempotency_keys: {
        seed: (s, t, id) => s.prepare(
            `insert into idempotency_keys (tenant_id, key, fingerprint, state, created_at, expires_at)
             values (?, ?, 'fp', 'done', ?, ?)`,
        ).run(t, id, LONG_AGO, LONG_AGO),
    },
    tenant_destruction_records: {
        seed: (s, t, id) => s.prepare(
            `insert into tenant_destruction_records
             (id, tenant_id, rows_deleted, r2_objects, r2_bytes, kv_keys, destroyed_at, status, record_version)
             values (?, ?, 0, 0, 0, 0, ?, 'completed', 1)`,
        ).run(id, t, LONG_AGO),
    },
    ai_call_provenance: {
        seed: (s, t, id) => s.prepare(
            `insert into ai_call_provenance
             (id, tenant_id, capability, provider, mode, model, prompt_version, created_at)
             values (?, ?, 'ai_assist', 'gemini', 'managed', 'm', 'v1', ?)`,
        ).run(id, t, LONG_AGO),
    },
    ai_content_reviews: {
        seed: (s, t, id) => s.prepare(
            `insert into ai_content_reviews
             (id, tenant_id, artifact_type, artifact_id, reviewed_by, reviewed_at, ai_call_id)
             values (?, ?, 'finding', 'f1', 'u-1', ?, ?)`,
        ).run(id, t, LONG_AGO, `call-${id}`),
    },
    report_versions: {
        // A SUPERSEDED version — the executor keeps the highest version_number
        // for a report, so a lone row would survive for a reason that has
        // nothing to do with holds and the case would prove nothing.
        seed: (s, t, id) => {
            const ins = s.prepare(
                `insert into report_versions
                 (id, tenant_id, inspection_id, version_number, snapshot_json, is_amendment,
                  published_at, published_by, created_at, report_id)
                 values (?, ?, 'i1', ?, '{}', 0, ?, 'u-1', ?, ?)`,
            );
            ins.run(id, t, 1, LONG_AGO, LONG_AGO, `rep-${t}`);
            ins.run(`${id}-newer`, t, 2, NOW, NOW, `rep-${t}`);
        },
        survivesWhere: 'version_number = 1',
    },
    tenant_legal_versions: {
        // Superseded, and cited by no acceptance — otherwise the reference-
        // preserving clause keeps it and the hold is not what was tested.
        seed: (s, t, id) => {
            const ins = s.prepare(
                `insert into tenant_legal_versions
                 (id, tenant_id, doc, version, content_hash, is_material, published_at)
                 values (?, ?, 'privacy', ?, 'h', 0, ?)`,
            );
            ins.run(id, t, '2020-01-01', LONG_AGO);
            ins.run(`${id}-newer`, t, '2026-01-01', NOW);
        },
        survivesWhere: "version = '2020-01-01'",
    },
    notifications: {
        seed: (s, t, id) => s.prepare(
            `insert into notifications (id, tenant_id, type, title, created_at)
             values (?, ?, 'inspection.published', 'Report ready', ?)`,
        ).run(id, t, LONG_AGO),
    },
    qbo_sync_errors: {
        seed: (s, t, id) => s.prepare(
            `insert into qbo_sync_errors
             (id, tenant_id, oi_type, oi_id, error_code, error_msg, retries, is_resolved,
              created_at, updated_at, resolved_at)
             values (?, ?, 'invoice', 'inv-1', '6240', 'Duplicate Name Exists', 0, 1, ?, ?, ?)`,
        ).run(id, t, LONG_AGO, LONG_AGO, LONG_AGO),
    },
    tenant_marketplace_import_history: {
        seed: (s, t, id) => s.prepare(
            `insert into tenant_marketplace_import_history
             (id, tenant_id, action, rows_affected, created_at, created_by)
             values (?, ?, 'import', 1, ?, 'u-1')`,
        ).run(id, t, LONG_AGO),
    },
    report_pdfs: {
        seed: (s, t, id) => s.prepare(
            `insert into report_pdfs
             (id, tenant_id, inspection_id, type, r2_key, rendered_at, source_version, status)
             values (?, ?, 'i1', 'report', ?, ?, 1, 'ready')`,
        ).run(id, t, t === HELD ? 'pdf-held' : 'pdf-free', LONG_AGO),
    },
    tenant_slug_history: {
        seed: (s, t, id) => s.prepare(
            `insert into tenant_slug_history (old_slug, tenant_id, changed_at, retired_until)
             values (?, ?, ?, ?)`,
        ).run(id, t, LONG_AGO, LONG_AGO),
    },
};

const TENANT_SCOPED = RETENTION_MANIFEST.filter((r) => r.legalHold === 'tenant_scoped');

describe('legal hold coverage', () => {
    it('every tenant_scoped rule in the manifest is exercised below', () => {
        // The test that stops this file going quietly out of date. A rule added
        // to the manifest without a seeder here would otherwise contribute
        // nothing and change no count — the classic silently-shrinking suite.
        const uncovered = TENANT_SCOPED.map((r) => r.table).filter((t) => !SEEDERS[t]);
        expect(uncovered, `tenant_scoped rules with no seeder: ${uncovered.join(', ')}`).toHaveLength(0);
    });

    it('there is something to cover — the filter is not matching nothing', () => {
        // An empty TENANT_SCOPED would make every case below vacuously pass.
        expect(TENANT_SCOPED.length).toBeGreaterThan(0);
    });

    it('no seeder exists for a rule that is not tenant_scoped', () => {
        // The reverse drift: a rule reclassified to suspend_all leaves a seeder
        // behind that now proves a filter nobody applies any more.
        const tables = new Set(TENANT_SCOPED.map((r) => r.table));
        const orphaned = Object.keys(SEEDERS).filter((t) => !tables.has(t));
        expect(orphaned, `seeders with no tenant_scoped rule: ${orphaned.join(', ')}`).toHaveLength(0);
    });
});

describe('the sweep preserves a held tenant and expires everyone else', () => {
    let db: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        await db.insert(tenants).values([
            { id: HELD, slug: HELD, createdAt: new Date(NOW) },
            { id: FREE, slug: FREE, createdAt: new Date(NOW) },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any);
    });

    afterEach(() => sqlite.close());

    const placeHold = async () => db.insert(legalHolds).values({
        id: 'hold-1',
        tenantId: HELD,
        matter: 'CV-2026-00417',
        reason: 'Preservation demand served on the company; scope covers this workspace.',
        placedBy: 'u-legal',
        placedAt: new Date(NOW),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const countIn = (table: string, tenantId: string, where: string) => (sqlite
        .prepare(`select count(*) as n from ${table} where tenant_id = ? and (${where})`)
        .get(tenantId) as { n: number }).n;

    for (const rule of TENANT_SCOPED) {
        const seeder = SEEDERS[rule.table];
        if (!seeder) continue; // the coverage test above is what reports this
        const where = seeder.survivesWhere ?? '1=1';

        it(`${rule.table}: the held tenant's row survives and the unheld one does not`, async () => {
            seeder.seed(sqlite, HELD, `row-held-${rule.table}`);
            seeder.seed(sqlite, FREE, `row-free-${rule.table}`);
            await placeHold();

            await runLogRetentionSweep(asAnyDb(db), NOW, { photos: makeR2() });

            expect(countIn(rule.table, HELD, where), `${rule.table}: held row was deleted`).toBe(1);
            // The positive control. Without it a filter that matched everything
            // would pass the assertion above and take retention down with it.
            expect(countIn(rule.table, FREE, where), `${rule.table}: unheld row was NOT deleted`).toBe(0);
        });

        it(`${rule.table}: with the hold released, the same row expires`, async () => {
            seeder.seed(sqlite, HELD, `row-held-${rule.table}`);
            await placeHold();
            await db.update(legalHolds).set({
                releasedAt: new Date(NOW),
                releasedBy: 'u-legal',
                releaseReason: 'Matter closed.',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);

            await runLogRetentionSweep(asAnyDb(db), NOW, { photos: makeR2() });

            // A hold that cannot be released is a hold that quietly became a
            // retention exemption, which is the failure mode on the other side.
            expect(countIn(rule.table, HELD, where)).toBe(0);
        });
    }
});

describe('what the sweep reports about holds', () => {
    let db: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        await db.insert(tenants).values(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            [{ id: HELD, slug: HELD, createdAt: new Date(NOW) }] as any,
        );
    });

    afterEach(() => sqlite.close());

    it('an ordinary tick reports no holds and suspends nothing', async () => {
        const out = await runLogRetentionSweep(asAnyDb(db), NOW, { photos: makeR2() });
        expect(out.activeHolds).toBe(0);
        expect(out.suspendedTables).toEqual([]);
    });

    it('suspends the tenant-less tables while a hold is in force, and says which', async () => {
        await db.insert(legalHolds).values({
            id: 'hold-1',
            tenantId: HELD,
            matter: 'CV-2026-00417',
            reason: 'Preservation demand.',
            placedBy: 'u-legal',
            placedAt: new Date(NOW),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        // A row that WOULD have been swept: terminal, and far past the window.
        sqlite.prepare(
            `insert into sync_outbox (id, event_type, payload, status, attempts, created_at)
             values ('o1', 'user.password_changed', '{}', 'published', 1, ?)`,
        ).run(LONG_AGO);

        const out = await runLogRetentionSweep(asAnyDb(db), NOW, { photos: makeR2() });

        expect(out.activeHolds).toBe(1);
        // Exactly the rules the manifest declares as suspend_all — read from the
        // manifest rather than listed here, so reclassifying one moves both.
        const expected = RETENTION_MANIFEST.filter((r) => r.legalHold === 'suspend_all').map((r) => r.table);
        expect(out.suspendedTables.sort()).toEqual(expected.sort());
        expect(expected.length).toBeGreaterThan(0);

        const left = (sqlite.prepare('select count(*) as n from sync_outbox').get() as { n: number }).n;
        expect(left, 'a suspended table must not have been swept').toBe(1);
    });

    it('a released hold stops suspending anything', async () => {
        await db.insert(legalHolds).values({
            id: 'hold-1',
            tenantId: HELD,
            matter: 'CV-2026-00417',
            reason: 'Preservation demand.',
            placedBy: 'u-legal',
            placedAt: new Date(NOW),
            releasedAt: new Date(NOW),
            releasedBy: 'u-legal',
            releaseReason: 'Matter closed.',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        sqlite.prepare(
            `insert into sync_outbox (id, event_type, payload, status, attempts, created_at)
             values ('o1', 'user.password_changed', '{}', 'published', 1, ?)`,
        ).run(LONG_AGO);

        const out = await runLogRetentionSweep(asAnyDb(db), NOW, { photos: makeR2() });

        expect(out.activeHolds).toBe(0);
        expect(out.suspendedTables).toEqual([]);
        const left = (sqlite.prepare('select count(*) as n from sync_outbox').get() as { n: number }).n;
        expect(left, 'nothing is held, so the ordinary window applies').toBe(0);
    });
});
