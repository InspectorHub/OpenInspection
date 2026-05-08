import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import type { HonoConfig } from '../types/hono';
import { Errors, AppError } from '../lib/errors';
import { auditFromContext } from '../lib/audit';
import { withKvLock, KvLockHeldError } from '../lib/kv-lock';
import {
    MigrationParamsSchema,
    MigrationBodySchema,
} from '../lib/validations/template-migration.schema';
import type { MigrateResult } from '../services/template-migration.service';

const templateMigrationRoutes = new OpenAPIHono<HonoConfig>();

/**
 * Sprint 2 S2-6 — POST /api/templates/:oldId/migrate-to/:newId
 *
 * Re-binds inspections from oldId to newId per a strategy. Owner/admin only.
 * KV lock `mig_lock:{oldId}` (5-minute TTL) prevents concurrent migrations.
 */
templateMigrationRoutes.openapi(
    createRoute({
        method: 'post',
        path: '/{oldId}/migrate-to/{newId}',
        tags: ['Templates'],
        summary: 'Migrate inspections from old template to new template',
        description:
            'Service-layer migrates results.data per the chosen strategy. ' +
            'Throws 422 with a diff payload under refuse_incompatible when any ' +
            'inspection would lose data. KV lock prevents concurrent runs on the same template.',
        middleware: [requireRole(['owner', 'admin'])] as const,
        request: {
            params: MigrationParamsSchema,
            body: {
                content: {
                    'application/json': {
                        schema: MigrationBodySchema,
                    },
                },
            },
        },
        responses: {
            200: {
                content: {
                    'application/json': {
                        schema: z.object({
                            success: z.boolean(),
                            data: z.object({
                                dryRun:             z.boolean().optional(),
                                migrated:           z.number().int(),
                                strategy:           z.string(),
                                preview:            z.unknown(),
                                oldTemplateDeleted: z.boolean(),
                            }),
                        }),
                    },
                },
                description: 'Migrated',
            },
            409: { description: 'Concurrent migration in progress' },
            422: { description: 'Strategy refused — schema incompatible' },
        },
    }),
    async (c) => {
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
    },
);

export default templateMigrationRoutes;
