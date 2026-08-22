import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { Errors } from '../../lib/errors';
import { getDrizzle } from '../../lib/route-helpers';
import { recordAgentTermsAcceptance, agentTermsHistory } from '../../services/agent/terms-acceptance';

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
 * The text IN FORCE is not served here. `GET /api/agent-signup/terms` already
 * returns the version, the hash and the body in force, and it is public because
 * the signup page has to render it before anyone has an account. A second read
 * endpoint would be a second thing to keep in step with the registry, for no new
 * fact.
 *
 * `GET /terms/history` below is a different question and therefore a different
 * endpoint: not "what is in force" but "what did THIS agent accept, and when".
 * Its answer is per-account, so it can never be public, and the bodies it
 * returns are the ARCHIVED ones — the text each acceptance actually named, not
 * whatever is current.
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

const HistoryRowSchema = z
    .object({
        version: z.string().describe('The version string the signer was shown.'),
        contentHash: z.string().describe(
            'SHA-256 hex of the body that was on screen. The version says WHICH document; '
            + 'this says WHAT it said.',
        ),
        acceptedAt: z.number().int().describe('Unix milliseconds — the real event time.'),
        bodyAvailable: z.boolean().describe(
            'Whether the words themselves can still be produced. False when the operator has '
            + 'removed the version this acceptance names.',
        ),
        body: z.string().nullable().describe(
            'The ARCHIVED body of the version accepted, or null when it is not available. '
            + 'Never the text in force today — substituting it would show a signer something '
            + 'they never agreed to.',
        ),
    })
    .openapi('AgentTermsAcceptanceRecord');

const HistoryResponseSchema = z
    .object({ success: z.literal(true), data: z.array(HistoryRowSchema) })
    .openapi('AgentTermsHistoryResponse');

/**
 * The agent's own acceptance record.
 *
 * Takes no input at all — no query parameter, no path parameter, no body. The
 * account is the one in the session and there is nothing for a caller to say
 * about it, so there is nothing to get wrong: an endpoint that accepted a user
 * id would be one bad authorization check away from answering for somebody else.
 *
 * NOT on the agent-terms gate's exemption list, unlike `/accept-terms`. That
 * list exists for the ways OUT of the gate, and reading history is not one of
 * them; an agent who owes an acceptance is sent to accept it first, which is the
 * ordinary behaviour and needs no entry here.
 */
const historyRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/terms/history',
    tags: ['agents'],
    summary: "Every agent-terms acceptance on the signed-in agent's account",
    description:
        "Returns the signed-in agent's own agent-terms acceptances, newest first, each with "
        + 'the version, the content hash of the body that was shown, when it was accepted, and '
        + 'that body where it is still archived. Scoped to the session and nothing else — the '
        + 'endpoint takes no account identifier, because the only account it can answer for is '
        + 'the one holding the session.',
    responses: {
        200: {
            content: { 'application/json': { schema: HistoryResponseSchema } },
            description: "The agent's acceptances, newest first",
        },
        401: { description: 'Not an agent session' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'listAgentTermsHistory',
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
    })
    .openapi(historyRoute, async (c) => {
        // Same check, same reason as above, and stated rather than shared: the
        // JWT middleware does not reject a token-less request, it simply sets
        // nothing, so an anonymous GET reaches this handler.
        const agentUserId = c.get('agentUserId');
        if (!agentUserId) {
            throw Errors.Unauthorized('Sign in as an agent to read your acceptance history');
        }

        const data = await agentTermsHistory(getDrizzle(c) as never, agentUserId);
        return c.json({ success: true as const, data }, 200);
    });

export type AgentTermsApi = typeof agentTermsRoutes;
