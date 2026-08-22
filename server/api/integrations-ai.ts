import { createRoute, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { createApiRouter } from '../lib/openapi-router';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { requireRole } from '../lib/middleware/rbac';
import { AiConfigBodySchema, AiConnectionTestBodySchema, AiConnectionTestResultSchema } from '../lib/validations/integrations.schema';
import { testAiConnection } from '../lib/ai/connection-test';
import { keyForProbe, readAiConfig, saveAiConfig } from '../lib/ai/config-write';
import { loadTenantEmailConfig } from '../lib/email/build-email-service';
import { recordIntegrationTest } from '../lib/integration-test-results';

/**
 * The AI provider surface: probe an endpoint, and store the one to use.
 *
 * Split out of `integrations.ts` when that file crossed the 400-line gate, and
 * split HERE because these three routes share a subject the rest of that file
 * does not: a destination the WORKSPACE chooses. Everything else in it probes a
 * vendor the deployment picked.
 *
 * The route this replaced probed a deployment environment variable against a
 * fixed vendor endpoint, so it could report success for a configuration no
 * tenant call ever used. Nothing here reads a deployment default.
 */

/** One sentence, and it names the input to fix rather than the mechanism. */
const m_ai_key_missing = 'Enter an API key, or save one first — there is no key to probe with.';

const aiTestRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/test',
    tags: ['integrations'],
    summary: 'Probe a submitted AI endpoint, model and key',
    middleware: [requireRole('owner', 'manager')],
    request: {
        body: { content: { 'application/json': { schema: AiConnectionTestBodySchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: AiConnectionTestResultSchema }).openapi('AiConnectionTestResponse') } }, description: 'Probe ran; `data.ok` says whether the configuration works' },
    },
    operationId: 'testAiConnection',
    description: [
        'Sends a one-token chat completion to the SUBMITTED base URL, model and key —',
        'not to a stored credential and not to a deployment default. That is the whole',
        'point: after the destination became something a workspace chooses, a probe of',
        'anything else would go green while every real call failed. Always 200; the',
        'outcome is in the body, with `field` naming which input to blame. The',
        "provider's own response body is never returned or logged.",
    ].join(' '),
}, { scopes: ['admin'], tier: 'extended' }));

const aiConfigRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/config',
    tags: ['integrations'],
    summary: "Store this workspace's AI endpoint, model and switch",
    middleware: [requireRole('owner', 'manager')],
    request: {
        body: { content: { 'application/json': { schema: AiConfigBodySchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ ok: z.literal(true) }) }) } }, description: 'Stored' },
    },
    operationId: 'saveAiConfig',
    description: [
        'Blank values mean UNSET and are stored as null, which is how a workspace',
        'clears a destination. Turning the switch off keeps the endpoint and model —',
        'the control says so, and this is what makes that true. Every save bumps a',
        'version so anything holding a resolved endpoint can tell it is stale.',
    ].join(' '),
}, { scopes: ['admin'], tier: 'extended' }));

const aiConfigGetRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/config',
    tags: ['integrations'],
    summary: "Read this workspace's AI endpoint, model and switch",
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: AiConfigBodySchema }) } }, description: 'ok' },
    },
    operationId: 'getAiConfig',
    description: 'Never returns a credential — the key lives in encrypted secrets and is surfaced separately.',
}, { scopes: ['read'], tier: 'extended' }));

const integrationsAiRoutes = createApiRouter()
    .openapi(aiTestRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const uid = c.get('user')?.sub ?? null;
        const body = c.req.valid('json');
        // A blank key means the one this workspace already stored. Resolving it
        // here rather than in testAiConnection keeps that function honest: it
        // probes exactly what it is handed, and the fallback is visible at the
        // one place that knows which workspace is asking.
        const stored = (await loadTenantEmailConfig(c.env, tenantId)).dbSecrets.geminiApiKey ?? null;
        const chosen = keyForProbe(body.apiKey, stored);
        if ('refuse' in chosen) {
            const result = { ok: false as const, field: 'apiKey' as const, message: m_ai_key_missing };
            await recordIntegrationTest(drizzle(c.env.DB), { tenantId, testedByUserId: uid, target: 'gemini', ok: false, detail: result.message });
            return c.json({ success: true as const, data: result }, 200);
        }
        const result = await testAiConnection({ ...body, apiKey: chosen.key });
        // The stored target key is still 'gemini'. It is a LEGACY LABEL for
        // "the AI integration", kept because existing rows carry it and the
        // settings grid keys off it; it no longer names a vendor, and the
        // engine no longer has one. Renaming it is its own pass across the
        // schema enum, the service and the settings UI.
        //
        // `detail` carries the FIELD that failed — never the message shown to
        // the workspace, and never the provider's own words.
        await recordIntegrationTest(drizzle(c.env.DB), {
            tenantId, testedByUserId: uid, target: 'gemini', ok: result.ok,
            detail: result.ok
                ? 'AI endpoint accepted a test completion.'
                : `AI endpoint test failed on: ${result.field}.`,
        });
        return c.json({ success: true as const, data: result }, 200);
    })
    .openapi(aiConfigRoute, async (c) => {
        const body = c.req.valid('json');
        await saveAiConfig(drizzle(c.env.DB), c.get('tenantId'), body);
        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    })
    .openapi(aiConfigGetRoute, async (c) => {
        const data = await readAiConfig(drizzle(c.env.DB), c.get('tenantId'));
        return c.json({ success: true as const, data }, 200);
    })
;

export type IntegrationsAiApi = typeof integrationsAiRoutes;
export default integrationsAiRoutes;
