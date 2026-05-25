// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { db, openDb } from '../../public/js/db.js';

beforeEach(async () => {
    await openDb();
    await Promise.all([
        db.inspections.clear(),
        db.results.clear(),
        db.bases.clear(),
        db.syncQueue.clear(),
        db.conflicts.clear(),
    ]);
});

describe('db', () => {
    it('exposes 5 stores', () => {
        expect(db.inspections).toBeDefined();
        expect(db.results).toBeDefined();
        expect(db.bases).toBeDefined();
        expect(db.syncQueue).toBeDefined();
        expect(db.conflicts).toBeDefined();
    });

    it('persists and reads back an inspection record', async () => {
        await db.inspections.put({
            id: 'i1', tenantId: 't1', propertyAddress: '1 Main St',
            templateSnapshot: { sections: [] }, templateSnapshotVersion: 1, fetchedAt: Date.now(),
        });
        const row = await db.inspections.get('i1');
        expect(row?.propertyAddress).toBe('1 Main St');
    });

    it('syncQueue.count() returns inserted row count', async () => {
        await db.syncQueue.bulkAdd([
            { id: 'q1', op: 'results.merge', payload: {}, attempts: 0, createdAt: Date.now() },
            { id: 'q2', op: 'photo.upload',  payload: {}, attempts: 0, createdAt: Date.now() },
        ]);
        expect(await db.syncQueue.count()).toBe(2);
    });
});
