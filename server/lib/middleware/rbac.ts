import { Context, Next } from 'hono';
import { Errors } from '../errors';
import type { Role } from '../auth/roles';

/**
 * Enforce that the JWT-derived role is one of `roles`. Variadic + typed to
 * `Role`, so removing a value from ROLES turns every stale callsite into a
 * compile error (the rename is compiler-guided) and a typo'd role cannot
 * compile.
 */
export const requireRole = (...roles: Role[]) => {
  const allowed = new Set<string>(roles);
  return async (c: Context, next: Next) => {
    const userRole = c.get('userRole');
    if (!userRole) throw Errors.Unauthorized('No role found in context');
    if (!allowed.has(userRole)) {
      throw Errors.Forbidden(`Requires one of [${roles.join(', ')}]`);
    }
    return next();
  };
};
