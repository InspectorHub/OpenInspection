/**
 * `editReports`: who may write report content.
 *
 * Report content is what an inspector produces on site: results, photos and
 * video, units, compliance and statutory inputs, cost items and the narrative
 * sections. Reading it, publishing it and sending it are different acts and are
 * not governed here.
 *
 * ONE path-scoped middleware, registered ahead of the routers, rather than a
 * `requireCapability` on each route. A per-route guard is a thing a new route
 * has to remember to wear; this one is listed by path, and
 * `tests/unit/inspections/report-authoring-guard.spec.ts` fails when a mutating
 * route under an inspection is neither covered here nor explicitly classified
 * as not report content.
 *
 * Reads (GET/HEAD/OPTIONS) are never affected, so a user without the capability
 * can still open a report to publish or send it.
 */
import type { Context, MiddlewareHandler } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { Errors } from '../errors';
import { ROLE } from '../auth/roles';
import { capabilitiesFor } from '../middleware/require-capability';
import type { HonoConfig } from '../../types/hono';

/**
 * Route patterns that write report content. `:name` matches one path segment and
 * a trailing `*` matches the rest. They are anchored to `/api/inspections/:id/`
 * apart from the offline package import, which carries the same writes in bulk.
 */
const AUTHORING_SUFFIXES = [
    'results', 'results/*',
    'template-snapshot', 'template/upgrade', 'switch-rating-system',
    'units', 'units/*', 'unit-mode',
    'media/*', 'upload', 'cover',
    'items/*',
    'collab/ticket', 'collab/followup', 'collab/import', 'collab/restore', 'collab/restructure', 'collab/snapshots',
    'compliance/*', 'statutory-details', 'statutory-inputs', 'statutory-inputs/*', 'statutory-form/*',
    'cost-items', 'cost-items/*',
    'pca-narrative', 'reports/*/narrative',
    'report-gate', 'report-gate/*', 'report-translation', 'report-translation/*',
] as const;

/** Whole paths outside `/api/inspections/:id/` that write report content. */
const AUTHORING_PATHS = ['/api/client/import'] as const;

function toRegExp(pattern: string): RegExp {
    const source = pattern
        .split('/')
        .map((seg) => (seg === '*' ? '.*' : seg.startsWith(':') ? '[^/]+' : seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&')))
        .join('/');
    return new RegExp(`^${source}$`);
}

const MATCHERS: readonly RegExp[] = [
    ...AUTHORING_SUFFIXES.map((s) => toRegExp(`/api/inspections/:id/${s}`)),
    ...AUTHORING_PATHS.map((p) => toRegExp(p)),
];

/**
 * Whether a route pattern or concrete path writes report content (when called
 * with a mutating method). Route patterns in Hono syntax (`:id`) and concrete
 * paths are both accepted: a `:name` segment is just another non-empty segment.
 */
export function isReportAuthoringPath(path: string): boolean {
    const normal = path.replace(/^\/api\/inspections\/:inspectionId\//, '/api/inspections/:id/');
    return MATCHERS.some((re) => re.test(normal));
}

/** Whether the acting user holds `editReports`. */
export async function mayEditReports(c: Context<HonoConfig>): Promise<boolean> {
    // The owner's capability is pinned on, so the overrides read is skipped.
    if (c.get('userRole') === ROLE.OWNER) return true;
    return (await capabilitiesFor(c)).editReports;
}

/** Throws 403 unless the acting user holds `editReports`. */
export async function assertMayEditReports(c: Context<HonoConfig>): Promise<void> {
    if (!(await mayEditReports(c))) throw Errors.Forbidden("Requires the 'editReports' capability");
}

/**
 * Middleware: refuses a mutating request on a report-authoring path unless the
 * caller holds `editReports`. Anonymous requests pass through (the default-deny
 * rule in the JWT middleware has already decided them) and so does everything
 * that is not a write to an authoring path, without a database read.
 */
export const reportAuthoringGuard: MiddlewareHandler<HonoConfig> = Object.assign(
    async (c: Context<HonoConfig>, next: () => Promise<void>) => {
        const method = c.req.method;
        if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
        if (!c.get('userRole') || !isReportAuthoringPath(c.req.path)) return next();
        await assertMayEditReports(c);
        return next();
    },
    { reportAuthoringGuard: true as const },
);

/**
 * Mount the guard. Path-scoped, so it is not part of the global middleware
 * chain, and it must be called before the routers are mounted so it runs ahead
 * of every route it covers (the spec pins the order).
 */
export function registerReportAuthoringGuard(app: OpenAPIHono<HonoConfig>): void {
    app.use('/api/inspections/*', reportAuthoringGuard);
    app.use('/api/client/*', reportAuthoringGuard);
}
