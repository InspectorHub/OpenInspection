import { Context, Next } from 'hono';
import { Errors } from '../errors';

// Middleware to enforce specific roles based on the decoded JWT
export const requireRole = (allowedRoles: string[]) => {
    return async (c: Context, next: Next) => {
        const userRole = c.get('userRole'); // Populated by authMiddleware earlier

        if (!userRole) {
            throw Errors.Unauthorized('No role found in context');
        }

        if (!allowedRoles.includes(userRole)) {
            throw Errors.Forbidden(`Requires one of [${allowedRoles.join(', ')}]`);
        }

        return next();
    };
};
