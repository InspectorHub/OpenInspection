/**
 * Route metadata standards — shared constants + helper for the MCP/Skill
 * integration. See docs/developers/07_route_metadata.md (conventions) and
 * docs/developers/mcp-oauth-notes.md (server architecture).
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
    'audit', 'marketplace', 'recommendations', 'contractor-types', 'agreements', 'webhooks',
    'public', 'calendar', 'tags', 'ratings',
    'profile', 'identity', 'automations', 'integrations', 'qbo',
    'sms',
] as const;

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
// `const T`: a const type parameter (TS 5.0+) preserves the literal type of the
// createRoute() config the caller passes — crucially the `path`/`method` string
// LITERALS. Without `const`, the `extends Record<string, unknown>` constraint
// widens `path` to `string`, which makes hono/client unable to key routes by
// path → it merges every sibling route into one node and collapses the typed
// client to a `ClientRequest<string, string, …>` leaf (root cause of C-10: the
// typed-hono client degradation on large modules like inspections). See backlog
// C-10. The runtime spread below is unchanged; this only sharpens the type.
export function withMcpMetadata<const T extends Record<string, unknown>>(
    route: T,
    meta: { scopes: readonly ValidScope[]; tier: ValidTier }
): T & { 'x-scopes': readonly ValidScope[]; 'x-tier': ValidTier } {
    return {
        ...route,
        'x-scopes': meta.scopes,
        'x-tier': meta.tier,
    };
}
