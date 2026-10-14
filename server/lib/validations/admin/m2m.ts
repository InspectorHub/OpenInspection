import { z } from '@hono/zod-openapi';
import { AUTHORITY_BASES } from '../../auth/authority-basis';

/**
 * Body schema for PATCH /api/platform/tenants/:slug (M2M).
 * slug comes from URL param, not body.
 */
export const TenantStatusBodySchema = z.object({
    id: z.string().trim().min(1).optional().describe('Stable tenant id the synced company is keyed on. When omitted the company is matched by its slug from the URL instead; a match on id also lets the stored slug be corrected.'),
    status: z.string().min(1).describe('Lifecycle status to store for the company; a company that does not exist yet is created with it, and an existing one is moved to it.'),
    tier: z.string().optional().describe('Plan tier label to store for the company; when omitted the stored tier is kept (a new company starts on the lowest tier).'),
    name: z.string().optional().describe('Company name used to initialise the company display name. It only fills a name that is still empty and never overwrites one the company has set in its own settings; renames travel by a separate command.'),
    deploymentMode: z.enum(['shared', 'silo']).optional().describe('Isolation mode recorded for the company, either on the shared deployment or a dedicated one. Used by the standalone provisioning provider (new companies default to a dedicated deployment); the portal provider ignores it.'),
    setupVerificationCode: z.string().optional().describe('Accepted by the schema but not read by the tenant update handlers in this codebase; sending it has no effect.'),
    maxUsers: z.number().int().positive().optional().describe('Cap on the number of user seats in the company; invitations are checked against it. When omitted the stored cap is unchanged.'),
    adminEmail: z.string().email().optional().describe('Email address of the administrator account to create or whose credential to rotate. Takes effect only together with adminPasswordHash.'),
    adminPasswordHash: z.string().optional().describe('Already-hashed password for the administrator account. The engine stores the hash as given and never receives a plaintext password; takes effect only together with adminEmail.'),
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
