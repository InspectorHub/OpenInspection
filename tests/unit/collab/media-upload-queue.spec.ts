/**
 * Unit tests for the offline media upload queue (#181 PR-G).
 *
 *   packages/field-ui/src/collab/media-upload-queue.ts
 *
 * The store is INJECTED, so these run against an in-memory `PendingMediaStore`:
 * no IndexedDB, no DOM, no server. The IndexedDB implementation and its
 * on-disk layout are covered by app/lib/field/web-media-store.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { PendingMediaRecord, PendingMediaStore } from '@core/field-ui/media-types';
import {
    enqueueMedia,
    drainMediaQueue,
    type MediaUploader,
    type UploadResult,
} from '@core/field-ui/collab/media-upload-queue';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** An in-memory store. `list` deliberately returns insertion order, NOT oldest-first. */
function memoryStore(): PendingMediaStore & { rows: Map<string, PendingMediaRecord> } {
    const rows = new Map<string, PendingMediaRecord>();
    return {
        rows,
        put: async (rec) => { rows.set(rec.pendingId, rec); },
        get: async (id) => rows.get(id) ?? null,
        list: async (inspectionId) =>
            [...rows.values()].filter((r) => inspectionId === undefined || r.inspectionId === inspectionId),
        delete: async (id) => { rows.delete(id); },
        objectUrl: async (id) => (rows.has(id) ? `blob:mem/${id}` : null),
    };
}

let seq = 0;

/** Build a photo record with a unique id + monotonically increasing createdAt. */
function makeRecord(overrides: { pendingId?: string; inspectionId?: string; createdAt?: number } = {}): PendingMediaRecord {
    seq += 1;
    return {
        kind: 'photo',
        pendingId: overrides.pendingId ?? `p-${seq}`,
        inspectionId: overrides.inspectionId ?? 'insp-1',
        blob: new Blob([`bytes-${seq}`], { type: 'image/jpeg' }),
        createdAt: overrides.createdAt ?? seq,
        meta: { targetType: 'item', findingKey: '_default:s1:i1', itemId: 'i1' },
    };
}

/** A stub uploader returning a fixed result; records each call. */
function okUploader(result: UploadResult = { key: 'r2/new-key' }): {
    uploader: MediaUploader;
    calls: PendingMediaRecord[];
} {
    const calls: PendingMediaRecord[] = [];
    return {
        calls,
        uploader: {
            upload: async (rec) => {
                calls.push(rec);
                return result;
            },
        },
    };
}

let store: ReturnType<typeof memoryStore>;

beforeEach(() => {
    store = memoryStore();
});

// ─── Queue ────────────────────────────────────────────────────────────────────

describe('media-upload-queue', () => {
    it('enqueueMedia stores the record through the injected store and returns the pendingId', async () => {
        const rec = makeRecord();
        const id = await enqueueMedia(store, rec);
        expect(id).toBe(rec.pendingId);
        expect(await store.get(id)).toBe(rec);
    });

    it('enqueueMedia rejects when the store write rejects (nothing is reported queued)', async () => {
        const failing: PendingMediaStore = { ...store, put: async () => { throw new Error('quota'); } };
        await expect(enqueueMedia(failing, makeRecord())).rejects.toThrow('quota');
    });

    it('drainMediaQueue uploads, calls onUploaded with the key, and deletes the record', async () => {
        await enqueueMedia(store, makeRecord({ inspectionId: 'insp-1' }));

        const { uploader, calls } = okUploader({ key: 'r2/photo-123' });
        const swaps: Array<{ rec: PendingMediaRecord; result: UploadResult }> = [];

        const summary = await drainMediaQueue({
            inspectionId: 'insp-1',
            store,
            uploader,
            onUploaded: (r, result) => swaps.push({ rec: r, result }),
        });

        expect(summary).toEqual({ uploaded: 1, failed: 0 });
        expect(calls).toHaveLength(1);
        expect(swaps).toHaveLength(1);
        expect(swaps[0].result.key).toBe('r2/photo-123');
        // Store empty after a successful drain.
        expect(await store.list('insp-1')).toHaveLength(0);
    });

    it('onUploaded runs BEFORE the record is deleted', async () => {
        const rec = makeRecord();
        await enqueueMedia(store, rec);
        let presentDuringSwap: boolean | null = null;
        await drainMediaQueue({
            inspectionId: 'insp-1',
            store,
            uploader: okUploader().uploader,
            onUploaded: () => { presentDuringSwap = store.rows.has(rec.pendingId); },
        });
        expect(presentDuringSwap).toBe(true);
        expect(store.rows.has(rec.pendingId)).toBe(false);
    });

    it('a failing uploader leaves the record queued, counts failed, never calls onUploaded', async () => {
        const rec = makeRecord({ inspectionId: 'insp-1' });
        await enqueueMedia(store, rec);

        let onUploadedCalls = 0;
        const failingUploader: MediaUploader = {
            upload: async () => { throw new Error('network down'); },
        };

        const summary = await drainMediaQueue({
            inspectionId: 'insp-1',
            store,
            uploader: failingUploader,
            onUploaded: () => { onUploadedCalls += 1; },
        });

        expect(summary).toEqual({ uploaded: 0, failed: 1 });
        expect(onUploadedCalls).toBe(0);
        // Record stays queued for the next drain.
        const still = await store.list('insp-1');
        expect(still).toHaveLength(1);
        expect(still[0].pendingId).toBe(rec.pendingId);
    });

    it('mixed batch (2 ok, 1 fail): 2 uploaded+deleted, 1 remains, second drain retries it', async () => {
        await enqueueMedia(store, makeRecord({ inspectionId: 'insp-1', createdAt: 1, pendingId: 'A' }));
        await enqueueMedia(store, makeRecord({ inspectionId: 'insp-1', createdAt: 2, pendingId: 'BAD' }));
        await enqueueMedia(store, makeRecord({ inspectionId: 'insp-1', createdAt: 3, pendingId: 'C' }));

        // First drain: BAD throws, A + C succeed.
        const firstUploaded: string[] = [];
        const flaky: MediaUploader = {
            upload: async (rec) => {
                if (rec.pendingId === 'BAD') throw new Error('boom');
                firstUploaded.push(rec.pendingId);
                return { key: `r2/${rec.pendingId}` };
            },
        };
        const first = await drainMediaQueue({
            inspectionId: 'insp-1',
            store,
            uploader: flaky,
            onUploaded: () => { /* noop */ },
        });
        expect(first).toEqual({ uploaded: 2, failed: 1 });
        expect(firstUploaded.sort()).toEqual(['A', 'C']);

        const remaining = await store.list('insp-1');
        expect(remaining.map((r) => r.pendingId)).toEqual(['BAD']);

        // Second drain: the recovered uploader clears BAD.
        const { uploader: recovered, calls } = okUploader({ key: 'r2/BAD' });
        const second = await drainMediaQueue({
            inspectionId: 'insp-1',
            store,
            uploader: recovered,
            onUploaded: () => { /* noop */ },
        });
        expect(second).toEqual({ uploaded: 1, failed: 0 });
        expect(calls.map((r) => r.pendingId)).toEqual(['BAD']);
        expect(await store.list('insp-1')).toHaveLength(0);
    });

    it('uploads oldest first even when the store lists out of order', async () => {
        await enqueueMedia(store, makeRecord({ pendingId: 'late', createdAt: 30 }));
        await enqueueMedia(store, makeRecord({ pendingId: 'early', createdAt: 10 }));
        await enqueueMedia(store, makeRecord({ pendingId: 'mid', createdAt: 20 }));
        const { uploader, calls } = okUploader();
        await drainMediaQueue({ inspectionId: 'insp-1', store, uploader, onUploaded: () => { /* noop */ } });
        expect(calls.map((r) => r.pendingId)).toEqual(['early', 'mid', 'late']);
    });

    it('drains only the target inspection, leaving other inspections untouched', async () => {
        await enqueueMedia(store, makeRecord({ inspectionId: 'insp-1' }));
        await enqueueMedia(store, makeRecord({ inspectionId: 'insp-2' }));

        const { uploader } = okUploader();
        const summary = await drainMediaQueue({
            inspectionId: 'insp-1',
            store,
            uploader,
            onUploaded: () => { /* noop */ },
        });

        expect(summary.uploaded).toBe(1);
        expect(await store.list('insp-1')).toHaveLength(0);
        expect(await store.list('insp-2')).toHaveLength(1);
    });

    it('a failed store.delete after a good upload does not wedge or fail the drain', async () => {
        await enqueueMedia(store, makeRecord());
        const flakyDelete: PendingMediaStore = { ...store, delete: async () => { throw new Error('idb'); } };
        const summary = await drainMediaQueue({
            inspectionId: 'insp-1',
            store: flakyDelete,
            uploader: okUploader().uploader,
            onUploaded: () => { /* noop */ },
        });
        expect(summary).toEqual({ uploaded: 1, failed: 0 });
    });

    it('after a failed delete the next drain retries ONLY the delete: no second upload, no second swap', async () => {
        const rec = makeRecord();
        await enqueueMedia(store, rec);
        let failDelete = true;
        const flaky: PendingMediaStore = {
            ...store,
            delete: async (id) => { if (failDelete) throw new Error('idb'); await store.delete(id); },
        };
        const { uploader, calls } = okUploader();
        const swaps: string[] = [];
        const cleanupErrors: string[] = [];
        const deps = {
            inspectionId: 'insp-1',
            store: flaky,
            uploader,
            onUploaded: (r: PendingMediaRecord) => { swaps.push(r.pendingId); },
            onCleanupFailed: (r: PendingMediaRecord) => { cleanupErrors.push(r.pendingId); },
        };
        expect(await drainMediaQueue(deps)).toEqual({ uploaded: 1, failed: 0 });
        expect(cleanupErrors).toEqual([rec.pendingId]);

        failDelete = false;
        expect(await drainMediaQueue(deps)).toEqual({ uploaded: 0, failed: 0 });
        expect(calls).toHaveLength(1);
        expect(swaps).toEqual([rec.pendingId]);
        expect(await store.list('insp-1')).toHaveLength(0);
    });

    it('a second concurrent drain for the same inspection is coalesced (no double upload)', async () => {
        await enqueueMedia(store, makeRecord());
        let release: () => void = () => { /* replaced below */ };
        const gate = new Promise<void>((r) => { release = r; });
        const calls: string[] = [];
        const slow: MediaUploader = {
            upload: async (rec) => { calls.push(rec.pendingId); await gate; return { key: 'k' }; },
        };
        const deps = { inspectionId: 'insp-1', store, uploader: slow, onUploaded: () => { /* noop */ } };
        const first = drainMediaQueue(deps);
        await Promise.resolve();
        const second = await drainMediaQueue(deps);
        expect(second).toEqual({ uploaded: 0, failed: 0 });
        release();
        expect(await first).toEqual({ uploaded: 1, failed: 0 });
        expect(calls).toHaveLength(1);
        // The guard is released afterwards: a later drain runs again.
        await enqueueMedia(store, makeRecord());
        const third = await drainMediaQueue({ ...deps, uploader: okUploader().uploader });
        expect(third.uploaded).toBe(1);
    });
});
