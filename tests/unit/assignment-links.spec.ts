import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from './db';
import { inspectionInspectors } from '../../server/lib/db/schema';
import { syncInspectionAssignments } from '../../server/lib/db/assignment-links';
import * as schema from '../../server/lib/db/schema';
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
});
