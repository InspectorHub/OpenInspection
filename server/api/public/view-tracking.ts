/**
 * GDPR Art. 21 — the report recipient's right to object to view measurement.
 *
 * The delivery-confirmation counter (`report_views`, OI #271) runs on
 * legitimate interests, so the right to object comes with it. This is the
 * instrument: a per-recipient suppression marker that stops the counter while
 * the report link keeps working.
 *
 * THREE THINGS THIS ROUTE DELIBERATELY DOES NOT DO, each of them a rejected
 * answer rather than an oversight (docs/compliance/report-view-lia.md,
 * condition 9 and its amendment history):
 *
 *  1. **It does not revoke the token.** Answering an objection about being
 *     MEASURED by withdrawing ACCESS is a larger action than the one asked
 *     for, and it penalises exercising the right — the recipient would lose
 *     their inspection report in order to stop being counted.
 *  2. **It does not clear counters already recorded.** Art. 21 is not Art. 17.
 *     Future collection stops; what is already recorded is governed by the
 *     retention rules and by a separate erasure request. Reaching for the
 *     `report_views` erasure rule from here would silently merge two requests
 *     a data subject is entitled to make independently.
 *  3. **It does not gate on role kind.** `resolveClientActor` accepts only
 *     client/co_client, and the LIA's own analysis (§3.1) says the recipients
 *     with the WEAKEST expectation are the agents and one-off shares — exactly
 *     the population a client-only control would lock out. Any live recipient
 *     of this inspection may object, over either portal entry path.
 *
 * WHY `?token=` IS ACCEPTED, not just the portal session. The preferences
 * surface is `__Host-portal_session`-gated; a report link is `?token=`-gated,
 * and the recipient who only ever clicks the emailed link has no session. A
 * session-only control would leave the right unreachable for most of the people
 * who hold it, which is not a right. `resolvePortalRecipient` handles both.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { createApiResponseSchema } from '../../lib/validations/shared.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { getDrizzle } from '../../lib/route-helpers';
import { resolvePortalRecipient } from '../../lib/portal-client-actor';
import { readViewTrackingObjection, writeViewTrackingObjection } from '../../lib/report-views';
import {
    ViewTrackingObjectionBodySchema,
    ViewTrackingStateSchema,
} from '../../lib/validations/view-tracking.schema';

const params = z.object({ id: z.string().describe('Inspection id the report link belongs to.') });
const query = z.object({
    token: z.string().optional().describe('Persistent per-recipient portal access token (or present the __Host-portal_session cookie instead).'),
});

const unauthorized = {
    success: false as const,
    error: { code: 'UNAUTHORIZED', message: 'Not authorized for this inspection' },
};

const getRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/inspections/{id}/view-tracking',
    tags: ['public'],
    summary: 'Whether this recipient has objected to report-view measurement',
    request: { params, query },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(ViewTrackingStateSchema) } }, description: 'Current objection state' },
        401: { description: 'No live portal grant for this inspection' },
    },
    operationId: 'getPublicViewTracking',
    description: 'Reads the recipient\'s GDPR Art. 21 objection to report-view measurement. Gated by the recipient\'s own portal token (?token=) or the unified-portal session cookie.',
}, { scopes: [], tier: 'extended' }));

const postRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/inspections/{id}/view-tracking-objection',
    tags: ['public'],
    summary: 'Object to (or withdraw an objection to) report-view measurement',
    request: {
        params,
        query,
        body: { content: { 'application/json': { schema: ViewTrackingObjectionBodySchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(ViewTrackingStateSchema) } }, description: 'Stored objection state' },
        401: { description: 'No live portal grant for this inspection' },
    },
    operationId: 'setPublicViewTrackingObjection',
    description: 'Records or withdraws the recipient\'s GDPR Art. 21 objection to report-view measurement. The report link is unaffected in both directions, and counters already recorded are not cleared (Art. 21 is not Art. 17).',
}, { scopes: [], tier: 'extended' }));

const state = (at: number | null) => ({
    success: true as const,
    data: { objected: at != null, objectedAt: at == null ? null : new Date(at).toISOString() },
});

const viewTrackingRoutes = createApiRouter()
    .openapi(getRoute, async (c) => {
        const { id } = c.req.valid('param');
        const who = await resolvePortalRecipient(c, id);
        if (!who) return c.json(unauthorized, 401);
        const at = await readViewTrackingObjection(getDrizzle(c), who.tenantId, who.accessTokenId);
        return c.json(state(at), 200);
    })
    .openapi(postRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { objected } = c.req.valid('json');
        const who = await resolvePortalRecipient(c, id);
        if (!who) return c.json(unauthorized, 401);
        // Writes `view_tracking_objected_at` and nothing else — see the header.
        const at = await writeViewTrackingObjection(
            getDrizzle(c), who.tenantId, who.accessTokenId, objected,
        );
        return c.json(state(at), 200);
    });

// Mounted inside `server/api/public-report.ts`, so `PublicReportApi` already
// carries the RPC shape; a second exported router type would be dead surface.
export default viewTrackingRoutes;
