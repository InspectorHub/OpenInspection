/**
 * Design System 0520 subsystem B phase 1 task 1.2 — debounced
 * users.last_active_at updater.
 *
 * Runs AFTER the request handler so the write never blocks the response.
 * Per-userId debounce (30 s) is kept in a module-scoped Map; each worker
 * isolate has its own copy. That's good enough — even if 10 isolates each
 * write once per 30 s for the same user, we end up with at most 10 D1
 * writes/min/user, which is well under any quota.
 *
 * Reads c.var.services.user (the DI proxy provides a per-request
 * UserService) and uses c.executionCtx.waitUntil so the write outlives the
 * response stream.
 */
import type { MiddlewareHandler } from 'hono';
import { logger } from '../logger';

const DEBOUNCE_MS = 30_000;

/**
 * Above this many tracked users, sweep before adding another.
 *
 * The map is module-scoped, so it lives as long as the isolate and grew by one
 * entry per distinct user forever — nothing ever removed anything. Small per
 * entry, unbounded in aggregate, and worst on exactly the deployment that can
 * least afford it: a shared saas isolate serving many workspaces.
 *
 * The number only has to be far above the users one isolate sees inside a
 * 30-second window, because that is the only population whose entries still
 * carry information.
 */
export const MAX_TRACKED_USERS = 10_000;

const lastFlush = new Map<string, number>();

/**
 * Drop entries whose debounce has already expired, and if that is not enough,
 * drop everything.
 *
 * An entry older than DEBOUNCE_MS carries NO information: the next request for
 * that user passes the debounce whether the entry is there or not. So the sweep
 * is free in behaviour terms. The clear() fallback is not quite free — it lets
 * a few users flush one extra time — and that is already the trade this file
 * accepts above, where ten isolates each writing once per 30s per user is
 * called comfortably within quota.
 */
function sweep(now: number): void {
    for (const [id, ts] of lastFlush) {
        if (now - ts >= DEBOUNCE_MS) lastFlush.delete(id);
    }
    // `>=`, not `>`: this runs while about to ADD an entry, so leaving exactly
    // MAX in place would put the map one over as soon as the caller sets.
    if (lastFlush.size >= MAX_TRACKED_USERS) lastFlush.clear();
}

interface CtxUser { sub?: string; id?: string }

export const touchLastActiveMiddleware: MiddlewareHandler = async (c, next) => {
    await next();

    // Auth middleware sets `user` on the context for /api/* routes — JWT
    // subject (= users.id) lives in `user.sub`. When the request is
    // anonymous (login, public booking, etc.) we skip silently.
    const user = c.get('user') as CtxUser | undefined;
    const userId = user?.sub ?? user?.id;
    if (!userId) return;

    const now = Date.now();
    const last = lastFlush.get(userId) ?? 0;
    if (now - last < DEBOUNCE_MS) return;
    // Sweep before growing, and only when about to grow — a user already in the
    // map is a replacement, not a new entry, so it cannot push us over.
    if (!lastFlush.has(userId) && lastFlush.size >= MAX_TRACKED_USERS) sweep(now);
    lastFlush.set(userId, now);

    // Fire-and-forget — never await. waitUntil keeps the worker alive until
    // the write commits even after the response is sent.
    c.executionCtx.waitUntil(
        c.var.services.user
            .touchLastActive(userId, Math.floor(now / 1000))
            .catch((err: unknown) => {
                logger.error('touch-last-active flush failed', { userId }, err instanceof Error ? err : undefined);
            }),
    );
};
