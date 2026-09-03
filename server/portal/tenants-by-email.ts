import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, isNull, or, gt, inArray } from 'drizzle-orm';
import type { HonoConfig } from '../types/hono';
import { logger } from '../lib/logger';
import { inspectionAccessTokens, tenants, contactRoleProfiles } from '../lib/db/schema';
import { capabilitiesForProfile, type RoleKind } from '../lib/people/capabilities';
import { hasDiscoveryObjection } from './discovery-objection';

/**
 * GET /api/platform/tenants/by-email?email=<email>
 * Cross-tenant client grant lookup: returns the slugs of tenants where the
 * email holds a LIVE (not revoked, not expired) grant whose role-profile KIND
 * grants selfRetrieveReport (client/co_client by default — see
 * server/lib/people/capabilities.ts; tenant-configurable, not a hard-coded
 * role list). Platform-level read (raw drizzle, no tenant scope) — guarded by
 * requireServiceBinding. Enables a portal-side "find my report" fan-out that
 * triggers each tenant's own magic-link without a cross-tenant session layer.
 *
 * WHAT THIS ENDPOINT DISCLOSES, said plainly because the rest of the file reads
 * as a routing convenience: given one address it answers which inspection
 * companies hold a live report grant for that person. The relationship between
 * an individual and a SET of companies is a fact no single company holds — the
 * platform assembles it here, on a call the person never sees. It stays because
 * it is how a homebuyer who lost the email reaches their own report; the notice
 * saying so belongs beside the field where the address is typed, which lives in
 * the portal repository (`app/routes/find-my-report.tsx`), not here.
 *
 * `discovery_objections` is the objection to it. It is consulted FIRST, and a
 * hit returns the same `{ slugs: [] }` an unknown address returns — a distinct
 * status or shape would out the objector to whoever is asking.
 */
export async function tenantsByEmailHandler(c: Context<HonoConfig>) {
    const email = c.req.query('email');
    if (!email || !email.includes('@')) {
        return c.json({ success: false, error: { message: 'email required' } }, 400);
    }
    try {
        const d = drizzle(c.env.DB);
        const now = new Date();

        // Before anything is scanned: has this person objected to the scan? The
        // answer is deliberately the same one an address with no grants gets.
        if (await hasDiscoveryObjection(d, email)) {
            return c.json({ success: true, data: { slugs: [] } });
        }

        // This scan is cross-tenant (no single tenantId in scope), so the
        // role→kind resolution is a per-row join against each grant's OWN
        // tenant rather than a single-tenant PeopleService.roleKeysWithCapability
        // lookup (that helper takes one tenantId). A grant whose role key has
        // no active profile row for its tenant (deleted/renamed) is dropped by
        // the inner join — fails closed, never matches.
        const grants = await d
            .select({ tenantId: inspectionAccessTokens.tenantId, kind: contactRoleProfiles.kind, capabilityOverrides: contactRoleProfiles.capabilityOverrides })
            .from(inspectionAccessTokens)
            .innerJoin(contactRoleProfiles, and(
                eq(contactRoleProfiles.tenantId, inspectionAccessTokens.tenantId),
                eq(contactRoleProfiles.key, inspectionAccessTokens.role),
                eq(contactRoleProfiles.active, true),
            ))
            .where(and(
                eq(inspectionAccessTokens.recipientEmail, email),
                isNull(inspectionAccessTokens.revokedAt),
                or(isNull(inspectionAccessTokens.expiresAt), gt(inspectionAccessTokens.expiresAt, now)),
            ));

        const tenantIds = [...new Set(
            grants
                .filter((g) => capabilitiesForProfile(g.kind as RoleKind, g.capabilityOverrides).selfRetrieveReport)
                .map((g) => g.tenantId as string),
        )];
        if (tenantIds.length === 0) return c.json({ success: true, data: { slugs: [] } });

        const rows = await d
            .select({ slug: tenants.slug })
            .from(tenants)
            .where(inArray(tenants.id, tenantIds));

        return c.json({ success: true, data: { slugs: rows.map((r) => r.slug as string) } });
    } catch (error: unknown) {
        logger.error('tenants by-email lookup failed', {}, error instanceof Error ? error : undefined);
        return c.json({ success: false, error: { message: 'Internal server error' } }, 500);
    }
}
