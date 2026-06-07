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

interface TestBindings { DB: D1Database }
const b = env as unknown as TestBindings;

const TENANT = 'tenant-batch';

async function seedSchema(): Promise<void> {
    // Minimal-but-faithful DDL (per server/lib/db/schema/inspection.ts):
    // the composite PK on inspection_inspectors is what the atomicity probe
    // trips, so it must match production.
    await b.DB.exec(
        'CREATE TABLE IF NOT EXISTS inspection_inspectors (inspection_id TEXT NOT NULL, user_id TEXT NOT NULL, tenant_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT \'lead\', created_at INTEGER NOT NULL, PRIMARY KEY (inspection_id, user_id));',
    );
    await b.DB.exec(
        'CREATE TABLE IF NOT EXISTS inspections (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, inspector_id TEXT, property_address TEXT, date TEXT, status TEXT, request_id TEXT, created_at INTEGER NOT NULL);',
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

describe('B-28 arbitrateSlotRace — real D1 semantics', () => {
    beforeAll(seedSchema);
    beforeEach(clearTables);

    const DATE = '2026-07-07';
    const ISO = `${DATE}T08:00:00Z`;

    async function seedBooking(id: string, requestId: string | null, createdAtMs: number): Promise<void> {
        await b.DB.prepare(
            'INSERT INTO inspections (id, tenant_id, inspector_id, property_address, date, status, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(id, TENANT, 'insp-1', '1 Main St', ISO, 'draft', requestId, createdAtMs).run();
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
