import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { inspectionInspectors } from '../../../server/lib/db/schema';
import { syncInspectionAssignments, syncInspectionAssignmentsBatch } from '../../../server/lib/db/assignment-links';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

describe('syncInspectionAssignments', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;
    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db; sqlite = setup.sqlite;
        await setupSchema(sqlite);
    });
    afterEach(() => sqlite.close());

    it('writes a lead row from inspectorId when leadInspectorId is absent', async () => {
        await syncInspectionAssignments(db as any, 't1', 'i1', { inspectorId: 'u1' });
        const rows = await db.select().from(inspectionInspectors).all();
        expect(rows).toEqual([expect.objectContaining({ userId: 'u1', role: 'lead' })]);
    });

    it('prefers leadInspectorId over inspectorId and adds helpers without duplicating the lead', async () => {
        await syncInspectionAssignments(db as any, 't1', 'i1', {
            inspectorId: 'u1', leadInspectorId: 'u2', helperInspectorIds: ['u2', 'u3'],
        });
        const rows = await db.select().from(inspectionInspectors).all();
        expect(rows.map(r => `${r.userId}:${r.role}`).sort()).toEqual(['u2:lead', 'u3:helper']);
    });

    it('is a full replace — removed helpers disappear on re-sync', async () => {
        await syncInspectionAssignments(db as any, 't1', 'i1', { inspectorId: 'u1', helperInspectorIds: ['u3'] });
        await syncInspectionAssignments(db as any, 't1', 'i1', { inspectorId: 'u1' });
        const rows = await db.select().from(inspectionInspectors).all();
        expect(rows).toHaveLength(1);
        expect(rows[0].userId).toBe('u1');
    });

    it('no assignee at all → zero rows, no throw', async () => {
        await syncInspectionAssignments(db as any, 't1', 'i1', {});
        expect(await db.select().from(inspectionInspectors).all()).toHaveLength(0);
    });

    it('tenant scoping — syncing tenant A does not touch tenant B rows for the same inspectionId', async () => {
        await syncInspectionAssignments(db as any, 'tA', 'i1', { inspectorId: 'u1' });
        await syncInspectionAssignments(db as any, 'tB', 'i1', { inspectorId: 'u9' });
        // re-sync tenant A — tenant B's row must survive
        await syncInspectionAssignments(db as any, 'tA', 'i1', { inspectorId: 'u2' });
        const rows = await db.select().from(inspectionInspectors).all();
        expect(rows.map(r => `${r.tenantId}:${r.userId}`).sort()).toEqual(['tA:u2', 'tB:u9']);
    });
});

// B-29 — bulk call sites (admin import, bulk-assign) used to loop the single
// sync per inspection (2N awaited statements). The batch variant collects all
// delete/insert statements and runs them in ONE db.batch() round trip on D1,
// with the standard sequential fallback for drivers without batch support
// (this better-sqlite3 test db among them).
describe('syncInspectionAssignmentsBatch', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;
    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db; sqlite = setup.sqlite;
        await setupSchema(sqlite);
    });
    afterEach(() => sqlite.close());

    it('resyncs multiple inspections in one call (sequential fallback driver)', async () => {
        // Pre-existing rows that the full-replace must overwrite.
        await syncInspectionAssignments(db as any, 't1', 'i1', { inspectorId: 'old-1' });
        await syncInspectionAssignments(db as any, 't1', 'i2', { inspectorId: 'old-2', helperInspectorIds: ['h-old'] });

        await syncInspectionAssignmentsBatch(db as any, 't1', [
            { inspectionId: 'i1', inspectorId: 'u1' },
            { inspectionId: 'i2', inspectorId: 'u1', leadInspectorId: 'u2', helperInspectorIds: ['u3'] },
            { inspectionId: 'i3', inspectorId: null },
        ]);

        const rows = await db.select().from(inspectionInspectors).all();
        expect(rows.map(r => `${r.inspectionId}:${r.userId}:${r.role}`).sort()).toEqual([
            'i1:u1:lead', 'i2:u2:lead', 'i2:u3:helper',
        ]);
    });

    it('issues a single db.batch call when the driver supports it', async () => {
        const batchSpy = vi.fn(async (stmts: unknown[]) => {
            for (const s of stmts) await s;
        });
        (db as any).batch = batchSpy;

        await syncInspectionAssignmentsBatch(db as any, 't1', [
            { inspectionId: 'i1', inspectorId: 'u1' },
            { inspectionId: 'i2', inspectorId: 'u2', helperInspectorIds: ['u3'] },
        ]);

        expect(batchSpy).toHaveBeenCalledTimes(1);
        // 2 deletes + 2 inserts collected into the one batch.
        expect(batchSpy.mock.calls[0]![0]).toHaveLength(4);
        const rows = await db.select().from(inspectionInspectors).all();
        expect(rows.map(r => `${r.inspectionId}:${r.userId}:${r.role}`).sort()).toEqual([
            'i1:u1:lead', 'i2:u2:lead', 'i2:u3:helper',
        ]);
    });

    it('empty items → no-op (no batch call, no throw)', async () => {
        const batchSpy = vi.fn();
        (db as any).batch = batchSpy;
        await syncInspectionAssignmentsBatch(db as any, 't1', []);
        expect(batchSpy).not.toHaveBeenCalled();
    });

    it('single-item batch matches the single-sync semantics (shared statement builder)', async () => {
        await syncInspectionAssignmentsBatch(db as any, 't1', [
            { inspectionId: 'i1', inspectorId: 'u1', leadInspectorId: 'u2', helperInspectorIds: ['u2', 'u3'] },
        ]);
        const rows = await db.select().from(inspectionInspectors).all();
        expect(rows.map(r => `${r.userId}:${r.role}`).sort()).toEqual(['u2:lead', 'u3:helper']);
    });
});
