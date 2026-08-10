import type { Context, Next } from 'hono';
import { Errors } from '../errors';
import type { Role } from '../auth/roles';
import type { HonoConfig } from '../../types/hono';

/**
 * Enforce that the JWT-derived role is one of `roles`. Variadic + typed to
 * `Role`, so removing a value from ROLES turns every stale callsite into a
 * compile error (the rename is compiler-guided) and a typo'd role cannot
 * compile.
 *
 * The `Context<HonoConfig>` annotation is load-bearing, not decoration.
 * `@hono/zod-openapi` derives an `.openapi()` handler's Env from the route's
 * `middleware: [...]` tuple (`RouteMiddlewareParams<R>['env'] & E`). Hono's
 * bare `Context` defaults its Env generic to `any`, and `any & HonoConfig` is
 * `any` — so an unannotated middleware here silently turns `c` into
 * `Context<any>` in EVERY handler that mounts it, disabling type checking of
 * `c.var.services`, `c.get(...)` and `c.env.*` across the whole API.
 */
export const requireRole = (...roles: Role[]) => {
  const allowed = new Set<string>(roles);
  return async (c: Context<HonoConfig>, next: Next) => {
    const userRole = c.get('userRole');
    if (!userRole) throw Errors.Unauthorized('No role found in context');
    if (!allowed.has(userRole)) {
      throw Errors.Forbidden(`Requires one of [${roles.join(', ')}]`);
    }
    return next();
  };
};
