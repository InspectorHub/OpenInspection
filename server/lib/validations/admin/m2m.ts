import { z } from '@hono/zod-openapi';

/**
 * Body schema for PATCH /api/integration/tenants/:slug (M2M).
 * slug comes from URL param, not body.
 */
export const TenantStatusBodySchema = z.object({
    id: z.string().uuid().optional().describe('TODO describe id field for the OpenInspection MCP integration'),
    status: z.string().min(1).describe('TODO describe status field for the OpenInspection MCP integration'),
    tier: z.string().optional().describe('TODO describe tier field for the OpenInspection MCP integration'),
    name: z.string().optional().describe('TODO describe name field for the OpenInspection MCP integration'),
    deploymentMode: z.enum(['shared', 'silo']).optional().describe('TODO describe deploymentMode field for the OpenInspection MCP integration'),
    setupVerificationCode: z.string().optional().describe('TODO describe setupVerificationCode field for the OpenInspection MCP integration'),
    maxUsers: z.number().int().positive().optional().describe('TODO describe maxUsers field for the OpenInspection MCP integration'),
    adminEmail: z.string().email().optional().describe('TODO describe adminEmail field for the OpenInspection MCP integration'),
    adminPasswordHash: z.string().optional().describe('TODO describe adminPasswordHash field for the OpenInspection MCP integration'),
});

// StripeConnectBodySchema removed with the dead M2M stripe-connect endpoint
// (A-21 batch 3 adjudication).
