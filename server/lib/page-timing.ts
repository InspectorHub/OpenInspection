/**
 * Per-route page timing: one aggregatable `page_timing` log line per sampled HTML
 * page response, plus a `Server-Timing` header on every HTML page response.
 *
 * Why: the per-request "Request processed" line carries its duration as a string
 * ("183ms"), which cannot be aggregated, and the platform's own wall-time record
 * lives apart from the path. This line puts a numeric wall time and a route
 * PATTERN on one record.
 *
 * `wall_ms` is time-to-HEADERS, not time-to-last-byte. The HTML body is a stream:
 * the clock stops when the Response object is ready to be returned and the body
 * keeps rendering afterwards. Measuring to the last byte would mean wrapping or
 * reading the body, which buffers or delays the stream. In Workers, `Date.now()`
 * only advances at I/O boundaries, so this is wall time and says nothing about
 * CPU time.
 *
 * Every field is a number or a low-cardinality string. Nothing here may carry an
 * id, slug, email, token, query string, cookie value, IP or user agent.
 *
 * Entry-graph rule (workers/app.ts): this module imports only `react-router`
 * (already a top-level import of the entry) and the logger (which imports
 * nothing). It must never import the server build or the API graph; the route
 * table is read only once the renderer has itself loaded the build.
 */
import { matchRoutes, type RouteObject } from 'react-router';
import { logger } from './logger';

/** A page slower than this (time-to-headers) is always logged. */
export const PAGE_TIMING_SLOW_MS = 1500;

/**
 * Of the remaining pages, every Nth page this isolate serves is logged. The
 * decision is a modulo of a per-isolate counter: deterministic and free. Pages
 * with status >= 500, slower than PAGE_TIMING_SLOW_MS, and the isolate's first
 * page are always logged, so they are over-represented. Only lines with
 * `sample: "n"` are an unbiased 1-in-N subset of page traffic.
 */
export const PAGE_TIMING_SAMPLE_EVERY = 5;

/** Presence of this cookie is the only thing `authed` reads; its value is never parsed or verified. */
export const PAGE_TIMING_SESSION_COOKIE = '__Host-inspector_token';
const SESSION_COOKIE_PRESENT = new RegExp(`(?:^|;\\s*)${PAGE_TIMING_SESSION_COOKIE}=`);

export type SampleReason = 'error' | 'slow' | 'cold' | 'n';

// Page-scoped, per isolate: only HTML page responses count, so API calls, probes,
// health checks and redirects cannot shift the sampling cadence or make the first
// PAGE look warm. 1 means "the first page this isolate served".
let pagesServed = 0;

/** Why this page should be logged, or null to log nothing. */
export function sampleReason(input: { status: number; wallMs: number; pageN: number }): SampleReason | null {
    if (input.status >= 500) return 'error';
    if (input.wallMs > PAGE_TIMING_SLOW_MS) return 'slow';
    if (input.pageN === 1) return 'cold';
    if (input.pageN % PAGE_TIMING_SAMPLE_EVERY === 0) return 'n';
    return null;
}

interface ServerRouteEntry {
    id: string;
    parentId?: string | undefined;
    path?: string | undefined;
    index?: boolean | undefined;
}
export type ServerRoutes = Record<string, ServerRouteEntry | undefined>;

/**
 * Build `pathname -> route pattern` from the server build's route table, e.g.
 * `/inspections/0b1c/edit` -> `/inspections/:id/edit`. A path no route claims is
 * the constant "unmatched", so cardinality stays bounded.
 */
export function createRoutePatternResolver(routes: ServerRoutes): (pathname: string) => string {
    const byParent = new Map<string | undefined, ServerRouteEntry[]>();
    for (const r of Object.values(routes)) {
        if (!r) continue;
        const list = byParent.get(r.parentId) ?? [];
        list.push(r);
        byParent.set(r.parentId, list);
    }
    const toObjects = (parentId: string | undefined): RouteObject[] =>
        (byParent.get(parentId) ?? []).map((r) => {
            const children = toObjects(r.id);
            const base = { id: r.id, path: r.path };
            return r.index
                ? ({ ...base, index: true } as RouteObject)
                : ({ ...base, children: children.length ? children : undefined } as RouteObject);
        });
    const tree = toObjects(undefined);

    return (pathname: string): string => {
        const matches = matchRoutes(tree, pathname);
        if (!matches) return 'unmatched';
        const parts = matches
            .map((m) => m.route.path ?? '')
            .map((p) => p.replace(/^\/+|\/+$/g, ''))
            .filter(Boolean);
        return '/' + parts.join('/');
    };
}

/**
 * Wraps the loader the request handler uses for the server build so the route
 * table becomes readable ONCE THE RENDERER HAS LOADED IT. The tracker never
 * calls the loader itself: `getRoutes()` is a plain read that answers undefined
 * until the renderer's own `load()` has resolved. The instrument therefore cannot
 * cause a module load that would not otherwise happen.
 */
export function createServerBuildTracker<B extends { routes: object }>(loader: () => Promise<B>): {
    load: () => Promise<B>;
    getRoutes: () => ServerRoutes | undefined;
} {
    let routes: ServerRoutes | undefined;
    return {
        load: async () => {
            const build = await loader();
            routes = build.routes as ServerRoutes;
            return build;
        },
        getRoutes: () => routes,
    };
}

interface PageTimingFields {
    kind: 'page';
    route: string;
    status: number;
    wall_ms: number;
    cold: 0 | 1;
    req_n: number;
    authed: 0 | 1;
    sample: SampleReason;
    inproc_calls?: number;
}

export interface FinishPageInput {
    request: Request;
    res: Response;
    /** `Date.now()` taken when the page render began. */
    startedAt: number;
    /** Number of in-process API calls this render made so far. Omit to leave `inproc_calls` out. */
    inprocCalls?: () => number;
    /** The route table if the renderer has already loaded the server build, else undefined. Must not load anything. */
    getRoutes: () => ServerRoutes | undefined;
    /** Extra headers to set on the returned response, so one new Response serves every wrapper. */
    extraHeaders?: Record<string, string> | undefined;
}

// Keyed by the route table, so the pattern tree is built once per isolate.
const resolvers = new WeakMap<object, (pathname: string) => string>();

function resolveRoute(getRoutes: () => ServerRoutes | undefined, pathname: string): string {
    try {
        const routes = getRoutes();
        if (!routes) return 'pending';
        let resolve = resolvers.get(routes);
        if (!resolve) {
            resolve = createRoutePatternResolver(routes);
            resolvers.set(routes, resolve);
        }
        return resolve(pathname);
    } catch {
        // Route resolution is best-effort; the timing is still worth logging.
        return 'unknown';
    }
}

/** An HTML document that is a page, not a redirect or an empty answer. */
function isPageResponse(res: Response): boolean {
    if (res.status === 204 || res.status === 304 || (res.status >= 300 && res.status < 400)) return false;
    return (res.headers.get('Content-Type') ?? '').includes('text/html');
}

/**
 * Decorate an HTML page response with `Server-Timing` (and `extraHeaders`) and,
 * when sampled, write the `page_timing` line. Anything that is not an HTML page
 * (data, redirects, 204/304) is returned as the original object and is not
 * counted.
 *
 * Headers only: the body is handed to the new Response as-is, never read,
 * cloned or buffered, so streaming is unaffected. The input response is not
 * mutated; headers are copied (Set-Cookie entries included).
 */
export function finishPage(input: FinishPageInput): Response {
    const { request, res } = input;
    if (!isPageResponse(res)) return res;

    const wallMs = Math.max(0, Date.now() - input.startedAt);
    const headers = new Headers(res.headers);
    headers.append('Server-Timing', `app;dur=${wallMs}`);
    if (input.extraHeaders) for (const [k, v] of Object.entries(input.extraHeaders)) headers.set(k, v);
    const out = new Response(res.body, { status: res.status, statusText: res.statusText, headers });

    pagesServed += 1;
    const pageN = pagesServed;
    const sample = sampleReason({ status: res.status, wallMs, pageN });
    if (sample) {
        const fields: PageTimingFields = {
            kind: 'page',
            route: resolveRoute(input.getRoutes, new URL(request.url).pathname),
            status: res.status,
            wall_ms: wallMs,
            cold: pageN === 1 ? 1 : 0,
            req_n: pageN,
            authed: SESSION_COOKIE_PRESENT.test(request.headers.get('Cookie') ?? '') ? 1 : 0,
            sample,
        };
        if (input.inprocCalls) fields.inproc_calls = input.inprocCalls();
        logger.info('page_timing', fields);
    }
    return out;
}
