import { MiddlewareHandler } from 'hono';
import { HonoConfig } from '../../types/hono';

/**
 * Middleware: block non-GET API mutations when tenant subscription is not active.
 */
/**
 * Middleware: allow everything in standalone mode.
 */
export const requireActiveSubscription: MiddlewareHandler<HonoConfig> = async (_c, next) => {
    return next();
};
