import { z } from '@hono/zod-openapi';

// ─── Account export + soft delete ───────────────────────────────────────────
// Surface the calling identity's owned data (user record, agent-tenant links,
// inspections they ran) as a JSON blob the customer can download for GDPR /
// CCPA portability. Soft-delete marks the user row's `deleted_at` after the
// caller retypes their email to confirm.

export const AccountExportResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        exportedAt: z.string(),
        identity: z.record(z.string(), z.any()),
        memberships: z.array(z.record(z.string(), z.any())),
        inspections: z.array(z.record(z.string(), z.any())),
    }),
}).openapi('AccountExportResponse');

export const AccountDeleteRequestSchema = z.object({
    confirmEmail: z.string().email().describe('User must retype their email to confirm the soft-delete.'),
}).openapi('AccountDeleteRequest');

export const AccountDeleteResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        deletedAt: z.string(),
        identityId: z.string(),
    }),
}).openapi('AccountDeleteResponse');
