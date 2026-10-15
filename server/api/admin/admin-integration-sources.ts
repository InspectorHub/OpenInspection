/**
 * Which source each service runs on: Built-in or the company's own account.
 *
 *   GET /integration-sources   one row per service whose choice is honoured
 *   PUT /integration-sources   record one choice
 *
 * Owner and manager only, enforced here. The company is the one on the verified
 * session. The write stores the choice and nothing else: no key is read from the
 * request or returned, and the company's keys stay where they are.
 */
import { createRoute } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createApiRouter } from '../../lib/openapi-router';
import { Errors } from '../../lib/errors';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { requireRole } from '../../lib/middleware/rbac';
import { auditFromContext } from '../../lib/audit';
import {
    IntegrationSourceChangeSchema,
    IntegrationSourceRefusedSchema,
    IntegrationSourceSavedSchema,
    IntegrationSourcesResponseSchema,
} from '../../lib/validations/integration-sources.schema';
import { loadOverviewInputs } from '../../lib/integrations/overview-data';
import { checkSourceChange, describeSwitchableSources, writeIntegrationSource } from '../../lib/integrations/source-change';
import type { HonoConfig } from '../../types/hono';

const REFUSAL_TEXT = {
    not_offered: 'That source is not available for this service here.',
    own_credentials_incomplete: 'Your own account details for this service are not complete yet.',
} as const;

const listRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/integration-sources',
    tags: ['admin'],
    summary: 'Which source each service runs on',
    middleware: [requireRole('owner', 'manager')] as const,
    responses: {
        200: { content: { 'application/json': { schema: IntegrationSourcesResponseSchema } }, description: 'One row per service' },
    },
    operationId: 'listIntegrationSources',
    description: 'Returns, for email, SMS and AI, the sources the company can choose between (Built-in, Your own), the choice it saved, the source in use, whether it works, and whether its own account details are complete. Keys are never returned, only whether they are complete.',
}, { scopes: ['admin'], tier: 'extended' }));

const saveRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/integration-sources',
    tags: ['admin'],
    summary: 'Choose Built-in or Your own for a service',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { body: { content: { 'application/json': { schema: IntegrationSourceChangeSchema } }, required: true } },
    responses: {
        200: { content: { 'application/json': { schema: IntegrationSourceSavedSchema } }, description: 'Choice saved' },
        409: { content: { 'application/json': { schema: IntegrationSourceRefusedSchema } }, description: 'The source cannot be used yet' },
    },
    operationId: 'saveIntegrationSource',
    description: 'Records whether a service (email, SMS or AI) runs on the built-in account or the company\'s own. Your own is refused until the company\'s own account details are complete, and Built-in is refused where none is offered. Saves only the choice: no key is accepted, read or changed, so switching back and forth keeps the company\'s keys.',
}, { scopes: ['admin'], tier: 'extended' }));

async function inputsFor(c: Context<HonoConfig>) {
    const tenantId = c.get('tenantId');
    if (!tenantId) throw Errors.Unauthorized('Missing tenant scope');
    const inputs = await loadOverviewInputs({
        env: c.env,
        profile: c.var.profile,
        tenantId,
        userId: c.get('user')?.sub ?? null,
        tenantSecretKeys: c.get('tenantSecretKeys') ?? [],
    });
    return { tenantId, inputs };
}

const adminIntegrationSourcesRoutes = createApiRouter()
    .openapi(listRoute, async (c) => {
        const { inputs } = await inputsFor(c);
        return c.json({ success: true as const, data: describeSwitchableSources(inputs) }, 200);
    })
    .openapi(saveRoute, async (c) => {
        const { service, source } = c.req.valid('json');
        const { tenantId, inputs } = await inputsFor(c);
        const check = checkSourceChange(inputs, service, source);
        if (!check.ok) {
            return c.json({ success: false as const, error: { code: check.error, message: REFUSAL_TEXT[check.error] } }, 409);
        }
        await writeIntegrationSource(c.env.DB, tenantId, service, source);
        auditFromContext(c, 'config.integration_source.update', 'tenant_config', {
            metadata: { service, source },
        });
        return c.json({ success: true as const, data: { service, source } }, 200);
    });

export default adminIntegrationSourcesRoutes;
