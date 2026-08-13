/**
 * Admin → Compliance → AI assurance ledger (read-only).
 *
 * WHO THE READER IS, AND WHY IT IS THE WORKSPACE ITSELF. `ai_call_provenance`
 * and `ai_content_reviews` describe a workspace's OWN content: which prompt and
 * model produced a draft, and which of its staff reviewed the result before it
 * was published. The liability that makes those rows worth keeping is the
 * inspector's professional liability, not the platform's — so the human who has
 * to produce them when asked is the same owner/manager who already answers
 * subject requests from Settings → Compliance, one section above the erasure log
 * this endpoint is deliberately shaped after.
 *
 * There is also no later reader available. Both tables are ordinary
 * tenant-scoped tables and are destroyed with the workspace by
 * `TenantPurgeService` — unlike `tenant_destruction_records`, which is excluded
 * from that sweep precisely so it can be read afterwards. If the workspace
 * cannot read these while it exists, nobody ever can.
 *
 * WHAT IS SAFE TO SHOW. Nothing here is another workspace's data and nothing
 * here is subject PII. `ai_call_provenance` stores no prompt and no completion
 * by construction (schema comment: adding such a column is a compliance change),
 * so every field is metadata about a call. `ai_content_reviews` names a STAFF
 * user of this same workspace and an artifact id the same admin can already open.
 * Both are registered as out of erasure scope for that reason.
 *
 * READ-ONLY BY CONSTRUCTION: one GET, no writes anywhere in the module it calls.
 * A reviewer who could edit the review ledger would turn evidence into a claim.
 */
import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { getDrizzle, getTenantId } from '../../lib/route-helpers';
import { readAiAssurance } from '../../lib/compliance/assurance-records';
import { AiAssuranceQuerySchema, AiAssuranceResponseSchema } from '../../lib/validations/assurance.schema';

const aiAssuranceRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/compliance/ai-assurance',
    tags: ['admin'],
    summary: 'AI assurance ledger for this workspace',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { query: AiAssuranceQuerySchema },
    responses: {
        200: {
            content: { 'application/json': { schema: AiAssuranceResponseSchema } },
            description: 'AI calls newest first, each carrying the human reviews that cite it.',
        },
    },
    operationId: 'listComplianceAiAssurance',
    description: 'Returns the tenant-scoped AI accountability record: one row per model call with the prompt version, model and credential source recorded at call time, joined to every human review citing it. Read-only, newest first, paged backwards with the returned nextBefore cursor.',
}, { scopes: ['admin'], tier: 'extended' }));

const adminAiAssuranceRoutes = createApiRouter()
    .openapi(aiAssuranceRoute, async (c) => {
        // tenantId comes from the verified JWT via the shared helper, never from
        // the query — the only inputs this route accepts are page bounds.
        const tenantId = getTenantId(c);
        const { limit, before } = c.req.valid('query');

        const page = await readAiAssurance(getDrizzle(c), {
            tenantId,
            limit,
            ...(before !== undefined ? { before } : {}),
        });

        return c.json({ success: true as const, data: page }, 200);
    });

export default adminAiAssuranceRoutes;
