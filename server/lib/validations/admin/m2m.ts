import { z } from '@hono/zod-openapi';

/**
 * Validation schema for tenant status updates (M2M).
 */
export const TenantStatusSchema = z.object({
    id: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe id field for the OpenInspection MCP integration'),
    slug: z.string().min(1).openapi({ example: 'acme' }).describe('TODO describe slug field for the OpenInspection MCP integration'),
    status: z.string().min(1).openapi({ example: 'active' }).describe('TODO describe status field for the OpenInspection MCP integration'),
    tier: z.string().optional().openapi({ example: 'pro' }).describe('TODO describe tier field for the OpenInspection MCP integration'),
    name: z.string().optional().openapi({ example: 'Acme Corp' }).describe('TODO describe name field for the OpenInspection MCP integration'),
    deploymentMode: z.enum(['shared', 'silo']).default('shared').openapi({ example: 'shared' }).describe('TODO describe deploymentMode field for the OpenInspection MCP integration'),
    setupVerificationCode: z.string().optional().openapi({ example: 'XYZ12345' }).describe('TODO describe setupVerificationCode field for the OpenInspection MCP integration'),
    adminEmail: z.string().email().optional().openapi({ example: 'admin@acme.com' }).describe('TODO describe adminEmail field for the OpenInspection MCP integration'),
    adminPasswordHash: z.string().optional().openapi({ example: '...sha256...' }).describe('TODO describe adminPasswordHash field for the OpenInspection MCP integration'),
}).openapi('TenantStatus');

/**
 * Validation schema for silo DB ID updates (M2M).
 */
export const SiloUpdateSchema = z.object({
    tenantId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    siloDbId: z.string().min(1).openapi({ example: 'db_12345' }).describe('TODO describe siloDbId field for the OpenInspection MCP integration'),
}).openapi('SiloUpdate');

/**
 * Validation schema for Stripe Connect updates (M2M).
 */
export const StripeConnectSchema = z.object({
    slug: z.string().min(1).openapi({ example: 'acme' }).describe('TODO describe slug field for the OpenInspection MCP integration'),
    stripeConnectAccountId: z.string().min(1).openapi({ example: 'acct_12345' }).describe('TODO describe stripeConnectAccountId field for the OpenInspection MCP integration'),
}).openapi('StripeConnect');

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
