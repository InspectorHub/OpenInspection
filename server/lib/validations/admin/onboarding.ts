import { z } from '@hono/zod-openapi';

// ── Trial Sample-Data Mode (2026-05-20 spec) ───────────────────────────────
// Portal calls POST /api/admin/seed-starter-content during step 2.5 of the
// OnboardingWorkflow to populate a newly-provisioned tenant with starter
// content. Idempotent — re-runs return all-zero counts.
export const SeedStarterContentBodySchema = z.object({
    tenantId: z.string().min(1).openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe tenantId field for the OpenInspection MCP integration'),
}).openapi('SeedStarterContentBody');
