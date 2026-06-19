/**
 * OfflineQueue — ordered replay, 409 hand-off, bounded retries, single-flight.
 *
 * Retry rule (refined):
 *   • Transient failure (transport throws / network error): replay STOPS immediately.
 *     The entry stays pending with attempts UNCHANGED.  The network is down; retrying
 *     later entries would also fail, so we abort the run early.
 *   • Active server error (non-2xx, non-409 status returned): this is the server
 *     actively rejecting the payload.  attempts is incremented by removing and
 *     re-putting the entry (preserving enqueuedAt).  If attempts reaches MAX_ATTEMPTS
 *     the entry is markFailed (frozen) and the replay CONTINUES to the next entry —
 *     a poisoned entry must not permanently block the queue.
 *   • 2xx: success → remove → synced++; replay continues.
 *   • 409: the server's field-version conflict machinery already recorded the conflict;
 *     the conflict-resolver UI takes over.  Remove the entry → conflicts++; continue.
 *
 * NOTE on re-put to bump attempts:
 *   `storage.putWrite` / `storage.putPhoto` assign a NEW seq, which would push the
 *   entry to the back of the queue.  This is intentional for active errors: a payload
 *   the server rejected is unlikely to be safe to replay before newer writes that may
 *   depend on different server state.  However, within a SINGLE replay run we already
 *   snapshot `listPending()` at the start, so a re-put entry does NOT appear in the
 *   current run's iteration — it will appear in a future replay run, giving the server
 *   a fresh attempt.  This is the simplest correct approach; the alternative of
 *   mutating the entry in-place would require storage.update() which does not exist.
 */

import type { QueueStorage, QueuedWrite, QueuedPhoto, QueuedCrop } from './queue-storage';

// ── Public parameter types (Omit resolved) ────────────────────────────────────

/** Parameters for enqueueWrite — caller does not supply seq / kind / attempts / status. */
export type WriteParams = Omit<QueuedWrite, 'seq' | 'kind' | 'attempts' | 'status'>;

/** Parameters for enqueuePhoto — caller does not supply seq / kind / attempts / status. */
export type PhotoParams = Omit<QueuedPhoto, 'seq' | 'kind' | 'attempts' | 'status'>;

/** Parameters for enqueueCrop — caller does not supply seq / kind / attempts / status. */
export type CropParams = Omit<QueuedCrop, 'seq' | 'kind' | 'attempts' | 'status'>;

// ── Transport ─────────────────────────────────────────────────────────────────

export interface ReplayTransport {
    submitWrite(w: QueuedWrite): Promise<{ ok: boolean; status: number }>;
    submitPhoto(p: QueuedPhoto): Promise<{ ok: boolean; status: number }>;
    submitCrop(c: QueuedCrop): Promise<{ ok: boolean; status: number }>;
}

// ── Result & listener ─────────────────────────────────────────────────────────

export interface ReplayResult {
    synced: number;
    conflicts: number;
    failed: number;
}

export type QueueListener = () => void;

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;

// ── OfflineQueue ──────────────────────────────────────────────────────────────

export class OfflineQueue {
    private listeners = new Set<QueueListener>();
    /** Single-flight guard: the in-flight replay promise (if any). */
    private replayPromise: Promise<ReplayResult> | null = null;

    constructor(
        private storage: QueueStorage,
        private transport: ReplayTransport,
    ) {}

    // ── Subscription ─────────────────────────────────────────────────────────

    /**
     * Subscribe to queue-changed events (enqueue / replay mutations).
     * Returns an unsubscribe function.
     */
    subscribe(cb: QueueListener): () => void {
        this.listeners.add(cb);
        return () => {
            this.listeners.delete(cb);
        };
    }

    private emit(): void {
        for (const cb of this.listeners) {
            cb();
        }
    }

    // ── Enqueue ───────────────────────────────────────────────────────────────

    /**
     * Enqueue a write.  Uses `coalesce` so that a pending write for the same
     * (inspectionId, itemId, field) is replaced rather than duplicated.
     */
    async enqueueWrite(params: WriteParams): Promise<void> {
        await this.storage.coalesce({
            ...params,
            attempts: 0,
            status: 'pending',
        });
        this.emit();
    }

    /**
     * Enqueue a photo upload.  Photos are never coalesced (each upload is
     * distinct).
     */
    async enqueuePhoto(params: PhotoParams): Promise<void> {
        await this.storage.putPhoto({
            ...params,
            attempts: 0,
            status: 'pending',
        });
        this.emit();
    }

    /** Enqueue a baked crop derivative for later replay (Plan 4, offline-capable
     *  crop). Crops, like photos, are never coalesced — each baked derivative is
     *  distinct. */
    async enqueueCrop(params: CropParams): Promise<void> {
        await this.storage.putCrop({
            ...params,
            attempts: 0,
            status: 'pending',
        });
        this.emit();
    }

    // ── Counts ────────────────────────────────────────────────────────────────

    /** Return current pending / failed counts from storage. */
    counts(): Promise<{ pending: number; failed: number }> {
        return this.storage.counts();
    }

    // ── Replay ────────────────────────────────────────────────────────────────

    /**
     * Replay all pending entries in ascending seq order.
     *
     * Single-flight: concurrent calls share the in-flight promise.
     */
    replay(): Promise<ReplayResult> {
        if (this.replayPromise) {
            return this.replayPromise;
        }
        this.replayPromise = this._doReplay().finally(() => {
            this.replayPromise = null;
        });
        return this.replayPromise;
    }

    private async _doReplay(): Promise<ReplayResult> {
        const result: ReplayResult = { synced: 0, conflicts: 0, failed: 0 };

        // Snapshot the pending list at the start of this run.
        const entries = await this.storage.listPending();

        for (const entry of entries) {
            let response: { ok: boolean; status: number };

            // ── Submit ────────────────────────────────────────────────────────
            try {
                if (entry.kind === 'write') {
                    response = await this.transport.submitWrite(entry);
                } else if (entry.kind === 'crop') {
                    response = await this.transport.submitCrop(entry);
                } else {
                    response = await this.transport.submitPhoto(entry);
                }
            } catch {
                // Transport threw (network error / offline).  Stop the run;
                // do NOT bump attempts — this was not an active server rejection.
                break;
            }

            // ── Handle response ───────────────────────────────────────────────

            if (response.ok || (response.status >= 200 && response.status < 300)) {
                // 2xx success
                await this.storage.remove(entry.seq);
                result.synced++;
                this.emit();
                continue;
            }

            if (response.status === 409) {
                // Conflict — server recorded it; hand off to conflict-resolver UI.
                await this.storage.remove(entry.seq);
                result.conflicts++;
                this.emit();
                continue;
            }

            // ── Active server error (4xx/5xx, non-409) ────────────────────────
            // Increment attempts.  QueueStorage has no in-place update, so we
            // remove the old entry and re-put at a NEW seq (re-enqueue semantics).
            // The entry will not appear in this run's snapshot (already snapshotted),
            // so it will be retried in a future replay() call.
            const newAttempts = entry.attempts + 1;

            if (newAttempts >= MAX_ATTEMPTS) {
                // The entry has now exhausted its retries — freeze it.
                await this.storage.markFailed(entry.seq);
                result.failed++;
                this.emit();
                // Continue — a poisoned entry must not block the rest of the queue.
                continue;
            }

            // Re-put with incremented attempts, preserving enqueuedAt.
            await this.storage.remove(entry.seq);
            if (entry.kind === 'write') {
                await this.storage.putWrite({
                    inspectionId: entry.inspectionId,
                    itemId: entry.itemId,
                    field: entry.field,
                    intent: entry.intent,
                    payload: entry.payload,
                    enqueuedAt: entry.enqueuedAt,
                    attempts: newAttempts,
                    status: 'pending',
                });
            } else if (entry.kind === 'crop') {
                await this.storage.putCrop({
                    inspectionId: entry.inspectionId,
                    itemId: entry.itemId,
                    photoIndex: entry.photoIndex,
                    sectionId: entry.sectionId,
                    blob: entry.blob,
                    crop: entry.crop,
                    enqueuedAt: entry.enqueuedAt,
                    attempts: newAttempts,
                    status: 'pending',
                });
            } else {
                await this.storage.putPhoto({
                    inspectionId: entry.inspectionId,
                    itemId: entry.itemId,
                    name: entry.name,
                    blob: entry.blob,
                    enqueuedAt: entry.enqueuedAt,
                    attempts: newAttempts,
                    status: 'pending',
                    originalQuality: entry.originalQuality,
                });
            }
            this.emit();
            // Do NOT stop the replay run for active errors — continue to next entry.
        }

        return result;
    }
}
