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
const lastFlush = new Map<string, number>();

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
