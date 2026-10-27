/**
 * POST /api/public/csp-report: the receiver for browser Content-Security-Policy
 * violation reports (the `report-uri` of the page policies).
 *
 * Unauthenticated on purpose: browsers send these without credentials, from any
 * page, signed in or not, so it lives under the `/api/public/` prefix the JWT
 * middleware skips. The surrounding middleware chain still runs (tenant
 * resolution may read the tenant cache, and a suspended company's tenant guard can
 * refuse a non-GET before the handler is reached); a browser that gets anything
 * but 204 simply drops the report. THE HANDLER itself does no database, KV, R2,
 * email or queue work. It reads at most 16 KiB (and nothing at all once the
 * minute's log budget is spent), logs at most a bounded number of lines per
 * minute per isolate, and always answers 204 with an empty body, malformed or
 * not, so there is nothing to probe and nothing reflected. The shape of the log
 * line is in `lib/csp-report.ts`.
 *
 * No request schema is declared: the body arrives as `application/csp-report`,
 * `application/reports+json` or `application/json` depending on the browser, and
 * the handler reads it itself, capped and leniently. Mounted from
 * `server/api/public-share.ts`.
 */
import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { logger } from '../lib/logger';
import {
    CSP_REPORT_MAX_BYTES,
    admitCspReport,
    cspBudgetExhausted,
    isAcceptedReportType,
    parseCspReports,
    readCapped,
} from '../lib/csp-report';

const cspReportRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/csp-report',
    tags: ['public'],
    summary: 'Receive a browser Content-Security-Policy violation report',
    responses: {
        204: { description: 'Always, whatever was sent; the body is never echoed' },
    },
    operationId: 'createPublicCspReport',
    description: 'Receiver for the report-uri of the page Content-Security-Policy-Report-Only header. Sent by the browser itself, without credentials. Accepts application/csp-report, application/reports+json or application/json up to 16 KiB; a larger or malformed body is dropped. Each accepted report becomes one structured log line holding only low-cardinality fields (directive, blocked origin, page path with ids removed); nothing is stored. Always answers 204 with an empty body.',
}, { scopes: [], tier: 'excluded' }));

const app = createApiRouter();
app.openapi(cspReportRoute, async (c) => {
    // Budget first: once this minute's log budget is spent nothing below can log, so do not read or parse.
    if (!cspBudgetExhausted(Date.now()) && isAcceptedReportType(c.req.header('content-type'))) {
        const text = await readCapped(c.req.raw, CSP_REPORT_MAX_BYTES);
        if (text) {
            let body: unknown;
            try {
                body = JSON.parse(text);
            } catch {
                body = undefined;
            }
            for (const fields of parseCspReports(body, c.req.query('p'))) {
                if (!admitCspReport(Date.now(), fields)) break;
                logger.info('csp_report', { ...fields });
            }
        }
    }
    return c.body(null, 204);
});

export default app;
