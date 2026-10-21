import type { Context, Env, Hono, ToSchema } from 'hono';
import type { RouteConfig, RouteConfigToEnv, RouteConfigToTypedResponse, RouteHandler } from '@hono/zod-openapi';
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

/** The `$get`-style key the library gives a method. */
type MethodKey<M extends string> = `$${Lowercase<M>}`;

/**
 * One route's endpoint, as `ToSchema` builds it. Written as the member type of a mapped type so the checker
 * resolves it only when a caller reads that member, not when the module's whole schema is folded.
 */
type EndpointOf<R extends RouteConfig, P extends string> =
    ToSchema<R['method'], P, RouteInput<R>, RouteConfigToTypedResponse<R>> extends infer S
        ? S extends Record<P, infer E> ? E extends Record<MethodKey<R['method']>, infer Ep> ? Ep : never : never
        : never;

type RouteSchema<R extends RouteConfig, Base extends string> =
    { [K in MergePath<Base, RoutePath<R['path']>>]: { [K2 in MethodKey<R['method']>]: EndpointOf<R, K> } };

type Router = ReturnType<typeof createApiRouter>;
/** Any router, whatever schema it has accumulated. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRouter = Hono<any, any, any>;

/**
 * A router mounted with `app.route(prefix, router)`. `parts` is the mounted router's own parts list (its
 * route configs and mounts), which is what its client schema is derived from.
 */
export interface Mounted<Prefix extends string, Parts extends readonly RoutePart[]> {
    readonly prefix: Prefix;
    readonly router: Router;
    readonly parts: Parts;
}

/**
 * A router mounted with `app.route(prefix, router)` that is still written as a chain (or otherwise cannot list
 * its routes): its schema is read from the router's own type, so nothing about it can drift from the tuple.
 * Use `mounted()` instead whenever the child exports its parts.
 */
export interface LegacyMounted<Prefix extends string, R extends AnyRouter> {
    readonly prefix: Prefix;
    readonly router: R;
    readonly legacy: true;
}

/** One entry of a router's parts list: a route it registers, or a router it mounts. */
export type RoutePart = RouteConfig | Mounted<string, readonly RoutePart[]> | LegacyMounted<string, AnyRouter>;

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
 * Records one `app.route(prefix, router)` of a child that has no parts list. Its client schema is the child's own.
 */
export function legacyMounted<const Prefix extends string, const R extends AnyRouter>(prefix: Prefix, router: R): LegacyMounted<Prefix, R> {
    return { prefix, router, legacy: true };
}

/** The schema type argument of a router. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SchemaOfRouter<R> = R extends Hono<any, infer S extends Schema, any> ? S : never;

/**
 * Folds the parts, left to right, the way the chain would have: a route is `Acc & RouteSchema`
 * (OpenAPIHono.openapi), a mount is `MergeSchemaPath<child, MergePath<base, prefix>> & Acc`
 * (OpenAPIHono.route).
 */
type PartsSchema<Parts extends readonly RoutePart[], Base extends string, Acc extends Schema = BlankSchema> =
    Parts extends readonly [infer Head extends RoutePart, ...infer Tail extends readonly RoutePart[]]
        ? Head extends Mounted<infer Prefix, infer Sub>
            ? PartsSchema<Tail, Base, MergeSchemaPath<PartsSchema<Sub, '/'>, MergePath<Base, Prefix>> & Acc>
            : Head extends LegacyMounted<infer Prefix, infer R>
            ? PartsSchema<Tail, Base, MergeSchemaPath<SchemaOfRouter<R>, MergePath<Base, Prefix>> & Acc>
            : Head extends RouteConfig
                ? PartsSchema<Tail, Base, Acc & RouteSchema<Head, Base>>
                : never
        : Acc;

/**
 * The router type a chained registration of `Parts` would have produced, ready
 * for `hc<ApiOf<typeof xxxRouteConfigs>>()`. Pass the parts in registration order.
 *
 * The result is the plain `Hono` class, not `OpenAPIHono`: `hc<T>` only needs the schema, and a plain
 * `Hono<E, S, B>` meets its `T extends Hono<any, any, any>` constraint by comparing type arguments, where an
 * `OpenAPIHono` (a subclass) is compared member by member, once per client in the frontend's client map.
 */
export type ApiOf<
    Parts extends readonly RoutePart[],
    E extends Env = HonoConfig,
    Base extends string = '/',
> = Hono<E, PartsSchema<Parts, Base>, Base>;
