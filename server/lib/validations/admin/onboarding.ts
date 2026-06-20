import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from '../shared.schema';

// ── Trial Sample-Data Mode (2026-05-20 spec) ───────────────────────────────
// Portal calls POST /api/admin/seed-starter-content during step 2.5 of the
// OnboardingWorkflow to populate a newly-provisioned tenant with starter
// content. Idempotent — re-runs return all-zero counts.
export const SeedStarterContentBodySchema = z.object({
    tenantId: z.string().min(1).openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe tenantId field for the OpenInspection MCP integration'),
}).openapi('SeedStarterContentBody');

export const SeedStarterContentResponseSchema = createApiResponseSchema(z.object({
    inspectionTemplatesSeeded:  z.number().int().nonnegative().describe('TODO describe inspectionTemplatesSeeded field for the OpenInspection MCP integration'),
    agreementTemplatesSeeded:   z.number().int().nonnegative().describe('TODO describe agreementTemplatesSeeded field for the OpenInspection MCP integration'),
    cannedCommentsSeeded:       z.number().int().nonnegative().describe('TODO describe cannedCommentsSeeded field for the OpenInspection MCP integration'),
    eventTypesSeeded:           z.number().int().nonnegative().describe('TODO describe eventTypesSeeded field for the OpenInspection MCP integration'),
    tagsSeeded:                 z.number().int().nonnegative().describe('TODO describe tagsSeeded field for the OpenInspection MCP integration'),
    recommendationsSeeded:      z.number().int().nonnegative().describe('TODO describe recommendationsSeeded field for the OpenInspection MCP integration'),
    ratingSystemsSeeded:        z.number().int().nonnegative().describe('TODO describe ratingSystemsSeeded field for the OpenInspection MCP integration'),
    marketplaceLibrariesSeeded: z.number().int().nonnegative().describe('TODO describe marketplaceLibrariesSeeded field for the OpenInspection MCP integration'),
})).openapi('SeedStarterContentResponse');
