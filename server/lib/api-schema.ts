import type { Context, Env, ToSchema } from 'hono';
import type { RouteConfig, RouteConfigToEnv, RouteConfigToTypedResponse, RouteHandler, OpenAPIHono } from '@hono/zod-openapi';
import type { BlankSchema, MergePath, MergeSchemaPath, Schema } from 'hono/types';
import type { HonoConfig } from '../types/hono';
import type { createApiRouter } from './openapi-router';

/**
 * Lazy typed-client schema for routers registered as standalone statements.
 *
 * Chaining `.openapi(a).openapi(b)...` makes the checker resolve an ever larger
 * `OpenAPIHono<E, S & ...>` for every link, at roughly 23k types per route. A
 * router registered as plain statements (`app.openapi(a, h); app.openapi(b, h)`)
 * keeps one constant type for `app` and is about eleven times cheaper, but it
 * no longer carries the route schema `hc<T>()` needs. This module rebuilds that
 * schema from the route configs alone, as a type alias: nothing here is
 * evaluated unless something asks for the client type.
 *
 * The result is the same schema the chained form accumulates: `.openapi()` adds
 * `ToSchema<method, MergePath<base, path>, input, RouteConfigToTypedResponse<R>>`
 * per route; the input is read back from `RouteHandler<R>`, the type the
 * library itself gives a handler for that route.
 *
 * A router that mounts other routers (`app.route('/x', child)`) lists the mount
 * among its parts, in registration order, with `mounted()`. The mount folds in
 * exactly as the library's own `route()` does: the child's schema, re-based on
 * `MergePath<base, prefix>`, intersected in front of what came before.
 */

/**
 * The routing path (`/{id}` becomes `/:id`) the library registers for a route.
 * Same rewrite as the library's own `ConvertPathType`, which it does not export;
 * reading the path back out of `RouteHandler<R>` instead widens it to `string`.
 */
type RoutePath<Path extends string> = Path extends `${infer Start}/{${infer Param}}${infer Rest}`
    ? `${Start}/:${Param}${RoutePath<Rest>}`
    : Path;

/**
 * The `Input` a handler for route `R` sees (params, query, headers, cookies, form, json), read back from the
 * context type the library gives such a handler. Env and path are spelled out rather than inferred, so nothing
 * is bound that goes unused.
 */
type RouteInput<R extends RouteConfig> =
    Parameters<RouteHandler<R>>[0] extends Context<RouteConfigToEnv<R>, RoutePath<R['path']>, infer I> ? I : never;

type RouteSchema<R extends RouteConfig, Base extends string> =
    ToSchema<R['method'], MergePath<Base, RoutePath<R['path']>>, RouteInput<R>, RouteConfigToTypedResponse<R>>;

type Router = ReturnType<typeof createApiRouter>;

/**
 * A router mounted with `app.route(prefix, router)`. `parts` is the mounted router's own parts list (its
 * route configs and mounts), which is what its client schema is derived from.
 */
export interface Mounted<Prefix extends string, Parts extends readonly RoutePart[]> {
    readonly prefix: Prefix;
    readonly router: Router;
    readonly parts: Parts;
}

/** One entry of a router's parts list: a route it registers, or a router it mounts. */
export type RoutePart = RouteConfig | Mounted<string, readonly RoutePart[]>;

/**
 * Records one `app.route(prefix, router)` in a parts list. `parts` is the mounted router's own list
 * (the `xxxRouteConfigs` / `xxxRouteParts` it exports).
 */
export function mounted<const Prefix extends string, const Parts extends readonly RoutePart[]>(
    prefix: Prefix,
    router: Router,
    parts: Parts,
): Mounted<Prefix, Parts> {
    return { prefix, router, parts };
}

/**
 * Folds the parts, left to right, the way the chain would have: a route is `Acc & RouteSchema`
 * (OpenAPIHono.openapi), a mount is `MergeSchemaPath<child, MergePath<base, prefix>> & Acc`
 * (OpenAPIHono.route).
 */
type PartsSchema<Parts extends readonly RoutePart[], Base extends string, Acc extends Schema = BlankSchema> =
    Parts extends readonly [infer Head extends RoutePart, ...infer Tail extends readonly RoutePart[]]
        ? Head extends Mounted<infer Prefix, infer Sub>
            ? PartsSchema<Tail, Base, MergeSchemaPath<PartsSchema<Sub, '/'>, MergePath<Base, Prefix>> & Acc>
            : Head extends RouteConfig
                ? PartsSchema<Tail, Base, Acc & RouteSchema<Head, Base>>
                : never
        : Acc;

/**
 * The router type a chained registration of `Parts` would have produced, ready
 * for `hc<ApiOf<typeof xxxRouteConfigs>>()`. Pass the parts in registration order.
 */
export type ApiOf<
    Parts extends readonly RoutePart[],
    E extends Env = HonoConfig,
    Base extends string = '/',
> = OpenAPIHono<E, PartsSchema<Parts, Base>, Base>;
