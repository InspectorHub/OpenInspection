import { z } from '@hono/zod-openapi';

/**
 * POST /api/integration/sso-handoff body (consumed by the integration
 * module's handoff route). Portal->core M2M handoff (guarded by
 * requireServiceBinding).
 *
 * `tenantId` is OPTIONAL:
 *  - PRESENT -> the long-standing tenant path: resolves a (tenantId, email)
 *    tenant user and mints a `{ userId, tenantId }` code.
 *  - ABSENT (Spec 3 Task 5b) -> agent handoff: portal's Google-OIDC agent-mode
 *    callback hands off just the email; the route resolves the GLOBAL agent
 *    (findGlobalAgentByEmail) and mints a `{ userId }` code with no tenantId.
 *
 * `ttlSeconds` is left unconstrained here (the handler clamps it to [5,300]
 * itself) so the existing clamp-not-reject behavior for out-of-range values
 * is preserved.
 */
export const SsoHandoffSchema = z.object({
    tenantId: z.string().min(1).optional().describe('Tenant id for the tenant-scoped handoff path — omit for a global-agent handoff.'),
    email: z.string().email().describe('Email of the tenant user (tenant path) or global agent (agent path) to mint an SSO code for.'),
    ttlSeconds: z.number().optional().describe('Requested code TTL in seconds; clamped to [5,300] server-side, default 60.'),
}).openapi('SsoHandoff');
