import type { Context, Next } from 'hono';
import { Errors } from '../errors';
import { deniedNeedsRole } from '../permission-denied';
import { ROLE_TIER, type Role } from '../auth/roles';
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
    // Staff is evaluated at the inspector tier. A role with no tier
    // entry matches nothing, so it fails closed.
    if (!allowed.has(userRole) && !allowed.has(ROLE_TIER[userRole])) {
      throw deniedNeedsRole(c, roles);
    }
    return next();
  };
};

/**
 * Refuse `staff` on a route that `requireRole('owner', 'manager', 'inspector')`
 * would otherwise admit through the staff role's inspector tier. Staff is an
 * office role: it books jobs through `POST /api/inspections` (which does not use
 * this guard), moves and reassigns them, but it does not delete them, publish
 * them, or use the 4-step wizard route (`POST /api/inspections/wizard`, which
 * also carries the services and the team assignment). Put this AFTER
 * `requireRole` in a route's middleware list.
 */
export const denyStaff = async (c: Context<HonoConfig>, next: Next) => {
  if (c.get('userRole') === 'staff') {
    throw deniedNeedsRole(c, ['owner', 'manager', 'inspector'], 'Office staff accounts do not create, copy or delete inspections or change their other fields');
  }
  return next();
};
