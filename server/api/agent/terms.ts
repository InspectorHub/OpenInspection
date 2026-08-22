import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { Errors } from '../../lib/errors';
import { getDrizzle } from '../../lib/route-helpers';
import { recordAgentTermsAcceptance } from '../../services/agent/terms-acceptance';

/**
 * How a signed-in agent accepts the agent terms.
 *
 * Signup collects the acceptance for an account being born. This is the same act
 * for an account that already exists — someone who signed up before there was a
 * document, or who is holding an acceptance of words that have since been
 * replaced. Without it the gate in `server/lib/middleware/agent-terms-gate.ts`
 * would be a wall rather than a door, so this endpoint is on that gate's short
 * exemption list and this file and that one have to be read together.
 *
 * The TEXT is not served here. `GET /api/agent-signup/terms` already returns the
 * version, the hash and the body in force, and it is public because the signup
 * page has to render it before anyone has an account. A second read endpoint
 * would be a second thing to keep in step with the registry, for no new fact.
 */

const AcceptBodySchema = z
    .object({
        accepted: z.literal(true).describe(
            'The tick, and only the tick. The version and content hash recorded are read '
            + 'server-side from the document in force — a client-supplied pair would be the '
            + 'client asserting what it read, which is what the record exists to replace.',
        ),
        shownContentHash: z.string().regex(/^[0-9a-f]{64}$/).describe(
            'SHA-256 hex of the agent-terms body this page actually rendered. Used ONLY to '
            + 'refuse a page left open across a publish — never as the recorded evidence.',
        ),
    })
    .openapi('AgentTermsAcceptBody');

const AcceptResponseSchema = z
    .object({
        success: z.literal(true),
        data: z.object({
            version: z.string().describe('The version now recorded on the account.'),
        }),
    })
    .openapi('AgentTermsAcceptResponse');

/**
 * `shownContentHash` is REQUIRED here, where signup takes it as optional.
 *
 * That is not an inconsistency to tidy away. Signup's form can be reached by a
 * caller that never rendered the body (an API client creating an account), and
 * the server still records the right hash. This endpoint exists only because an
 * agent was stopped and shown the text, so a submission that cannot say what it
 * displayed did not display anything, and the acceptance would assert a
 * presentation that never happened.
 */
const acceptRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/accept-terms',
    tags: ['agents'],
    summary: 'Record that the signed-in agent accepts the agent terms in force',
    description:
        'Records the agent terms acceptance on the signed-in agent account. The version and '
        + 'content hash stored are read server-side from the document in force; the caller '
        + 'supplies only the tick and the hash of the body it rendered, and a body that no '
        + 'longer matches the text in force is refused so a stale page cannot record an '
        + 'acceptance of a version its signer was never shown. Requires an agent session — '
        + 'this is the one authenticated agent route the agent-terms gate lets through, '
        + 'because it is the way out of that gate.',
    request: {
        body: { content: { 'application/json': { schema: AcceptBodySchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: AcceptResponseSchema } },
            description: 'Acceptance recorded',
        },
        400: { description: 'Nothing published to accept, or the page is stale' },
        401: { description: 'Not an agent session' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'acceptAgentTerms',
}, { scopes: [], tier: 'excluded' }));

export const agentTermsRoutes = createApiRouter()
    .openapi(acceptRoute, async (c) => {
        // Checked HERE and not inherited from anything. The gate exempts this
        // path, so the usual reason an unauthenticated caller does not reach an
        // agent route is switched off for it — and the JWT middleware does not
        // reject a request with no token, it simply sets nothing. Without this
        // line an anonymous POST would reach a write.
        const agentUserId = c.get('agentUserId');
        if (!agentUserId) {
            throw Errors.Unauthorized('Sign in as an agent to accept the agent terms');
        }

        const body = c.req.valid('json');

        const recorded = await recordAgentTermsAcceptance(getDrizzle(c) as never, {
            userId: agentUserId,
            shownContentHash: body.shownContentHash,
            ip: c.req.header('cf-connecting-ip'),
            country: c.req.header('cf-ipcountry'),
        });

        return c.json({ success: true as const, data: { version: recorded.version } }, 200);
    });

export type AgentTermsApi = typeof agentTermsRoutes;
