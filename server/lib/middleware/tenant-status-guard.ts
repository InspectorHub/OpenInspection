import type { MiddlewareHandler } from 'hono';
import type { HonoConfig } from '../../types/hono';
import { Errors } from '../errors';

const SUSPEND_EXEMPT_PREFIXES = [
    '/api/auth/',
    '/api/platform/',
    '/status',
    '/sso',
];

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const enforceTenantActive: MiddlewareHandler<HonoConfig> = async (c, next) => {
    const tenantStatus = c.get('tenantStatus');
    if (!tenantStatus || tenantStatus !== 'suspended') {
        return next();
    }
    if (READ_ONLY_METHODS.has(c.req.method)) {
        return next();
    }
    const path = c.req.path;
    for (const prefix of SUSPEND_EXEMPT_PREFIXES) {
        if (path.startsWith(prefix) || path === prefix) {
            return next();
        }
    }
    throw Errors.TenantSuspended();
};
