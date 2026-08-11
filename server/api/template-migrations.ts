import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { z } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import { requireCapability, capabilitiesFor } from '../lib/middleware/require-capability';
import { Errors, AppError } from '../lib/errors';
import { auditFromContext } from '../lib/audit';
import { withKvLock, KvLockHeldError } from '../lib/kv-lock';
import {
    MigrationParamsSchema,
    MigrationBodySchema,
} from '../lib/validations/template-migration.schema';
import type { MigrateResult } from '../services/template-migration.service';
import { withMcpMetadata } from "../lib/route-metadata-standards";

/**
 * Sprint 2 S2-6 — POST /api/templates/:oldId/migrate-to/:newId
 *
 * Re-binds inspections from oldId to newId per a strategy. Owner/admin only.
 * KV lock `mig_lock:{oldId}` (5-minute TTL) prevents concurrent migrations.
 */
const migrateRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{oldId}/migrate-to/{newId}',
    tags: ["templates"],
    summary: 'Migrate inspections from old template to new template',
    description: "Auto-generated placeholder for createTemplateMigrationMigrateTo (POST /{oldId}/migrate-to/{newId}, templates domain). TODO: replace with a real description sourced from the handler.",
    // ONE ROUTE, TWO VERBS. `migrate` bumps the NEW template's version (an
    // edit) and, when `deleteOldTemplate` is set, deletes the old one.
    // `requireCapability` expresses exactly one capability, so templateEdit is
    // the route gate and templateDelete is checked in the handler on the
    // branch that actually deletes. Same split as
    // `server/api/inspections/pay-splits.ts`, and the reason `capabilitiesFor`
    // is exported alongside `requireCapability`. See #307.
    middleware: [requireRole('owner', 'manager'), requireCapability('templateEdit')] as const,
    request: {
        params: MigrationParamsSchema.describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'application/json': {
                    schema: MigrationBodySchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'),
                        data: z.object({
                            dryRun:             z.boolean().optional().describe('TODO describe dryRun field for the OpenInspection MCP integration'),
                            migrated:           z.number().int().describe('TODO describe migrated field for the OpenInspection MCP integration'),
                            strategy:           z.string().describe('TODO describe strategy field for the OpenInspection MCP integration'),
                            preview:            z.unknown().describe('TODO describe preview field for the OpenInspection MCP integration'),
                            oldTemplateDeleted: z.boolean().describe('TODO describe oldTemplateDeleted field for the OpenInspection MCP integration'),
                        }).describe('TODO describe data field for the OpenInspection MCP integration'),
                    }),
                },
            },
            description: 'Migrated',
        },
        403: { description: "Missing the 'templateEdit' capability, or 'templateDelete' when deleteOldTemplate is set" },
        409: { description: 'Concurrent migration in progress' },
        422: { description: 'Strategy refused — schema incompatible' },
    },
    operationId: "createTemplateMigrationMigrateTo"
}, { scopes: ['write'], tier: 'extended', capability: 'templateEdit' }));

const templateMigrationRoutes = createApiRouter()
    .openapi(migrateRoute, async (c) => {
        const { oldId, newId } = c.req.valid('param');
        const body = c.req.valid('json');
        const userId = (c.get('user')?.sub as string) || 'system';

        if (oldId === newId) {
            throw Errors.BadRequest('oldId and newId must differ');
        }

        if (body.deleteOldTemplate) {
            // A delete reached through a migration is still a delete. The route
            // gate can only express one capability, so the conditional half is
            // checked here -- the same split `pay-splits.ts` uses. Checked
            // BEFORE the KV lock is taken: a refusal should not park a
            // five-minute lock on a template the caller may not touch.
            const caps = await capabilitiesFor(c);
            if (!caps.templateDelete) throw Errors.Forbidden("Requires the 'templateDelete' capability");
        }

        const lockKey = `mig_lock:${oldId}`;
        try {
            const result = await withKvLock<MigrateResult>(c.env.TENANT_CACHE, lockKey, 300, () =>
                c.var.services.templateMigration.migrate(
                    oldId,
                    newId,
                    body.strategy,
                    userId,
                    {
                        dryRun: body.dryRun ?? false,
                        deleteOldTemplate: body.deleteOldTemplate ?? false,
                    },
                ),
            );

            // Audit only on real (non-dry-run) migrations.
            if (!result.dryRun) {
                auditFromContext(c, 'inspection.template_upgraded', 'template', {
                    entityId: newId,
                    metadata: {
                        oldTemplateId: oldId,
                        strategy:      body.strategy,
                        migrated:      result.migrated,
                        oldTemplateDeleted: result.oldTemplateDeleted,
                    },
                });
            }

            return c.json({ success: true, data: result }, 200);
        } catch (err) {
            if (err instanceof KvLockHeldError) {
                throw Errors.Conflict('Another migration is already running for this template. Try again in a moment.');
            }
            if (err instanceof AppError) throw err;
            throw err;
        }
    });

export type TemplateMigrationsApi = typeof templateMigrationRoutes;

export default templateMigrationRoutes;
