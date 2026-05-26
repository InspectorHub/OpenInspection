import { z } from '@hono/zod-openapi';

/**
 * Booking #7 Sprint A — per-inspector booking slug.
 *
 * Format rules (also enforced client-side and server-side):
 *  - 3..32 characters
 *  - lowercase letters, digits, single hyphens between alphanum runs
 *  - no leading or trailing hyphen, no consecutive hyphens
 *  - no underscores, dots, or whitespace
 *
 * Per-tenant uniqueness is enforced by the partial unique index
 * `idx_users_slug_per_tenant` defined in migration 0052_inspector_slug.sql.
 */
export const SlugSchema = z
    .string()
    .min(3, 'Slug must be at least 3 characters')
    .max(32, 'Slug must be at most 32 characters')
    .regex(
        /^[a-z0-9]+(-[a-z0-9]+)*$/,
        'Slug must be lowercase letters, numbers, and single hyphens (no leading, trailing, or double hyphens)',
    )
    .openapi({ example: 'john-smith' });

export const SetSlugRequestSchema = z
    .object({
        slug: SlugSchema.describe('TODO describe slug field for the OpenInspection MCP integration'),
    })
    .openapi('SetSlugRequest');

export const SlugAvailabilityResponseSchema = z
    .object({
        available: z.boolean().describe('TODO describe available field for the OpenInspection MCP integration'),
        reason: z.enum(['taken', 'reserved', 'invalid']).optional().describe('TODO describe reason field for the OpenInspection MCP integration'),
        suggestions: z.array(z.string()).optional().describe('TODO describe suggestions field for the OpenInspection MCP integration'),
    })
    .openapi('SlugAvailability');

export type SlugAvailability = z.infer<typeof SlugAvailabilityResponseSchema>;
