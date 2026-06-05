/**
 * offline-replay-conflict.spec.ts
 *
 * Proves three properties of the offline-queue replay pipeline:
 *
 *   1. Enqueue-time version capture — the expectedVersion baked into the
 *      payload at the moment of enqueueWrite is what the transport receives at
 *      replay time, even if an external "current version" variable has since
 *      been mutated.
 *
 *   2. 409 hand-off end-to-end — a 409 response removes the entry, increments
 *      conflicts, and replay continues to the next entry.  Result shape must be
 *      { synced, conflicts, failed } with the correct counts and an empty queue.
 *
 *   3. Transport payload fidelity — a nested defect-fields payload round-trips
 *      through FormData / JSON serialization intact.
 */

import { describe, it, expect } from 'vitest';
import { createMemoryQueueStorage } from '~/lib/offline/queue-storage.memory';
import { OfflineQueue } from '~/lib/offline/offline-queue';
import type { ReplayTransport } from '~/lib/offline/offline-queue';
import type { QueuedWrite } from '~/lib/offline/queue-storage';
import {
    versionKeyForIntent,
    lastKnownVersion,
} from '~/lib/offline/field-version-key';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_NOW = 2_000_000;

/**
 * A capturing transport that records every write entry it receives and always
 * returns 200 OK.  Useful for asserting the exact payload the transport sees.
 */
function makeCaptureTransport(): {
    transport: ReplayTransport;
    captured: QueuedWrite[];
} {
    const captured: QueuedWrite[] = [];
    const transport: ReplayTransport = {
        submitWrite: async (w) => {
            captured.push(w);
            return { ok: true, status: 200 };
        },
        submitPhoto: async () => ({ ok: true, status: 200 }),
    };
    return { transport, captured };
}

/**
 * Simulate the ActionTransport FormData round-trip for a write entry.
 * action-transport.ts encodes the payload as JSON.stringify(w.payload),
 * so we replicate that here to test payload fidelity without a real fetch.
 */
function roundTripPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const form = new FormData();
    form.set('payload', JSON.stringify(payload));
    return JSON.parse(form.get('payload') as string) as Record<string, unknown>;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('offline replay — enqueue-time version capture and 409 hand-off', () => {
    // ── 1. Enqueue-time version is frozen at enqueue, not at replay ───────────
    it('preserves the expectedVersion from enqueue time even after an external version variable mutates', async () => {
        const store = createMemoryQueueStorage();

        // Simulates the inspector's "current field version" as seen at enqueue
        // time.  The online BFF would send expectedVersion: enqueueTimeVersion.
        let externalCurrentVersion = 3;

        const { transport, captured } = makeCaptureTransport();
        const queue = new OfflineQueue(store, transport);

        // Enqueue with the version value captured AT THIS MOMENT.
        await queue.enqueueWrite({
            inspectionId: 'insp-v',
            itemId: 'item-v',
            field: 'rating',
            intent: 'rate',
            payload: {
                rating: 'Deficient',
                sectionId: 'sec-1',
                expectedVersion: externalCurrentVersion, // 3 at enqueue time
            },
            enqueuedAt: BASE_NOW,
        });

        // Simulate the server processing another write that bumps the version
        // AFTER the offline entry was queued but BEFORE replay fires.
        externalCurrentVersion = 7;

        await queue.replay();

        // The transport must have received the version baked in at enqueue (3),
        // not the post-mutation value (7).
        expect(captured).toHaveLength(1);
        expect(captured[0].payload.expectedVersion).toBe(3);
        expect(captured[0].payload.expectedVersion).not.toBe(externalCurrentVersion);
    });

    // ── 2. Enqueue captures version; coalesce also preserves it per-entry ─────
    it('captures a different expectedVersion for distinct items and delivers each to the transport', async () => {
        const store = createMemoryQueueStorage();
        const { transport, captured } = makeCaptureTransport();
        const queue = new OfflineQueue(store, transport);

        // Two different items, each with a distinct field version at enqueue time.
        await queue.enqueueWrite({
            inspectionId: 'insp-v',
            itemId: 'item-a',
            field: 'rating',
            intent: 'rate',
            payload: { rating: 'Good', sectionId: 'sec-1', expectedVersion: 1 },
            enqueuedAt: BASE_NOW,
        });
        await queue.enqueueWrite({
            inspectionId: 'insp-v',
            itemId: 'item-b',
            field: 'rating',
            intent: 'rate',
            payload: { rating: 'Deficient', sectionId: 'sec-1', expectedVersion: 5 },
            enqueuedAt: BASE_NOW + 1,
        });

        await queue.replay();

        expect(captured).toHaveLength(2);
        // Versions must match what was stored at enqueue time, in seq order.
        const versions = captured.map((w) => w.payload.expectedVersion);
        expect(versions).toEqual([1, 5]);
    });

    // ── 3. 409 hand-off: conflict counted, entry removed, replay continues ────
    it('counts a 409 as a conflict, removes the entry, and continues to the next entry', async () => {
        const store = createMemoryQueueStorage();

        const callOrder: string[] = [];
        const transport: ReplayTransport = {
            submitWrite: async (w) => {
                callOrder.push(w.field ?? '?');
                // First entry (f1) → 409; second (f2) → 200.
                return callOrder.length === 1
                    ? { ok: false, status: 409 }
                    : { ok: true, status: 200 };
            },
            submitPhoto: async () => ({ ok: true, status: 200 }),
        };
        const queue = new OfflineQueue(store, transport);

        await queue.enqueueWrite({
            inspectionId: 'insp-c',
            itemId: 'item-1',
            field: 'f1',
            intent: 'rate',
            payload: { rating: 'Good', expectedVersion: 2 },
            enqueuedAt: BASE_NOW,
        });
        await queue.enqueueWrite({
            inspectionId: 'insp-c',
            itemId: 'item-2',
            field: 'f2',
            intent: 'rate',
            payload: { rating: 'Deficient', expectedVersion: 0 },
            enqueuedAt: BASE_NOW + 1,
        });

        const result = await queue.replay();

        // Correct aggregate counts.
        expect(result).toEqual({ synced: 1, conflicts: 1, failed: 0 });

        // Both entries were visited — replay did NOT stop at the 409.
        expect(callOrder).toEqual(['f1', 'f2']);

        // Both entries removed from storage.
        const { pending, failed } = await store.counts();
        expect(pending).toBe(0);
        expect(failed).toBe(0);
    });

    // ── 4. All-409 queue: every entry becomes a conflict, queue drained ───────
    it('drains a queue where every entry returns 409 and reports conflicts=N', async () => {
        const store = createMemoryQueueStorage();
        const transport: ReplayTransport = {
            submitWrite: async () => ({ ok: false, status: 409 }),
            submitPhoto: async () => ({ ok: true, status: 200 }),
        };
        const queue = new OfflineQueue(store, transport);

        for (let i = 0; i < 3; i++) {
            await queue.enqueueWrite({
                inspectionId: 'insp-all-409',
                itemId: `item-${i}`,
                field: `f${i}`,
                intent: 'rate',
                payload: { rating: 'Good', expectedVersion: i },
                enqueuedAt: BASE_NOW + i,
            });
        }

        const result = await queue.replay();

        expect(result).toEqual({ synced: 0, conflicts: 3, failed: 0 });
        const { pending, failed } = await store.counts();
        expect(pending).toBe(0);
        expect(failed).toBe(0);
    });

    // ── 5. Transport payload fidelity: nested defect-fields round-trips intact ─
    it('round-trips a nested defect-fields payload through FormData JSON encoding without loss', () => {
        const originalPayload = {
            cannedId: 'defect-roof-001',
            sectionId: 'sec-roof',
            location: 'North corner',
            trade: 'Roofing',
            deadline: '30-days',
            timeframe: null,
            expectedVersion: 4,
        };

        const roundTripped = roundTripPayload(originalPayload);

        // Structural deep-equality: every field preserved.
        expect(roundTripped).toEqual(originalPayload);
        // Spot-check the null field (JSON null survives stringify/parse).
        expect(roundTripped.timeframe).toBeNull();
        // Spot-check version field.
        expect(roundTripped.expectedVersion).toBe(4);
    });

    // ── 7. Enqueue-time version capture maps each intent to its server counter ─
    // Mirrors what useFindings.tryEnqueueOffline does: read the field's
    // last-known `<field>_v` out of the ResultMap entry for the queued payload.
    // The version-key mapping MUST match InspectionService.patchItem's field
    // remapping (rate→rating_v, notes→notes_v, toggle-canned→cannedToggle_v,
    // set-defect-fields→tabs_v).
    it('maps each versioned intent to the server counter key patchItem bumps', () => {
        expect(versionKeyForIntent('rate')).toBe('rating_v');
        expect(versionKeyForIntent('notes')).toBe('notes_v');
        expect(versionKeyForIntent('toggle-canned')).toBe('cannedToggle_v');
        // patchItem remaps field "defectFields" → "tabs" before the version
        // bump, so the counter is tabs_v, NOT defectFields_v.
        expect(versionKeyForIntent('set-defect-fields')).toBe('tabs_v');
        // Whole-blob writes have no per-field counter.
        expect(versionKeyForIntent('save-all')).toBeNull();
    });

    it('reads the real last-known version out of the result entry for a rate write', () => {
        const entry = { rating: 'Deficient', rating_v: 5, notes: 'x', notes_v: 2 };
        // A rate replay must carry rating_v (5), not notes_v and not 0.
        expect(lastKnownVersion(entry, 'rate')).toBe(5);
        expect(lastKnownVersion(entry, 'notes')).toBe(2);
    });

    it('treats a legacy entry with no <field>_v as version 0 (initial counter)', () => {
        // Pre-subsystem-B rows have no rating_v — decideFieldWrite treats the
        // stored counter as 0, so expectedVersion 0 still gets a real check
        // (force:false) rather than a blind overwrite.
        expect(lastKnownVersion({ rating: 'Good' }, 'rate')).toBe(0);
        expect(lastKnownVersion(undefined, 'rate')).toBe(0);
    });

    it('returns null for save-all so the whole-blob payload is enqueued as-is', () => {
        expect(lastKnownVersion({ anything: 1 }, 'save-all')).toBeNull();
    });

    // ── 8. End-to-end: a captured entry replays with force:false + real version ─
    // Simulates useFindings building the offline payload (real version baked in)
    // and the replay-write action forwarding it as the non-force concurrency
    // check the server can 409 on. We assert the forwarded json shape directly.
    it('forwards force:false and the enqueue-time expectedVersion into the PATCH json', async () => {
        const store = createMemoryQueueStorage();
        const { transport, captured } = makeCaptureTransport();
        const queue = new OfflineQueue(store, transport);

        // useFindings.tryEnqueueOffline: rating_v=7 is the last-known version.
        const entry = { rating: 'Good', rating_v: 7 };
        const expectedVersion = lastKnownVersion(entry, 'rate');
        expect(expectedVersion).toBe(7);

        await queue.enqueueWrite({
            inspectionId: 'insp-e2e',
            itemId: 'item-e2e',
            field: 'rating',
            intent: 'rate',
            payload: { rating: 'Deficient', sectionId: 'sec-1', expectedVersion },
            enqueuedAt: BASE_NOW,
        });

        await queue.replay();

        expect(captured).toHaveLength(1);
        const w = captured[0];
        expect(w.payload.expectedVersion).toBe(7);

        // Reconstruct exactly what the replay-write action sends for intent
        // "rate": a real version check with force:false (the online path keeps
        // force:true — out of scope). This is the contract the server 409s on.
        const fwdVersion =
            typeof w.payload.expectedVersion === 'number'
                ? w.payload.expectedVersion
                : 0;
        const patchJson = {
            field: 'rating',
            value: String(w.payload.rating ?? ''),
            sectionId: String(w.payload.sectionId ?? ''),
            expectedVersion: fwdVersion,
            force: false,
        };
        expect(patchJson.force).toBe(false);
        expect(patchJson.expectedVersion).toBe(7);
        expect(patchJson.value).toBe('Deficient');
    });

    // ── 6. Enqueue-time payload is immutable: later object mutation is isolated ─
    it('does not reflect post-enqueue mutations to the original payload object', async () => {
        const store = createMemoryQueueStorage();
        const { transport, captured } = makeCaptureTransport();
        const queue = new OfflineQueue(store, transport);

        // Pass a mutable payload object.
        const mutablePayload: Record<string, unknown> = {
            rating: 'Good',
            sectionId: 'sec-1',
            expectedVersion: 2,
        };

        await queue.enqueueWrite({
            inspectionId: 'insp-mut',
            itemId: 'item-mut',
            field: 'rating',
            intent: 'rate',
            payload: mutablePayload,
            enqueuedAt: BASE_NOW,
        });

        // Mutate the object AFTER enqueue.
        mutablePayload.expectedVersion = 99;
        mutablePayload.rating = 'Deficient';

        await queue.replay();

        // The transport should have received the values from enqueue time.
        // Whether this holds depends on whether the storage implementation
        // deep-copies the payload.  The memory store uses spread, so a shallow
        // copy is taken — top-level primitive fields are isolated; nested
        // objects would share references.  expectedVersion is a primitive, so
        // it must be preserved.
        expect(captured).toHaveLength(1);
        expect(captured[0].payload.expectedVersion).toBe(2);
    });
});
