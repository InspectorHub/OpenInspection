import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { z } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
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
    middleware: [requireRole('owner', 'manager')] as const,
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
        409: { description: 'Concurrent migration in progress' },
        422: { description: 'Strategy refused — schema incompatible' },
    },
    operationId: "createTemplateMigrationMigrateTo"
}, { scopes: ['write'], tier: 'extended' }));

export const templateMigrationRoutes = createApiRouter()
    .openapi(migrateRoute, async (c) => {
        const { oldId, newId } = c.req.valid('param');
        const body = c.req.valid('json');
        const userId = (c.get('user')?.sub as string) || 'system';

        if (oldId === newId) {
            throw Errors.BadRequest('oldId and newId must differ');
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
