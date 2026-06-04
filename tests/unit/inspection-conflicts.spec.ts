/**
 * Inspection sync conflicts — list + resolve service behaviour.
 *
 * Tasks 12-14 of typed-hono-dead-routes-cleanup. Conflicts are persisted by
 * inspection-sync.ts at merge time (base/local/remote stored JSON-encoded);
 * these tests cover the read + clear service used by GET /conflicts and
 * POST /conflicts/resolve against an in-memory SQLite DB.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { listPendingConflicts, resolveConflicts } from '../../server/services/conflicts.service';
import { createTestDb, setupSchema } from './db';
import { inspectionConflicts } from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT_ID = 't-1';
const INSPECTION_ID = 'i-1';

describe('listPendingConflicts', () => {
    let db: BetterSQLite3Database<any>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db as any;
        await setupSchema(fix.sqlite);
    });

    it('returns empty when no conflicts stored', async () => {
        const result = await listPendingConflicts(db as any, TENANT_ID, INSPECTION_ID);
        expect(result.conflicts).toEqual([]);
    });

    it('returns stored conflicts and JSON-parses persisted values', async () => {
        await db.insert(inspectionConflicts).values({
            id:           'c-1',
            tenantId:     TENANT_ID,
            inspectionId: INSPECTION_ID,
            itemId:       'item-a',
            sectionId:    null,
            field:        'notes',
            base:         JSON.stringify('good'),
            local:        JSON.stringify('defect'),
            remote:       JSON.stringify('good'),
            createdAt:    new Date().toISOString(),
        } as any);

        const result = await listPendingConflicts(db as any, TENANT_ID, INSPECTION_ID);
        expect(result.conflicts).toHaveLength(1);
        expect(result.conflicts[0].itemId).toBe('item-a');
        expect(result.conflicts[0].field).toBe('notes');
        expect(result.conflicts[0].sectionId).toBeNull();
        expect(result.conflicts[0].base).toBe('good');
        expect(result.conflicts[0].local).toBe('defect');
        expect(result.conflicts[0].remote).toBe('good');
    });

    it('excludes already-resolved conflicts', async () => {
        await db.insert(inspectionConflicts).values({
            id:           'c-resolved',
            tenantId:     TENANT_ID,
            inspectionId: INSPECTION_ID,
            itemId:       'item-b',
            sectionId:    null,
            field:        'notes',
            base:         null,
            local:        null,
            remote:       null,
            createdAt:    new Date().toISOString(),
            resolvedAt:   new Date().toISOString(),
        } as any);

        const result = await listPendingConflicts(db as any, TENANT_ID, INSPECTION_ID);
        expect(result.conflicts).toEqual([]);
    });

    it('scopes conflicts to the requested inspection', async () => {
        await db.insert(inspectionConflicts).values({
            id:           'c-other',
            tenantId:     TENANT_ID,
            inspectionId: 'i-2',
            itemId:       'item-z',
            sectionId:    null,
            field:        'notes',
            base:         null,
            local:        null,
            remote:       null,
            createdAt:    new Date().toISOString(),
        } as any);

        const result = await listPendingConflicts(db as any, TENANT_ID, INSPECTION_ID);
        expect(result.conflicts).toEqual([]);
    });

    it('A-17 — never returns another tenant\'s conflicts even for the same inspection id', async () => {
        await db.insert(inspectionConflicts).values({
            id:           'c-foreign',
            tenantId:     't-other',
            inspectionId: INSPECTION_ID,
            itemId:       'item-a',
            sectionId:    null,
            field:        'notes',
            base:         null,
            local:        null,
            remote:       null,
            createdAt:    new Date().toISOString(),
        } as any);

        const result = await listPendingConflicts(db as any, TENANT_ID, INSPECTION_ID);
        expect(result.conflicts).toEqual([]);
    });
});

describe('resolveConflicts', () => {
    let db: BetterSQLite3Database<any>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db as any;
        await setupSchema(fix.sqlite);
        await db.insert(inspectionConflicts).values({
            id:           'c-1',
            tenantId:     TENANT_ID,
            inspectionId: INSPECTION_ID,
            itemId:       'item-a',
            sectionId:    null,
            field:        'notes',
            base:         JSON.stringify('good'),
            local:        JSON.stringify('defect'),
            remote:       JSON.stringify('good'),
            createdAt:    new Date().toISOString(),
        } as any);
    });

    it('clears resolved conflicts', async () => {
        const result = await resolveConflicts(db as any, TENANT_ID, INSPECTION_ID, [
            { itemId: 'item-a', sectionId: null, field: 'notes', chosen: 'local' },
        ]);
        expect(result.resolved).toBe(1);
        expect(result.resolvedAt).toBeTruthy();
        const remaining = await db.select().from(inspectionConflicts).all();
        expect(remaining).toHaveLength(0);
    });

    it('returns resolved=0 when nothing matches', async () => {
        const result = await resolveConflicts(db as any, TENANT_ID, INSPECTION_ID, [
            { itemId: 'no-such-item', sectionId: null, field: 'notes', chosen: 'remote' },
        ]);
        expect(result.resolved).toBe(0);
        const remaining = await db.select().from(inspectionConflicts).all();
        expect(remaining).toHaveLength(1);
    });

    it('A-17 — never clears another tenant\'s conflicts even for the same inspection id', async () => {
        const result = await resolveConflicts(db as any, 't-other', INSPECTION_ID, [
            { itemId: 'item-a', sectionId: null, field: 'notes', chosen: 'local' },
        ]);
        expect(result.resolved).toBe(0);
        const remaining = await db.select().from(inspectionConflicts).all();
        expect(remaining).toHaveLength(1);
    });
});
