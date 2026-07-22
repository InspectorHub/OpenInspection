import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

/**
 * Agent unified link (Spec 3, Task 2) — request body for minting a single-use
 * magic-login code from a live agent report-link token. `tenant` is carried
 * for consistency/telemetry only — the AUTHORITATIVE tenant for every
 * security decision is `grant.tenantId`, returned by `resolvePortalAccess()`
 * from the verified `token`, never this field. See
 * server/services/agent/magic-login.service.ts.
 */
export const MagicLoginRequestSchema = z.object({
    tenant: z.string().min(1).describe('Tenant slug or id the report link is scoped to (consistency/telemetry only — the token is the security boundary).'),
    inspectionId: z.string().min(1).describe('Inspection id the presented report token must grant access to.'),
    token: z.string().min(1).describe('The durable agent report token from the link.'),
}).openapi('AgentMagicLoginRequest');

export const MagicLoginRequestResponseSchema = createApiResponseSchema(
    z.object({
        sent: z.boolean().describe('Always true — a single-use sign-in link is EMAILED to the agent\'s account inbox (never returned here). Identical response and timing whether or not an agent account exists for the report link recipient (anti-oracle — the link is never returned to the caller, closing the report-link → session takeover vector).'),
    }),
).openapi('AgentMagicLoginRequestResponse');
