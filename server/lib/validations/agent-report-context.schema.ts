import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

/**
 * Spec 3 Task 3 — response shape for POST /api/agent/report-context, the
 * read-only probe the portal report-landing BFF loader
 * (app/routes/public/portal-inspection.tsx) uses to decide which CTA to
 * render below the report: "Go to my workspace" (magic-login) vs "Create
 * your free agent account" (signup). The request body reuses
 * MagicLoginRequestSchema's shape (tenant/inspectionId/token) — see
 * server/api/agent/report-context.ts.
 *
 * `kind: null` covers BOTH an invalid/expired/mismatched token and a token
 * that never had a role at all — this is a context probe, not an auth
 * check, so a bad token still replies 200 rather than 401 (the report
 * itself renders regardless; the CTA below it just doesn't show).
 */
export const AgentReportContextResponseSchema = createApiResponseSchema(
    z.object({
        kind: z.enum(['agent', 'client', 'other']).nullable()
            .describe('The report token recipient\'s role kind, or null when the token is invalid/expired/mismatched.'),
        recipientEmail: z.string().optional()
            .describe('Present only when kind is "agent" — the token holder is inherently that recipient, so echoing it back is not enumeration.'),
        hasAccount: z.boolean().optional()
            .describe('Present only when kind is "agent" — whether a global agent account already exists for recipientEmail.'),
    }),
).openapi('AgentReportContextResponse');
