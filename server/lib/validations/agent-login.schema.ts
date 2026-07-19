import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

/**
 * Spec 3 Task 5 — core `/agent-login` dual-mode front door. See
 * server/api/agent/login.ts for the security invariants (global-agent-only
 * password auth, anti-oracle 401, anti-enumeration link path).
 */
export const AgentLoginSchema = z.object({
    email: z.string().email().describe('Global agent account email.'),
    password: z.string().min(1).describe('Account password.'),
}).openapi('AgentLoginBody');

export const AgentLoginLinkSchema = z.object({
    email: z.string().email().describe('Global agent account email — the response is { sent: true } whether or not an account exists for it (anti-enumeration).'),
}).openapi('AgentLoginLinkBody');

export const AgentLoginResponseSchema = createApiResponseSchema(
    z.object({ ok: z.literal(true).describe('Agent session cookie set — the caller redirects to /agent-dashboard.') }),
).openapi('AgentLoginResponse');

export const AgentLoginLinkResponseSchema = createApiResponseSchema(
    z.object({ sent: z.literal(true).describe('Always true — payload and timing are identical whether or not the email has an agent account; the actual email send is deferred to waitUntil.') }),
).openapi('AgentLoginLinkResponse');
