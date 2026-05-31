import { logger } from './logger';

/**
 * Sprint 2 S2-6 — KV-backed advisory lock helper.
 *
 * D1 does not yet support row-level locks; we use a TTL'd KV key to prevent
 * two admins from concurrently triggering the migrate-to endpoint on the same
 * template. The lock auto-expires so a worker crash mid-migration cannot wedge
 * the resource forever.
 *
 * Pattern: callers use `withKvLock(kv, key, ttl, fn)` — if the key is already
 * present, throws a tagged Error so the route handler can return 409.
 */
export class KvLockHeldError extends Error {
    constructor(public key: string) {
        super(`Lock '${key}' is already held by another caller`);
        this.name = 'KvLockHeldError';
    }
}

export async function withKvLock<T>(
    kv: KVNamespace,
    key: string,
    ttlSeconds: number,
    fn: () => Promise<T>,
): Promise<T> {
    const existing = await kv.get(key);
    if (existing) {
        throw new KvLockHeldError(key);
    }
    // Best-effort claim. Race window is tiny (sub-millisecond) and the fallback
    // path inside the migration is idempotent enough that double-execution is
    // recoverable. For a stronger primitive we would need DO + storage tx.
    await kv.put(key, String(Date.now()), { expirationTtl: ttlSeconds });
    try {
        return await fn();
    } finally {
        try {
            await kv.delete(key);
        } catch (err) {
            logger.warn('[kv-lock] delete failed (will expire on TTL)', {
                key, message: err instanceof Error ? err.message : String(err),
            });
        }
    }
}
