/**
 * In-memory QueueStorage implementation.
 *
 * Used by unit tests and as the no-IDB fallback at runtime.  All operations
 * are synchronous under the hood but wrapped in Promises so the interface is
 * identical to the IndexedDB implementation.
 */

import type {
    QueueEntry,
    QueuedPhoto,
    QueuedWrite,
    QueueStorage,
} from '~/lib/offline/queue-storage';

export function createMemoryQueueStorage(): QueueStorage {
    // Entries are stored in insertion order (ascending seq).
    const entries = new Map<number, QueueEntry>();
    let nextSeq = 1;

    function allEntries(): QueueEntry[] {
        return [...entries.values()].sort((a, b) => a.seq - b.seq);
    }

    return {
        async putWrite(w) {
            // Deep-copy payload so post-enqueue mutations to the caller's object
            // do not bleed into the stored entry (enqueue-time isolation).
            const entry: QueuedWrite = { ...w, payload: { ...w.payload }, seq: nextSeq++, kind: 'write' };
            entries.set(entry.seq, entry);
            return entry;
        },

        async coalesce(w) {
            // Find a PENDING entry matching (inspectionId, itemId, field).
            // FAILED entries with the same key are deliberately skipped.
            for (const [seq, entry] of entries) {
                if (
                    entry.kind === 'write' &&
                    entry.status === 'pending' &&
                    entry.inspectionId === w.inspectionId &&
                    entry.itemId === w.itemId &&
                    entry.field === w.field
                ) {
                    entries.delete(seq);
                    break;
                }
            }
            // Re-enqueue at a new seq regardless of whether we found a match.
            // Deep-copy payload so post-enqueue mutations to the caller's object
            // do not bleed into the stored entry (enqueue-time isolation).
            const entry: QueuedWrite = { ...w, payload: { ...w.payload }, seq: nextSeq++, kind: 'write' };
            entries.set(entry.seq, entry);
            return entry;
        },

        async putPhoto(p) {
            const entry: QueuedPhoto = { ...p, seq: nextSeq++, kind: 'photo' };
            entries.set(entry.seq, entry);
            return entry;
        },

        async listPending(inspectionId?) {
            return allEntries().filter(
                (e) =>
                    e.status === 'pending' &&
                    (inspectionId === undefined || e.inspectionId === inspectionId),
            );
        },

        async markFailed(seq) {
            const entry = entries.get(seq);
            if (entry) {
                entries.set(seq, { ...entry, status: 'failed' });
            }
        },

        async remove(seq) {
            entries.delete(seq);
        },

        async counts() {
            let pending = 0;
            let failed = 0;
            for (const entry of entries.values()) {
                if (entry.status === 'pending') pending++;
                else if (entry.status === 'failed') failed++;
            }
            return { pending, failed };
        },
    };
}
