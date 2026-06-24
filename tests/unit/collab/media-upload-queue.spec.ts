// @vitest-environment happy-dom
/**
 * Unit tests for the offline media pending store + upload queue (#181 PR-G).
 *
 *   app/lib/collab/media-pending-store.ts
 *   app/lib/collab/media-upload-queue.ts
 *
 * Uses fake-indexeddb (wired in tests/unit/setup-client.ts) — no server.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    putPendingMedia,
    getPendingMedia,
    listPendingMedia,
    deletePendingMedia,
    type PendingMediaRecord,
} from '../../../app/lib/collab/media-pending-store';
import {
    enqueueMedia,
    drainMediaQueue,
    type MediaUploader,
    type UploadResult,
} from '../../../app/lib/collab/media-upload-queue';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let seq = 0;

/** Build a pending record with a unique id + monotonically increasing enqueuedAt. */
function makeRecord(overrides: Partial<PendingMediaRecord> = {}): PendingMediaRecord {
    seq += 1;
    return {
        pendingId:    overrides.pendingId ?? `p-${seq}-${crypto.randomUUID()}`,
        inspectionId: overrides.inspectionId ?? 'insp-1',
        findingKey:   overrides.findingKey ?? '_default:s1:i1',
        kind:         overrides.kind ?? 'photo',
        blob:         overrides.blob ?? new Blob([`bytes-${seq}`], { type: 'image/jpeg' }),
        photoKey:     overrides.photoKey,
        crop:         overrides.crop,
        nodesJson:    overrides.nodesJson,
        enqueuedAt:   overrides.enqueuedAt ?? seq,
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

/** Drain a fresh test DB by deleting every record before each test. */
async function clearStore(): Promise<void> {
    const all = await listPendingMedia();
    for (const r of all) await deletePendingMedia(r.pendingId);
}

beforeEach(async () => {
    await clearStore();
});

// ─── Store ────────────────────────────────────────────────────────────────────

describe('media-pending-store', () => {
    it('persists a record that survives a fresh read', async () => {
        // NOTE: fake-indexeddb under happy-dom revives the stored Blob as a plain
        // object (it fails `instanceof Blob` and has no `.text()`), so this test
        // asserts the record + its fields survive the round-trip, not Blob methods.
        // Real browsers return a genuine Blob; the store treats it as opaque bytes.
        const rec = makeRecord({ kind: 'crop', photoKey: 'orig-key', findingKey: 'fk-1' });
        await putPendingMedia(rec);

        const read = await getPendingMedia(rec.pendingId);
        expect(read).toBeDefined();
        expect(read?.pendingId).toBe(rec.pendingId);
        expect(read?.kind).toBe('crop');
        expect(read?.photoKey).toBe('orig-key');
        expect(read?.findingKey).toBe('fk-1');
        expect(read?.blob).toBeDefined();
    });

    it('getPendingMedia resolves undefined for an absent id', async () => {
        expect(await getPendingMedia('does-not-exist')).toBeUndefined();
    });

    it('listPendingMedia filters by inspection and sorts oldest-first', async () => {
        await putPendingMedia(makeRecord({ inspectionId: 'A', enqueuedAt: 30 }));
        await putPendingMedia(makeRecord({ inspectionId: 'A', enqueuedAt: 10 }));
        await putPendingMedia(makeRecord({ inspectionId: 'B', enqueuedAt: 20 }));

        const a = await listPendingMedia('A');
        expect(a.map((r) => r.enqueuedAt)).toEqual([10, 30]);
        expect(a.every((r) => r.inspectionId === 'A')).toBe(true);

        const all = await listPendingMedia();
        expect(all).toHaveLength(3);
    });

    it('deletePendingMedia removes a record', async () => {
        const rec = makeRecord();
        await putPendingMedia(rec);
        await deletePendingMedia(rec.pendingId);
        expect(await getPendingMedia(rec.pendingId)).toBeUndefined();
    });
});

// ─── Queue ────────────────────────────────────────────────────────────────────

describe('media-upload-queue', () => {
    it('enqueueMedia stores the blob and returns the pendingId', async () => {
        const rec = makeRecord();
        const id = await enqueueMedia(rec);
        expect(id).toBe(rec.pendingId);

        const read = await getPendingMedia(id);
        expect(read).toBeDefined();
        expect(read?.blob).toBeDefined();
    });

    it('drainMediaQueue uploads, calls onUploaded with the key, and deletes the record', async () => {
        const rec = makeRecord({ inspectionId: 'insp-1' });
        await enqueueMedia(rec);

        const { uploader, calls } = okUploader({ key: 'r2/photo-123' });
        const swaps: Array<{ rec: PendingMediaRecord; result: UploadResult }> = [];

        const summary = await drainMediaQueue({
            inspectionId: 'insp-1',
            uploader,
            onUploaded: (r, result) => swaps.push({ rec: r, result }),
        });

        expect(summary).toEqual({ uploaded: 1, failed: 0 });
        expect(calls).toHaveLength(1);
        expect(swaps).toHaveLength(1);
        expect(swaps[0].result.key).toBe('r2/photo-123');
        // Store empty after a successful drain.
        expect(await listPendingMedia('insp-1')).toHaveLength(0);
    });

    it('a failing uploader leaves the record queued, counts failed, never calls onUploaded', async () => {
        const rec = makeRecord({ inspectionId: 'insp-1' });
        await enqueueMedia(rec);

        let onUploadedCalls = 0;
        const failingUploader: MediaUploader = {
            upload: async () => { throw new Error('network down'); },
        };

        const summary = await drainMediaQueue({
            inspectionId: 'insp-1',
            uploader: failingUploader,
            onUploaded: () => { onUploadedCalls += 1; },
        });

        expect(summary).toEqual({ uploaded: 0, failed: 1 });
        expect(onUploadedCalls).toBe(0);
        // Record stays queued for the next drain.
        const still = await listPendingMedia('insp-1');
        expect(still).toHaveLength(1);
        expect(still[0].pendingId).toBe(rec.pendingId);
    });

    it('mixed batch (2 ok, 1 fail): 2 uploaded+deleted, 1 remains, second drain retries it', async () => {
        const recA = makeRecord({ inspectionId: 'insp-1', enqueuedAt: 1, pendingId: 'A' });
        const recBad = makeRecord({ inspectionId: 'insp-1', enqueuedAt: 2, pendingId: 'BAD' });
        const recC = makeRecord({ inspectionId: 'insp-1', enqueuedAt: 3, pendingId: 'C' });
        await enqueueMedia(recA);
        await enqueueMedia(recBad);
        await enqueueMedia(recC);

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
            uploader: flaky,
            onUploaded: () => { /* noop */ },
        });
        expect(first).toEqual({ uploaded: 2, failed: 1 });
        expect(firstUploaded.sort()).toEqual(['A', 'C']);

        const remaining = await listPendingMedia('insp-1');
        expect(remaining.map((r) => r.pendingId)).toEqual(['BAD']);

        // Second drain: the recovered uploader clears BAD.
        const { uploader: recovered, calls } = okUploader({ key: 'r2/BAD' });
        const second = await drainMediaQueue({
            inspectionId: 'insp-1',
            uploader: recovered,
            onUploaded: () => { /* noop */ },
        });
        expect(second).toEqual({ uploaded: 1, failed: 0 });
        expect(calls.map((r) => r.pendingId)).toEqual(['BAD']);
        expect(await listPendingMedia('insp-1')).toHaveLength(0);
    });

    it('drains only the target inspection, leaving other inspections untouched', async () => {
        await enqueueMedia(makeRecord({ inspectionId: 'insp-1' }));
        await enqueueMedia(makeRecord({ inspectionId: 'insp-2' }));

        const { uploader } = okUploader();
        const summary = await drainMediaQueue({
            inspectionId: 'insp-1',
            uploader,
            onUploaded: () => { /* noop */ },
        });

        expect(summary.uploaded).toBe(1);
        expect(await listPendingMedia('insp-1')).toHaveLength(0);
        expect(await listPendingMedia('insp-2')).toHaveLength(1);
    });
});
