/**
 * Route metadata standards — shared constants + helper for the MCP/Skill
 * integration described in
 * docs/superpowers/specs/2026-05-21-core-skill-mcp-integration-design.md
 *
 * Every createRoute() call in server/api/ must wrap its config with
 * withMcpMetadata(...) so the OpenAPI doc carries `x-scopes` and `x-tier`
 * vendor extensions. The route-metadata vitest gate (tests/unit/route-
 * metadata.spec.ts) enforces this on CI.
 */

export const VALID_TAGS = [
    'auth', 'inspections', 'bookings', 'templates', 'team',
    'agents', 'ai', 'invoices', 'services', 'messages',
    'notifications', 'contacts', 'metrics', 'admin', 'sysadmin',
    'audit', 'marketplace', 'recommendations', 'agreements', 'webhooks',
    'public', 'calendar', 'tags', 'ratings', 'guest',
    'profile', 'identity', 'automations', 'integrations', 'qbo',
] as const;

export type ValidTag = typeof VALID_TAGS[number];

export const VALID_SECONDARY_TAGS = ['public', 'm2m', 'beta', 'webhook'] as const;

export const VALID_SCOPES = ['read', 'write', 'admin', 'agent'] as const;
export type ValidScope = typeof VALID_SCOPES[number];

export const VALID_TIERS = ['primary', 'extended', 'excluded'] as const;
export type ValidTier = typeof VALID_TIERS[number];

export const MIN_SUMMARY_WORDS = 4;
export const MAX_SUMMARY_WORDS = 12;
export const MIN_DESCRIPTION_CHARS = 50;
export const MIN_FIELD_DESCRIPTION_CHARS = 10;

export const PRIMARY_TIER_CAP = 45;

/**
 * Overlays MCP-tool metadata as OpenAPI vendor extensions on a createRoute()
 * config object. The generated OpenAPI doc preserves the `x-scopes` and
 * `x-tier` keys, which Phase 4's generator + the route-metadata vitest gate
 * both read.
 */
export function withMcpMetadata<T extends Record<string, unknown>>(
    route: T,
    meta: { scopes: readonly ValidScope[]; tier: ValidTier }
): T & { 'x-scopes': readonly ValidScope[]; 'x-tier': ValidTier } {
    return {
        ...route,
        'x-scopes': meta.scopes,
        'x-tier': meta.tier,
    };
}
