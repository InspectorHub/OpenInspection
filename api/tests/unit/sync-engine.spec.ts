// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, openDb } from '../../public/js/db.js';
import { drainQueue, syncEngineState } from '../../public/js/sync-engine.js';

beforeEach(async () => {
    await openDb();
    await db.syncQueue.clear();
    await db.bases.clear();
    await db.results.clear();
    syncEngineState.reset();
});

describe('sync-engine drainQueue', () => {
    it('returns idle when queue is empty', async () => {
        await drainQueue({ fetch: vi.fn() });
        expect(syncEngineState.get().status).toBe('idle');
    });

    it('drains a results.merge op on 200 success', async () => {
        await db.syncQueue.add({
            id: 'q1', op: 'results.merge',
            payload: { inspectionId: 'i1', baseSyncedAt: 0, base: {}, ours: { item1: { status: 'defect', notes: '', photos: [], updatedAt: 1 } } },
            attempts: 0, createdAt: Date.now(),
        });
        const fetch = vi.fn().mockResolvedValue({
            ok: true, status: 200,
            json: async () => ({ success: true, data: { merged: { item1: { status: 'defect', notes: '', photos: [], updatedAt: 1 } }, syncedAt: 100, conflicts: [] } }),
        });

        await drainQueue({ fetch });

        expect(await db.syncQueue.count()).toBe(0);
        const base = await db.bases.get('i1');
        expect(base?.syncedAt).toBe(100);
    });

    it('moves to conflicts store on 409 MERGE_CONFLICT', async () => {
        await db.syncQueue.add({
            id: 'q2', op: 'results.merge',
            payload: { inspectionId: 'i2', baseSyncedAt: 5, base: {}, ours: {} },
            attempts: 0, createdAt: Date.now(),
        });
        const fetch = vi.fn().mockResolvedValue({
            ok: false, status: 409,
            json: async () => ({
                success: false,
                error: { code: 'MERGE_CONFLICT', message: 'conflict', details: {
                    base: {}, theirs: {}, conflicts: [{ itemId: 'x', field: 'notes', base: 'a', ours: 'b', theirs: 'c' }],
                }},
            }),
        });

        await drainQueue({ fetch });

        expect(await db.syncQueue.count()).toBe(0);
        expect(await db.conflicts.count()).toBe(1);
    });

    it('exponential backoff on 5xx — does not delete queue row', async () => {
        await db.syncQueue.add({
            id: 'q3', op: 'results.merge',
            payload: { inspectionId: 'i3', baseSyncedAt: 0, base: {}, ours: {} },
            attempts: 0, createdAt: Date.now(),
        });
        const fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });

        await drainQueue({ fetch });

        const row = await db.syncQueue.get('q3');
        expect(row?.attempts).toBe(1);
        expect(await db.syncQueue.count()).toBe(1);
    });
});
