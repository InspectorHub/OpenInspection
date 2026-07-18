import { z } from '@hono/zod-openapi';

/**
 * Sprint 2 S2-6 — schemas for the inspection migrate-to-template endpoint.
 *
 * Strategies:
 *   - 'preserve_unknown' (default) — items removed from the new template are
 *     parked under `data._legacy` so the inspector can review or discard later.
 *   - 'refuse_incompatible' — the service throws 422 if any inspection would
 *     lose item-level data; surfaces the breaking diff so the caller can show
 *     a confirmation modal.
 *   - 'force' — drops removed-item data without ceremony. Caller-confirmed.
 */
const MigrationStrategySchema = z.enum([
    'preserve_unknown',
    'refuse_incompatible',
    'force',
]);

export const MigrationParamsSchema = z.object({
    oldId: z.string().uuid({ message: 'oldId must be a UUID' }).describe('TODO describe oldId field for the OpenInspection MCP integration'),
    newId: z.string().uuid({ message: 'newId must be a UUID' }).describe('TODO describe newId field for the OpenInspection MCP integration'),
});

export const MigrationBodySchema = z.object({
    strategy: MigrationStrategySchema.default('preserve_unknown').describe('TODO describe strategy field for the OpenInspection MCP integration'),
    dryRun:   z.boolean().optional().describe('TODO describe dryRun field for the OpenInspection MCP integration'),
    /**
     * If true and migration removes the last reference to oldId, the old
     * template is deleted. Defaults to false so callers must opt in.
     */
    deleteOldTemplate: z.boolean().optional().describe('TODO describe deleteOldTemplate field for the OpenInspection MCP integration'),
});

export type MigrationStrategy = z.infer<typeof MigrationStrategySchema>;
