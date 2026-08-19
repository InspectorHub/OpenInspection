// B-28/B-29 — real-D1 (workerd/miniflare) coverage for the db.batch() paths.
//
// The node-env unit suite runs on a better-sqlite3 mock WITHOUT a `batch`
// method, so it only ever exercises the sequential fallback. Everything
// batch-SPECIFIC — one-round-trip execution and, crucially, whole-batch
// atomicity (D1 runs a batch as an implicit transaction) — is only testable
// here against the real binding.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { syncInspectionAssignmentsBatch } from '../../server/lib/db/assignment-links';
import { BookingService } from '../../server/services/booking.service';
import { MigrationStageService } from '../../server/services/migration-intake/stage.service';
import { UnitService } from '../../server/services/unit.service';
import { expandFloorsStacks } from '../../server/lib/unit-pattern';

interface TestBindings { DB: D1Database }
const b = env as unknown as TestBindings;

const TENANT = 'tenant-batch';
/** users.id of the operator a staged run is recorded against. */
const USER = 'user-batch';

async function seedSchema(): Promise<void> {
    // Minimal-but-faithful DDL (per server/lib/db/schema/inspection.ts):
    // the composite PK on inspection_inspectors is what the atomicity probe
    // trips, so it must match production.
    await b.DB.exec(
        'CREATE TABLE IF NOT EXISTS inspection_inspectors (inspection_id TEXT NOT NULL, user_id TEXT NOT NULL, tenant_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT \'lead\', created_at INTEGER NOT NULL, PRIMARY KEY (inspection_id, user_id));',
    );
    await b.DB.exec(
        'CREATE TABLE IF NOT EXISTS inspections (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, inspector_id TEXT, property_address TEXT, date TEXT, status TEXT, report_status TEXT NOT NULL DEFAULT \'in_progress\', request_id TEXT, created_at INTEGER NOT NULL);',
    );
}

async function clearTables(): Promise<void> {
    await b.DB.exec('DELETE FROM inspection_inspectors;');
    await b.DB.exec('DELETE FROM inspections;');
}

async function seedLink(inspectionId: string, userId: string, role = 'lead'): Promise<void> {
    await b.DB.prepare(
        'INSERT INTO inspection_inspectors (inspection_id, user_id, tenant_id, role, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(inspectionId, userId, TENANT, role, Date.now()).run();
}

async function linkRows(): Promise<Array<{ inspection_id: string; user_id: string; role: string }>> {
    const res = await b.DB.prepare(
        'SELECT inspection_id, user_id, role FROM inspection_inspectors ORDER BY inspection_id, user_id',
    ).all<{ inspection_id: string; user_id: string; role: string }>();
    return res.results;
}

describe('B-29 syncInspectionAssignmentsBatch — real D1 batch', () => {
    beforeAll(seedSchema);
    beforeEach(clearTables);

    it('resyncs N inspections through the real db.batch path', async () => {
        await seedLink('i1', 'old-1');
        const db = drizzle(b.DB);

        await syncInspectionAssignmentsBatch(db, TENANT, [
            { inspectionId: 'i1', inspectorId: 'u1' },
            { inspectionId: 'i2', inspectorId: 'u1', leadInspectorId: 'u2', helperInspectorIds: ['u3'] },
        ]);

        expect((await linkRows()).map(r => `${r.inspection_id}:${r.user_id}:${r.role}`)).toEqual([
            'i1:u1:lead', 'i2:u2:lead', 'i2:u3:helper',
        ]);
    });

    it('a failing statement rolls back the WHOLE batch (atomicity the unit mock cannot test)', async () => {
        await seedLink('i1', 'old-1');
        await seedLink('i2', 'old-2');
        const db = drizzle(b.DB);

        // Item 2's duplicate helper ids violate the (inspection_id, user_id)
        // composite PK inside one insert statement — a poison statement late
        // in the batch. On real D1 the batch is an implicit transaction, so
        // item 1's already-executed delete+insert MUST also roll back.
        await expect(syncInspectionAssignmentsBatch(db, TENANT, [
            { inspectionId: 'i1', inspectorId: 'u1' },
            { inspectionId: 'i2', inspectorId: 'u2', helperInspectorIds: ['dup', 'dup'] },
        ])).rejects.toThrow();

        // Mirror table is EXACTLY as before — never half-synced.
        expect((await linkRows()).map(r => `${r.inspection_id}:${r.user_id}`)).toEqual([
            'i1:old-1', 'i2:old-2',
        ]);
    });
});

/**
 * D1 caps bind parameters at 100 per prepared statement, and the unit suite
 * does not: a multi-row VALUES insert that exceeds it passes there and returns
 * 400 in production. So this runs against a real binding, and it runs enough
 * rows that an unchunked insert cannot survive it.
 *
 * The staging insert is where that chunking now lives. It was the contact
 * importer's; the importer is gone and the property is not.
 */
describe('MigrationStageService.stage — real D1 bind limit', () => {
    beforeAll(async () => {
        // Full column list per schema/contact.ts. Staging reads this table (it
        // resolves each incoming contact against the tenant's existing ones by
        // email), so the DDL has to be here even though staging never writes to
        // it. The DB-9 partial unique index is included for fidelity.
        await b.DB.exec(
            // IA-104 appended the agent-binding columns (agent_user_id /
            // agent_linked_at / agent_revoked_at), and the multilingual work
            // appended `locale`.
            'CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT \'client\', name TEXT NOT NULL, email TEXT, phone TEXT, agency TEXT, notes TEXT, created_by_user_id TEXT, created_at INTEGER NOT NULL, archived_at INTEGER, agent_user_id TEXT, agent_linked_at INTEGER, agent_revoked_at INTEGER, locale TEXT);',
        );
        await b.DB.exec(
            'CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_tenant_email ON contacts (tenant_id, email) WHERE email IS NOT NULL AND archived_at IS NULL;',
        );
        // Per server/lib/db/schema/migration-intake.ts. `migration_rows` is the
        // table this spec is about: one row per staged entry, thirteen columns
        // in the schema and eight written at stage time.
        await b.DB.exec(
            'CREATE TABLE IF NOT EXISTS migration_batches (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, created_by TEXT NOT NULL, intent TEXT NOT NULL, target_id TEXT, vendor TEXT NOT NULL, adapter_name TEXT NOT NULL, adapter_version TEXT NOT NULL, manifest TEXT NOT NULL, conflict_policy TEXT, status TEXT NOT NULL DEFAULT \'staged\', created_at INTEGER NOT NULL, applied_at INTEGER, reverted_at INTEGER, source_key TEXT, expires_at INTEGER, upload_authorized_by TEXT, upload_authorized_at INTEGER, upload_authorization_version TEXT, staff_access_authorized_by TEXT, staff_access_authorized_at INTEGER, staff_access_authorization_version TEXT);',
        );
        await b.DB.exec(
            'CREATE TABLE IF NOT EXISTS migration_rows (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, tenant_id TEXT NOT NULL, entity TEXT NOT NULL, position INTEGER NOT NULL, payload TEXT NOT NULL, conflict_with TEXT, resolution TEXT, status TEXT NOT NULL DEFAULT \'pending\', outcome TEXT, created_id TEXT, prior_state TEXT, applied_at INTEGER);',
        );
    });
    beforeEach(async () => {
        await b.DB.exec('DELETE FROM contacts;');
        await b.DB.exec('DELETE FROM migration_rows;');
        await b.DB.exec('DELETE FROM migration_batches;');
    });

    it('stages two hundred entries in one batch without exceeding the bind cap', async () => {
        const svc = new MigrationStageService(b.DB);
        const contacts = Array.from({ length: 200 }, (_, i) => ({
            name: `P${i}`, email: `p${i}@example.test`, type: 'client' as const,
        }));
        const result = await svc.stage({
            tenantId: TENANT,
            createdBy: USER,
            intent: 'contacts.import',
            limits: { maxCsvBytes: 5_000_000, maxVendorExportBytes: 20_000_000, maxRows: 10_000 },
            bundle: {
                formatVersion: 1,
                manifest: {
                    source: { vendor: 'csv_generic' },
                    adapter: { name: 'csv-generic', version: '1' },
                    counts: {
                        template: { readFromSource: 0, emitted: 0, dropped: [] },
                        contact: { readFromSource: 200, emitted: 200, dropped: [] },
                        member: { readFromSource: 0, emitted: 0, dropped: [] },
                    },
                    warnings: [],
                },
                templates: [], contacts, members: [],
            },
        });
        expect(result.rows).toHaveLength(200);

        // The count is read back from the database, not from the return value:
        // a chunking bug that dropped a chunk would still return 200 plans.
        const { results } = await b.DB
            .prepare('SELECT COUNT(*) AS n FROM migration_rows WHERE batch_id = ?')
            .bind(result.batchId)
            .all<{ n: number }>();
        expect(results[0].n).toBe(200);
    });
});

describe('Phase U UnitService.createMany — real D1 bind limit', () => {
    // Regression for the E2E-found bug: a single VALUES list for the DEFAULT
    // bulk-create (3 floors × 4 = 12 units) binds 12 × ~10 columns = 120 params,
    // over D1's 100-bind cap → 400 in production while the better-sqlite3 unit
    // suite (no such cap) passes. createMany must chunk into db.batch().
    beforeAll(async () => {
        await b.DB.exec(
            'CREATE TABLE IF NOT EXISTS inspection_units (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, inspection_id TEXT NOT NULL, parent_unit_id TEXT, kind TEXT NOT NULL, type TEXT NOT NULL DEFAULT \'unit\', name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000), attrs TEXT);',
        );
    });
    beforeEach(async () => {
        await b.DB.exec('DELETE FROM inspection_units;');
    });

    it('bulk-creates 12 units (120 binds) — an unchunked VALUES list would blow the 100-bind cap', async () => {
        const svc = new UnitService(b.DB);
        const drafts = expandFloorsStacks({ floors: [1, 2, 3], stacks: 4, startAt: 1 });
        expect(drafts).toHaveLength(12);

        const { ids } = await svc.createMany(TENANT, 'insp-units', drafts, { kind: 'unit', type: 'unit' });

        expect(ids).toHaveLength(12);
        const count = await b.DB.prepare('SELECT COUNT(*) AS n FROM inspection_units WHERE inspection_id = ?')
            .bind('insp-units').first<{ n: number }>();
        expect(count?.n).toBe(12);
        const names = await b.DB.prepare('SELECT name FROM inspection_units WHERE inspection_id = ? ORDER BY sort_order')
            .bind('insp-units').all<{ name: string }>();
        expect(names.results.map(r => r.name)).toEqual(['101','102','103','104','201','202','203','204','301','302','303','304']);
    });
});

describe('B-28 arbitrateSlotRace — real D1 semantics', () => {
    beforeAll(seedSchema);
    beforeEach(clearTables);

    const DATE = '2026-07-07';
    const ISO = `${DATE}T08:00:00Z`;

    async function seedBooking(id: string, requestId: string | null, createdAtMs: number): Promise<void> {
        await b.DB.prepare(
            'INSERT INTO inspections (id, tenant_id, inspector_id, property_address, date, status, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(id, TENANT, 'insp-1', '1 Main St', ISO, 'requested', requestId, createdAtMs).run();
        await seedLink(id, 'insp-1');
    }

    it('the later racer loses, the earlier one wins (same rows, opposite verdicts)', async () => {
        await seedBooking('early', 'req-early', 1_000);
        await seedBooking('late', 'req-late', 2_000);
        const svc = new BookingService(b.DB);

        expect(await svc.arbitrateSlotRace(TENANT, 'insp-1', DATE, '08:00', 'req-early')).toBe('win');
        expect(await svc.arbitrateSlotRace(TENANT, 'insp-1', DATE, '08:00', 'req-late')).toBe('lose');
    });
});
