import type { MiddlewareHandler } from 'hono';
import { logger } from '../logger';
import { isPageRenderCall } from '../request-scope';

/**
 * Global request logger: one "Request processed" line per API request.
 *
 * A page render fans out about a dozen in-process API calls through the worker's
 * self-binding (`isPageRenderCall`: only `workers/app.ts` marks that env, and
 * external traffic is handed the plain env, so a client cannot fake it). Those
 * calls would each write their own line and bury the single `page_timing` line
 * that describes the page, so they log only when they fail with a 5xx; a loader
 * 4xx (401/403) is therefore not logged per call. External requests and offline
 * import replays (in-process, but real writes) are always logged.
 */
export const requestLog: MiddlewareHandler = async (c, next) => {
    const start = Date.now();
    await next();
    if (isPageRenderCall(c.env) && c.res.status < 500) return;
    const duration = Date.now() - start;
    logger.info('Request processed', {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        duration: `${duration}ms`,
        tenantId: c.get('tenantId'), // Might be unset but that's okay
    });
};
