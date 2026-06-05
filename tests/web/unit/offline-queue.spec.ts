import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMemoryQueueStorage } from '~/lib/offline/queue-storage.memory';
import { OfflineQueue } from '~/lib/offline/offline-queue';
import type { ReplayTransport } from '~/lib/offline/offline-queue';
import type { QueueStorage, QueuedWrite, QueuedPhoto } from '~/lib/offline/queue-storage';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTransport(
    handler: (entry: QueuedWrite | QueuedPhoto) => Promise<{ ok: boolean; status: number }>,
): ReplayTransport {
    return {
        submitWrite: (w) => handler(w),
        submitPhoto: (p) => handler(p),
    };
}

function okTransport(): ReplayTransport {
    return makeTransport(async () => ({ ok: true, status: 200 }));
}

const BASE_NOW = 1_000_000;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OfflineQueue', () => {
    let store: QueueStorage;
    let queue: OfflineQueue;

    beforeEach(() => {
        store = createMemoryQueueStorage();
        queue = new OfflineQueue(store, okTransport());
    });

    // ── 1. Replay drains in seq order across mixed writes/photos ──────────────
    it('replays entries in ascending seq order across mixed writes and photos', async () => {
        // Enqueue in a known order: write, photo, write.
        await queue.enqueueWrite({
            inspectionId: 'insp-1',
            itemId: 'item-a',
            field: 'rating',
            intent: 'update-field',
            payload: { value: 3 },
            enqueuedAt: BASE_NOW,
        });
        await queue.enqueuePhoto({
            inspectionId: 'insp-1',
            itemId: 'item-b',
            name: 'shot.jpg',
            blob: new Blob(['img']),
            enqueuedAt: BASE_NOW + 1,
        });
        await queue.enqueueWrite({
            inspectionId: 'insp-1',
            itemId: 'item-c',
            field: 'notes',
            intent: 'update-field',
            payload: { value: 'ok' },
            enqueuedAt: BASE_NOW + 2,
        });

        const callOrder: string[] = [];
        const transport: ReplayTransport = {
            submitWrite: async (w) => {
                callOrder.push(`write:${w.field}`);
                return { ok: true, status: 200 };
            },
            submitPhoto: async (p) => {
                callOrder.push(`photo:${p.name}`);
                return { ok: true, status: 200 };
            },
        };
        queue = new OfflineQueue(store, transport);

        await queue.replay();

        expect(callOrder).toEqual(['write:rating', 'photo:shot.jpg', 'write:notes']);
    });

    // ── 2. All-2xx → all removed, correct result ──────────────────────────────
    it('removes all entries and reports synced count when all succeed', async () => {
        // Give distinct (itemId, field) keys so coalesce does NOT merge them.
        await queue.enqueueWrite({
            inspectionId: 'insp-1',
            itemId: 'item-a',
            field: 'f1',
            intent: 'op-a',
            payload: {},
            enqueuedAt: BASE_NOW,
        });
        await queue.enqueueWrite({
            inspectionId: 'insp-1',
            itemId: 'item-b',
            field: 'f2',
            intent: 'op-b',
            payload: {},
            enqueuedAt: BASE_NOW,
        });
        await queue.enqueuePhoto({
            inspectionId: 'insp-1',
            itemId: 'i1',
            name: 'p.jpg',
            blob: new Blob(['x']),
            enqueuedAt: BASE_NOW,
        });

        const result = await queue.replay();

        expect(result).toEqual({ synced: 3, conflicts: 0, failed: 0 });
        const { pending, failed } = await store.counts();
        expect(pending).toBe(0);
        expect(failed).toBe(0);
    });

    // ── 3. 409 → removed, conflicts counted, replay CONTINUES ─────────────────
    it('removes 409 entries, counts conflicts, and continues to subsequent entries', async () => {
        await queue.enqueueWrite({
            inspectionId: 'insp-1',
            itemId: 'item-1',
            field: 'f1',
            intent: 'update-field',
            payload: { value: 'x' },
            enqueuedAt: BASE_NOW,
        });
        await queue.enqueueWrite({
            inspectionId: 'insp-1',
            itemId: 'item-2',
            field: 'f2',
            intent: 'update-field',
            payload: { value: 'y' },
            enqueuedAt: BASE_NOW + 1,
        });

        const callOrder: string[] = [];
        const transport = makeTransport(async (entry) => {
            callOrder.push(entry.kind === 'write' ? (entry as QueuedWrite).field ?? '' : '?');
            // First entry → 409; second → 200.
            return callOrder.length === 1
                ? { ok: false, status: 409 }
                : { ok: true, status: 200 };
        });
        queue = new OfflineQueue(store, transport);

        const result = await queue.replay();

        expect(result).toEqual({ synced: 1, conflicts: 1, failed: 0 });
        // Both entries were processed.
        expect(callOrder).toHaveLength(2);
        // Storage is now empty.
        const { pending, failed } = await store.counts();
        expect(pending).toBe(0);
        expect(failed).toBe(0);
    });

    // ── 4. Transport throws → replay STOPS, entry stays pending, no attempt bump
    it('stops replay when transport throws and leaves entry pending with unchanged attempts', async () => {
        // Distinct (itemId, field) keys to prevent coalescing.
        await queue.enqueueWrite({
            inspectionId: 'insp-1',
            itemId: 'item-x',
            field: 'f1',
            intent: 'op',
            payload: {},
            enqueuedAt: BASE_NOW,
        });
        await queue.enqueueWrite({
            inspectionId: 'insp-1',
            itemId: 'item-y',
            field: 'f2',
            intent: 'op2',
            payload: {},
            enqueuedAt: BASE_NOW + 1,
        });

        let callCount = 0;
        const transport = makeTransport(async () => {
            callCount++;
            throw new TypeError('Failed to fetch');
        });
        queue = new OfflineQueue(store, transport);

        const result = await queue.replay();

        // Stopped after first throw — only one transport call attempted.
        expect(callCount).toBe(1);
        // Result reflects no synced/conflicts/failed.
        expect(result).toEqual({ synced: 0, conflicts: 0, failed: 0 });
        // Both entries are still pending with attempts=0.
        const entries = await store.listPending();
        expect(entries).toHaveLength(2);
        expect(entries.every((e) => e.attempts === 0)).toBe(true);
    });

    // ── 5. Active 500 × 3 across three replay() runs → markFailed, then skipped
    it('marks an entry failed after MAX_ATTEMPTS active 500 errors and skips it in later replays', async () => {
        // One write that always 500s.
        await queue.enqueueWrite({
            inspectionId: 'insp-1',
            itemId: 'item-poison',
            field: 'val',
            intent: 'update-field',
            payload: { value: 'bad' },
            enqueuedAt: BASE_NOW,
        });
        // One write that always succeeds (to confirm poisoned entry doesn't block it).
        await queue.enqueueWrite({
            inspectionId: 'insp-1',
            itemId: 'item-good',
            field: 'val',
            intent: 'update-field',
            payload: { value: 'good' },
            enqueuedAt: BASE_NOW + 1,
        });

        let transportCalls = 0;
        const transport: ReplayTransport = {
            submitWrite: async (w) => {
                transportCalls++;
                if (w.itemId === 'item-poison') return { ok: false, status: 500 };
                return { ok: true, status: 200 };
            },
            submitPhoto: async () => ({ ok: true, status: 200 }),
        };
        queue = new OfflineQueue(store, transport);

        // Run 1: poison gets attempts=1, good succeeds.
        const r1 = await queue.replay();
        expect(r1.synced).toBe(1); // "good" synced
        expect(r1.failed).toBe(0); // not yet at MAX_ATTEMPTS

        // Run 2: poison gets attempts=2.
        const r2 = await queue.replay();
        expect(r2.synced).toBe(0);
        expect(r2.failed).toBe(0);

        // Run 3: poison hits MAX_ATTEMPTS (3) → markFailed.
        const r3 = await queue.replay();
        expect(r3.failed).toBe(1);
        expect(r3.synced).toBe(0);

        // Storage now has 0 pending, 1 failed.
        const { pending, failed } = await store.counts();
        expect(pending).toBe(0);
        expect(failed).toBe(1);

        // Run 4: failed entries are excluded from listPending, so transport is not called again.
        transportCalls = 0;
        const r4 = await queue.replay();
        expect(r4).toEqual({ synced: 0, conflicts: 0, failed: 0 });
        expect(transportCalls).toBe(0);
    });

    // ── 6. Single-flight: concurrent replay() → transport called once per entry
    it('single-flight: two concurrent replay() calls share the in-flight promise', async () => {
        // Distinct keys to prevent coalescing.
        await queue.enqueueWrite({
            inspectionId: 'insp-1',
            itemId: 'item-p',
            field: 'f1',
            intent: 'op',
            payload: {},
            enqueuedAt: BASE_NOW,
        });
        await queue.enqueueWrite({
            inspectionId: 'insp-1',
            itemId: 'item-q',
            field: 'f2',
            intent: 'op2',
            payload: {},
            enqueuedAt: BASE_NOW + 1,
        });

        let transportCallCount = 0;
        const transport = makeTransport(async () => {
            transportCallCount++;
            return { ok: true, status: 200 };
        });
        queue = new OfflineQueue(store, transport);

        // Fire both concurrently.
        const [r1, r2] = await Promise.all([queue.replay(), queue.replay()]);

        // Each entry submitted exactly once.
        expect(transportCallCount).toBe(2);
        // Both promises resolve to the exact same object reference.
        expect(r1).toBe(r2);
        expect(r1).toEqual({ synced: 2, conflicts: 0, failed: 0 });
    });

    // ── 7. enqueueWrite coalesces + fires subscriber ───────────────────────────
    it('enqueueWrite coalesces matching pending writes and fires subscriber', async () => {
        let notifyCount = 0;
        const unsub = queue.subscribe(() => { notifyCount++; });

        // First write.
        await queue.enqueueWrite({
            inspectionId: 'insp-1',
            itemId: 'item-1',
            field: 'rating',
            intent: 'update-field',
            payload: { value: 1 },
            enqueuedAt: BASE_NOW,
        });
        expect(notifyCount).toBe(1);

        // Second write to same key — should coalesce (count stays at 1 pending).
        await queue.enqueueWrite({
            inspectionId: 'insp-1',
            itemId: 'item-1',
            field: 'rating',
            intent: 'update-field',
            payload: { value: 2 },
            enqueuedAt: BASE_NOW + 10,
        });
        expect(notifyCount).toBe(2);

        const { pending } = await store.counts();
        expect(pending).toBe(1); // coalesced, not 2

        // Verify the stored payload is the latest value.
        const entries = await store.listPending();
        expect(entries[0].kind).toBe('write');
        if (entries[0].kind === 'write') {
            expect(entries[0].payload).toEqual({ value: 2 });
        }

        unsub();
    });

    // ── 8. subscribe / unsubscribe lifecycle ──────────────────────────────────
    it('unsubscribed listeners are not called after unsubscribe', async () => {
        let callsA = 0;
        let callsB = 0;

        const unsubA = queue.subscribe(() => { callsA++; });
        const unsubB = queue.subscribe(() => { callsB++; });

        await queue.enqueueWrite({
            inspectionId: 'insp-1',
            itemId: 'item-1',
            field: 'f1',
            intent: 'op',
            payload: {},
            enqueuedAt: BASE_NOW,
        });
        // Both fired.
        expect(callsA).toBe(1);
        expect(callsB).toBe(1);

        // Unsubscribe A.
        unsubA();

        await queue.enqueueWrite({
            inspectionId: 'insp-1',
            itemId: 'item-2',
            field: 'f2',
            intent: 'op2',
            payload: {},
            enqueuedAt: BASE_NOW + 1,
        });
        // Only B fires.
        expect(callsA).toBe(1); // unchanged
        expect(callsB).toBe(2);

        // Unsubscribe B.
        unsubB();

        await queue.enqueueWrite({
            inspectionId: 'insp-1',
            itemId: 'item-3',
            field: 'f3',
            intent: 'op3',
            payload: {},
            enqueuedAt: BASE_NOW + 2,
        });
        // Neither fires.
        expect(callsA).toBe(1);
        expect(callsB).toBe(2);
    });

    // ── 9. Empty queue replay → {0,0,0}, no transport calls ──────────────────
    it('returns zero result and makes no transport calls when queue is empty', async () => {
        let transportCallCount = 0;
        const transport = makeTransport(async () => {
            transportCallCount++;
            return { ok: true, status: 200 };
        });
        queue = new OfflineQueue(store, transport);

        const result = await queue.replay();

        expect(result).toEqual({ synced: 0, conflicts: 0, failed: 0 });
        expect(transportCallCount).toBe(0);
    });

    // ── 10. Bonus: replay fires subscriber on each state change ───────────────
    it('replay fires subscriber when entries are removed or marked failed', async () => {
        await queue.enqueueWrite({
            inspectionId: 'insp-1',
            intent: 'op',
            payload: {},
            enqueuedAt: BASE_NOW,
        });

        let notifyCount = 0;
        // Reset counter after enqueue notification.
        const unsub = queue.subscribe(() => { notifyCount++; });

        await queue.replay();

        // At least one notification from the successful remove.
        expect(notifyCount).toBeGreaterThanOrEqual(1);
        unsub();
    });
});
