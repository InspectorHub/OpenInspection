/**
 * Server loader/action argument builder for co-located route specs.
 *
 * React Router v8 hands a route's server `loader`/`action` FIVE things —
 * `request`, `url`, `params`, `pattern`, `context` (`ServerDataFunctionArgs` in
 * `react-router/lib/types/route-data`). Specs written before `url` and
 * `pattern` were added call the route with the other three, which vitest does
 * not mind (it strips types) and which the generated `Route.LoaderArgs` type
 * rejects with TS2345 "missing the following properties: url, pattern".
 *
 * Hand-adding the two at every call site would leave the same drift waiting for
 * the next field RR adds, so the shape lives here once. `url` is derived from
 * the request rather than accepted, because a spec that could disagree with
 * `request.url` is a spec that can assert on a URL the route never saw.
 *
 * Params and context stay GENERIC and are inferred from the call, so each spec
 * still type-checks against its own route's `Info["params"]` and its own
 * context stub — a widened `Record<string, string>` here would silently accept
 * a param name the route does not declare.
 */
export function routeArgs<Params, Context>(
    request: Request,
    opts: { params: Params; context: Context; pattern?: string },
): { request: Request; url: URL; params: Params; pattern: string; context: Context } {
    const url = new URL(request.url);
    return {
        request,
        url,
        params: opts.params,
        // The route's path pattern (`/inspections/:id`), used by RR only as a
        // logging/tracing identifier. No spec here asserts on it, so the
        // concrete pathname is a truthful default.
        pattern: opts.pattern ?? url.pathname,
        context: opts.context,
    };
}
