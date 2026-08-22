/**
 * Cursor and interval-marker storage for paged cron jobs.
 *
 * KV, not D1, and deliberately: a cursor column would need a migration in two
 * deployment modes for a value that is pure bookkeeping, and every job that
 * uses one is already idempotent — the comments each job carries say so. So the
 * worst case of KV's eventual consistency is that one batch is processed twice,
 * which those jobs already tolerate by construction. Losing a cursor entirely
 * just restarts the sweep from the beginning.
 *
 * `TENANT_CACHE` is present in BOTH wrangler configs, which is why it is the
 * store. When it is absent the helpers degrade to "no cursor" — the job then
 * processes its first batch every time, which is wrong but safe, and the
 * dispatcher logs the missing binding.
 */
export interface CursorEnv {
    TENANT_CACHE?: KVNamespace;
}

const cursorKey = (jobKey: string) => `cron:cursor:${jobKey}`;
const markerKey = (jobKey: string) => `cron:lastrun:${jobKey}`;

/** Cursors expire after a day so an abandoned sweep restarts rather than pinning. */
const CURSOR_TTL_SECONDS = 24 * 60 * 60;

/**
 * Markers outlive the longest interval any job uses by a wide margin. A marker
 * that expired early would make the job due again, which costs one extra sweep
 * — the safe direction. A marker that outlived its usefulness would make the
 * job never due, which is the failure this whole refactor exists to remove, so
 * the TTL is set from the interval by the caller rather than guessed here.
 */
const MIN_MARKER_TTL_SECONDS = 60;

export async function readCursor(env: CursorEnv, jobKey: string): Promise<string | null> {
    if (!env.TENANT_CACHE) return null;
    return (await env.TENANT_CACHE.get(cursorKey(jobKey))) ?? null;
}

export async function writeCursor(env: CursorEnv, jobKey: string, cursor: string | null): Promise<void> {
    if (!env.TENANT_CACHE) return;
    if (cursor === null) {
        await env.TENANT_CACHE.delete(cursorKey(jobKey));
        return;
    }
    await env.TENANT_CACHE.put(cursorKey(jobKey), cursor, { expirationTtl: CURSOR_TTL_SECONDS });
}

/**
 * Is this job due, for a job whose "is there work?" question has no cheap
 * answer in the database?
 *
 * Two of the thirteen jobs sweep an object store rather than a table, so there
 * is no LIMIT-1 SELECT that means "there is work". For those, due-ness is a
 * clock: they run at most once per `intervalMs`, and a sweep already in flight
 * (a stored cursor) is always due so a paged sweep is never abandoned halfway.
 *
 * This is the shape the sibling portal Worker uses for its once-a-day sweep,
 * with one property copied deliberately: the marker is written only AFTER the
 * work succeeds, so a failed sweep is retried on the next tick instead of being
 * marked done and lost until tomorrow.
 */
export async function isIntervalDue(env: CursorEnv, jobKey: string, intervalMs: number, now: number): Promise<boolean> {
    if (!env.TENANT_CACHE) return true;
    if (await readCursor(env, jobKey)) return true;
    const raw = await env.TENANT_CACHE.get(markerKey(jobKey));
    if (!raw) return true;
    const last = Number(raw);
    if (!Number.isFinite(last)) return true;
    return now - last >= intervalMs;
}

/** Record that the job completed a full pass. Call only on success. */
export async function markRan(env: CursorEnv, jobKey: string, intervalMs: number, now: number): Promise<void> {
    if (!env.TENANT_CACHE) return;
    const ttl = Math.max(MIN_MARKER_TTL_SECONDS, Math.ceil((intervalMs * 4) / 1000));
    await env.TENANT_CACHE.put(markerKey(jobKey), String(now), { expirationTtl: ttl });
}
