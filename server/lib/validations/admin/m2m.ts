import { z } from '@hono/zod-openapi';
import { AUTHORITY_BASES } from '../../auth/authority-basis';

/**
 * Body schema for PATCH /api/platform/tenants/:slug (M2M).
 * slug comes from URL param, not body.
 */
export const TenantStatusBodySchema = z.object({
    id: z.string().trim().min(1).optional().describe('TODO describe id field for the OpenInspection MCP integration'),
    status: z.string().min(1).describe('TODO describe status field for the OpenInspection MCP integration'),
    tier: z.string().optional().describe('TODO describe tier field for the OpenInspection MCP integration'),
    name: z.string().optional().describe('TODO describe name field for the OpenInspection MCP integration'),
    deploymentMode: z.enum(['shared', 'silo']).optional().describe('TODO describe deploymentMode field for the OpenInspection MCP integration'),
    setupVerificationCode: z.string().optional().describe('TODO describe setupVerificationCode field for the OpenInspection MCP integration'),
    maxUsers: z.number().int().positive().optional().describe('TODO describe maxUsers field for the OpenInspection MCP integration'),
    adminEmail: z.string().email().optional().describe('TODO describe adminEmail field for the OpenInspection MCP integration'),
    adminPasswordHash: z.string().optional().describe('TODO describe adminPasswordHash field for the OpenInspection MCP integration'),
    /**
     * What the admin accepted, captured portal-side.
     *
     * This endpoint is the RPC FALLBACK for the same provisioning sync the
     * command queue carries, so the field mirrors `cmdAcceptanceSchema` — a
     * body shape the queue accepts and this endpoint rejects would mean the
     * invariant survives only while the queue is healthy. Optional for the same
     * reason it is optional there: a status/tier/seat sync creates nothing and
     * carries no acceptance, and the requirement is enforced in
     * `applyAdminCredential`, which knows whether an account is about to exist.
     */
    acceptance: z.object({
        actorIdentityRef: z.string().optional(),
        authorityBasis: z.enum(AUTHORITY_BASES),
        documents: z.array(z.object({
            doc: z.string().min(1),
            version: z.string().min(1),
            contentHash: z.string().min(1),
            acceptedAt: z.number(),
        })).min(1),
    }).optional().describe('Acceptance block captured by the portal for an account this call would create.'),
});

// StripeConnectBodySchema removed with the dead M2M stripe-connect endpoint
// (A-21 batch 3 adjudication).
