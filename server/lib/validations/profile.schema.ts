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
 * `idx_users_slug_per_tenant`.
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

/**
 * @deprecated for inspectors (DB-12 2026-06-06): the slug-claim route was
 * removed with the inspector-slug freeze. Retained because the slug FORMAT
 * rules still guard the agent namespace and stay under direct test coverage.
 */
export const SetSlugRequestSchema = z
    .object({
        slug: SlugSchema.describe('Public slug to claim (agent namespace; inspector slug writes are frozen).'),
    })
    .openapi('SetSlugRequest');

export const SlugAvailabilityResponseSchema = z
    .object({
        available: z.boolean().describe('TODO describe available field for the OpenInspection MCP integration'),
        reason: z.enum(['taken', 'reserved', 'invalid']).optional().describe('TODO describe reason field for the OpenInspection MCP integration'),
        suggestions: z.array(z.string()).optional().describe('TODO describe suggestions field for the OpenInspection MCP integration'),
    })
    .openapi('SlugAvailability');
