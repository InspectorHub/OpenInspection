import { describe, it, expect, beforeEach } from 'vitest';
import { createMemoryQueueStorage } from '~/lib/offline/queue-storage.memory';
import type { QueueStorage } from '~/lib/offline/queue-storage';

/**
 * Unit tests for QueueStorage abstraction using the in-memory implementation.
 * The IDB implementation shares the same semantics but has no unit tests here
 * because happy-dom does not provide IndexedDB.
 */
describe('QueueStorage (in-memory)', () => {
    let store: QueueStorage;

    beforeEach(() => {
        store = createMemoryQueueStorage();
    });

    // ── 1. seq is strictly increasing across mixed putWrite / putPhoto ────────
    it('assigns strictly increasing seq across mixed writes and photos', async () => {
        const w1 = await store.putWrite({
            inspectionId: 'insp-1',
            intent: 'update-field',
            payload: { value: 'a' },
            enqueuedAt: Date.now(),
            attempts: 0,
            status: 'pending',
        });
        const p1 = await store.putPhoto({
            inspectionId: 'insp-1',
            itemId: 'item-1',
            name: 'photo.jpg',
            blob: new Blob(['x']),
            enqueuedAt: Date.now(),
            attempts: 0,
            status: 'pending',
        });
        const w2 = await store.putWrite({
            inspectionId: 'insp-1',
            intent: 'update-field',
            payload: { value: 'b' },
            enqueuedAt: Date.now(),
            attempts: 0,
            status: 'pending',
        });

        expect(w1.seq).toBeLessThan(p1.seq);
        expect(p1.seq).toBeLessThan(w2.seq);
        expect(w1.kind).toBe('write');
        expect(p1.kind).toBe('photo');
    });

    // ── 2. coalesce replaces a PENDING same-(inspectionId,itemId,field) write ─
    it('coalesce replaces matching pending write (old gone, new payload, count unchanged)', async () => {
        const original = await store.putWrite({
            inspectionId: 'insp-1',
            itemId: 'item-1',
            field: 'notes',
            intent: 'update-field',
            payload: { value: 'old' },
            enqueuedAt: Date.now(),
            attempts: 0,
            status: 'pending',
        });
        const originalSeq = original.seq;

        const { pending: pendingBefore } = await store.counts();

        const coalesced = await store.coalesce({
            inspectionId: 'insp-1',
            itemId: 'item-1',
            field: 'notes',
            intent: 'update-field',
            payload: { value: 'new' },
            enqueuedAt: Date.now(),
            attempts: 0,
            status: 'pending',
        });

        const { pending: pendingAfter } = await store.counts();
        const list = await store.listPending();

        // Count must not grow
        expect(pendingAfter).toBe(pendingBefore);
        // Old entry removed
        expect(list.find((e) => e.seq === originalSeq)).toBeUndefined();
        // New entry present with updated payload
        expect(coalesced.payload).toEqual({ value: 'new' });
        expect(coalesced.kind).toBe('write');
    });

    // ── 3. coalesce does NOT touch a FAILED entry with the same key ───────────
    it('coalesce leaves a failed entry frozen and inserts a new entry', async () => {
        const failed = await store.putWrite({
            inspectionId: 'insp-1',
            itemId: 'item-2',
            field: 'rating',
            intent: 'update-field',
            payload: { value: 'bad' },
            enqueuedAt: Date.now(),
            attempts: 1,
            status: 'pending',
        });
        await store.markFailed(failed.seq);

        const { pending: pendingBefore, failed: failedBefore } = await store.counts();

        const coalesced = await store.coalesce({
            inspectionId: 'insp-1',
            itemId: 'item-2',
            field: 'rating',
            intent: 'update-field',
            payload: { value: 'good' },
            enqueuedAt: Date.now(),
            attempts: 0,
            status: 'pending',
        });

        const { pending: pendingAfter, failed: failedAfter } = await store.counts();
        const list = await store.listPending();

        // Failed entry still exists
        expect(failedAfter).toBe(failedBefore);
        // A new pending entry was inserted
        expect(pendingAfter).toBe(pendingBefore + 1);
        // New entry is in the pending list
        expect(list.find((e) => e.seq === coalesced.seq)).toBeDefined();
        // Failed entry is NOT in the pending list
        expect(list.find((e) => e.seq === failed.seq)).toBeUndefined();
    });

    // ── 4. coalesce with no match behaves like putWrite ───────────────────────
    it('coalesce with no matching pending entry behaves like putWrite', async () => {
        const { pending: before } = await store.counts();
        const entry = await store.coalesce({
            inspectionId: 'insp-2',
            itemId: 'item-x',
            field: 'comment',
            intent: 'update-field',
            payload: { value: 'hello' },
            enqueuedAt: Date.now(),
            attempts: 0,
            status: 'pending',
        });
        const { pending: after } = await store.counts();

        expect(after).toBe(before + 1);
        expect(entry.kind).toBe('write');
    });

    // ── 5a. listPending() returns ascending seq ───────────────────────────────
    it('listPending() returns entries in ascending seq order', async () => {
        await store.putWrite({
            inspectionId: 'insp-1',
            intent: 'a',
            payload: {},
            enqueuedAt: Date.now(),
            attempts: 0,
            status: 'pending',
        });
        await store.putPhoto({
            inspectionId: 'insp-1',
            itemId: 'i1',
            name: 'p.jpg',
            blob: new Blob(['x']),
            enqueuedAt: Date.now(),
            attempts: 0,
            status: 'pending',
        });
        await store.putWrite({
            inspectionId: 'insp-1',
            intent: 'b',
            payload: {},
            enqueuedAt: Date.now(),
            attempts: 0,
            status: 'pending',
        });

        const list = await store.listPending();
        const seqs = list.map((e) => e.seq);
        expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
        expect(list.length).toBe(3);
    });

    // ── 5b. listPending(inspectionId) filters by inspectionId ────────────────
    it('listPending(inspectionId) filters to the given inspection', async () => {
        await store.putWrite({
            inspectionId: 'insp-A',
            intent: 'x',
            payload: {},
            enqueuedAt: Date.now(),
            attempts: 0,
            status: 'pending',
        });
        await store.putWrite({
            inspectionId: 'insp-B',
            intent: 'y',
            payload: {},
            enqueuedAt: Date.now(),
            attempts: 0,
            status: 'pending',
        });
        await store.putPhoto({
            inspectionId: 'insp-A',
            itemId: 'i1',
            name: 'p.jpg',
            blob: new Blob(['a']),
            enqueuedAt: Date.now(),
            attempts: 0,
            status: 'pending',
        });

        const listA = await store.listPending('insp-A');
        const listB = await store.listPending('insp-B');

        expect(listA.every((e) => e.inspectionId === 'insp-A')).toBe(true);
        expect(listA.length).toBe(2);
        expect(listB.length).toBe(1);
    });

    // ── 6. markFailed flips status; failed entries excluded from listPending ──
    it('markFailed flips status; failed entries appear in counts().failed but not listPending', async () => {
        const w = await store.putWrite({
            inspectionId: 'insp-1',
            intent: 'op',
            payload: {},
            enqueuedAt: Date.now(),
            attempts: 1,
            status: 'pending',
        });

        await store.markFailed(w.seq);

        const list = await store.listPending();
        const { pending, failed } = await store.counts();

        expect(list.find((e) => e.seq === w.seq)).toBeUndefined();
        expect(failed).toBe(1);
        expect(pending).toBe(0);
    });

    // ── 7. remove deletes an entry ────────────────────────────────────────────
    it('remove deletes the entry and counts() reflects it', async () => {
        const w = await store.putWrite({
            inspectionId: 'insp-1',
            intent: 'op',
            payload: {},
            enqueuedAt: Date.now(),
            attempts: 0,
            status: 'pending',
        });
        const p = await store.putPhoto({
            inspectionId: 'insp-1',
            itemId: 'i1',
            name: 'photo.jpg',
            blob: new Blob(['data']),
            enqueuedAt: Date.now(),
            attempts: 0,
            status: 'pending',
        });

        await store.remove(w.seq);

        const list = await store.listPending();
        const { pending } = await store.counts();

        expect(list.find((e) => e.seq === w.seq)).toBeUndefined();
        expect(list.find((e) => e.seq === p.seq)).toBeDefined();
        expect(pending).toBe(1);
    });

    // ── 8. counts() is accurate ───────────────────────────────────────────────
    it('counts() accurately tracks pending and failed across operations', async () => {
        const w1 = await store.putWrite({
            inspectionId: 'insp-1',
            intent: 'a',
            payload: {},
            enqueuedAt: Date.now(),
            attempts: 0,
            status: 'pending',
        });
        const w2 = await store.putWrite({
            inspectionId: 'insp-1',
            intent: 'b',
            payload: {},
            enqueuedAt: Date.now(),
            attempts: 0,
            status: 'pending',
        });

        let c = await store.counts();
        expect(c).toEqual({ pending: 2, failed: 0 });

        await store.markFailed(w1.seq);
        c = await store.counts();
        expect(c).toEqual({ pending: 1, failed: 1 });

        await store.remove(w2.seq);
        c = await store.counts();
        expect(c).toEqual({ pending: 0, failed: 1 });

        await store.remove(w1.seq);
        c = await store.counts();
        expect(c).toEqual({ pending: 0, failed: 0 });
    });

    // ── 9. photo entries carry blob through ───────────────────────────────────
    it('photo entries carry blob through storage unchanged', async () => {
        const originalBlob = new Blob(['hello-world'], { type: 'image/jpeg' });
        const photo = await store.putPhoto({
            inspectionId: 'insp-1',
            itemId: 'item-3',
            name: 'shot.jpg',
            blob: originalBlob,
            enqueuedAt: Date.now(),
            attempts: 0,
            status: 'pending',
        });

        const list = await store.listPending();
        const retrieved = list.find((e) => e.seq === photo.seq);

        expect(retrieved).toBeDefined();
        expect(retrieved!.kind).toBe('photo');
        if (retrieved!.kind === 'photo') {
            expect(retrieved!.blob).toBe(originalBlob); // same reference in memory impl
            const text = await retrieved!.blob.text();
            expect(text).toBe('hello-world');
        }
    });
});
