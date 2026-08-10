/**
 * A route guard must not erase the type of every handler that mounts it.
 *
 * WHAT WENT WRONG. `requireRole` was declared `(c: Context, next: Next)`.
 * Hono's bare `Context` defaults its Env generic to `any`, and
 * `@hono/zod-openapi` derives an `.openapi()` handler's Env FROM the route's
 * `middleware:` tuple — `RouteMiddlewareParams<R>['env'] & E`. `any & HonoConfig`
 * is `any`, so on all 332 routes carrying `requireRole` (and 22 carrying
 * `requireCapability`) the handler's `c` was `Context<any>`: `c.var.services.*`,
 * `c.get(...)` and `c.env.*` were all unchecked. `void c.var.services.ai
 * .noSuchMethodAtAll()` compiled clean.
 *
 * WHY THIS FILE EXISTS RATHER THAN A COMMENT. The failure produced ZERO signal.
 * Not a type error, not an eslint warning, not a failing test — the compiler
 * simply stopped asking questions, and everything downstream stayed green for
 * however long it had been live. Nothing in the gate ladder can notice a check
 * that quietly stopped happening; only an assertion ABOUT the type can.
 *
 * Restoring the plain `Context` annotation on either guard turns these
 * assertions red.
 */
import { describe, it, expectTypeOf } from 'vitest';
import { createRoute, z, type RouteConfigToEnv } from '@hono/zod-openapi';
import type { Context, Next } from 'hono';

import { requireRole } from '../../../server/lib/middleware/rbac';
import { requireCapability } from '../../../server/lib/middleware/require-capability';
import type { HonoConfig, AppServices } from '../../../server/types/hono';

/** The Env a middleware advertises to the routes that mount it. */
type EnvOf<M> = M extends (c: Context<infer E, infer _P, infer _I>, next: Next) => unknown ? E : never;

/** Exactly how the repo composes a guarded route — `as const` included. */
const guardedRoute = createRoute({
    method: 'get',
    path: '/things',
    middleware: [requireRole('owner')] as const,
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({}) } } } },
});

const doubleGuardedRoute = createRoute({
    method: 'post',
    path: '/things',
    middleware: [requireRole('owner'), requireCapability('publish')] as const,
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({}) } } } },
});

/**
 * The CONTROL. A middleware annotated the broken way, kept here deliberately so
 * the assertions below cannot pass vacuously: if `.toBeAny()` ever stopped
 * detecting `any`, or if zod-openapi stopped deriving Env from `middleware:`
 * at all, this one would go red and say so.
 */
const untypedGuard = () => async (_c: Context, next: Next) => next();
const brokenRoute = createRoute({
    method: 'get',
    path: '/broken',
    middleware: [untypedGuard()] as const,
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({}) } } } },
});

describe('route middleware must carry a concrete Env', () => {
    it('detects the collapse at all (control — this SHOULD be any)', () => {
        expectTypeOf<EnvOf<ReturnType<typeof untypedGuard>>>().toBeAny();
        expectTypeOf<RouteConfigToEnv<typeof brokenRoute>>().toBeAny();
    });

    it('requireRole advertises HonoConfig, not any', () => {
        expectTypeOf<EnvOf<ReturnType<typeof requireRole>>>().not.toBeAny();
        expectTypeOf<EnvOf<ReturnType<typeof requireRole>>>().toEqualTypeOf<HonoConfig>();
    });

    it('requireCapability advertises HonoConfig, not any', () => {
        expectTypeOf<EnvOf<ReturnType<typeof requireCapability>>>().not.toBeAny();
        expectTypeOf<EnvOf<ReturnType<typeof requireCapability>>>().toEqualTypeOf<HonoConfig>();
    });

    it('a guarded route still gives its handler a typed context', () => {
        // This is the property that actually matters — the two above are the
        // mechanism, this is the consequence.
        expectTypeOf<RouteConfigToEnv<typeof guardedRoute>>().not.toBeAny();
        expectTypeOf<RouteConfigToEnv<typeof guardedRoute>['Variables']['services']>()
            .toEqualTypeOf<AppServices>();
    });

    it('stacking two guards does not reintroduce it', () => {
        // zod-openapi reads the LAST entry of the tuple, so a typed guard in
        // front of an untyped one would not save the handler.
        expectTypeOf<RouteConfigToEnv<typeof doubleGuardedRoute>>().not.toBeAny();
        expectTypeOf<RouteConfigToEnv<typeof doubleGuardedRoute>['Variables']['services']>()
            .toEqualTypeOf<AppServices>();
    });
});
