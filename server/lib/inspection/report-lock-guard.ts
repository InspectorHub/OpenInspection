/**
 * Refuses a write to report CONTENT while the report is published (409 `REPORT_PUBLISHED`).
 *
 * The same route list as `editReports` (`isReportAuthoringPath`): what is report content for the capability is
 * report content for the lock. One list, so a route cannot be guarded by one and forgotten by the other, and
 * `tests/unit/inspections/report-lock-conformance.spec.ts` fails when a mutating route is neither in the list nor
 * explicitly allowed with a reason.
 *
 * Runs AFTER the capability guard, so a person who may not write reports still gets their 403 rather than a hint
 * about the report's state. Reads (GET/HEAD/OPTIONS) are never affected. The rule itself, and why a report being
 * edited again is not locked, are in `./report-lock`.
 *
 * Two writers are not HTTP routes under `/api/inspections/:id/` and check the same rule themselves: the offline
 * package import (`/api/client/import`, which names its inspections in the body) and the collaborative document
 * socket (`collab/ws`, which cannot answer a 409). See `docs/develop/native-clients.md`.
 */
import type { Context, MiddlewareHandler } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { getDrizzle } from '../route-helpers';
import { assertReportContentWritable } from './report-lock';
import { isReportAuthoringPath } from './report-authoring-guard';
import type { HonoConfig } from '../../types/hono';

const INSPECTION_PATH = /^\/api\/inspections\/([^/]+)\//;
const REPORT_NARRATIVE_PATH = /\/reports\/([^/]+)\/narrative$/;

export const publishedReportLockGuard: MiddlewareHandler<HonoConfig> = Object.assign(
    async (c: Context<HonoConfig>, next: () => Promise<void>) => {
        const method = c.req.method;
        if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
        const inspectionId = INSPECTION_PATH.exec(c.req.path)?.[1];
        const tenantId = c.get('tenantId');
        if (!inspectionId || !tenantId || !isReportAuthoringPath(c.req.path)) return next();
        // A narrative is written to ONE named report; every other route addresses the inspection's primary report.
        const reportId = REPORT_NARRATIVE_PATH.exec(c.req.path)?.[1];
        await assertReportContentWritable(getDrizzle(c), tenantId, inspectionId, reportId);
        return next();
    },
    { publishedReportLockGuard: true as const },
);

/** Mount the lock right after the capability guard, ahead of the routers (the spec pins the order). */
export function registerPublishedReportLockGuard(app: OpenAPIHono<HonoConfig>): void {
    app.use('/api/inspections/*', publishedReportLockGuard);
}
