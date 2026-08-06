import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray } from 'drizzle-orm';
import { inspectorServiceAreas } from '../db/schema';

/**
 * Geographic eligibility — which inspectors will travel to this property.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: a filter that cannot run is not a
 * filter that passed. The first version of this idea "degraded gracefully" on
 * an empty property ZIP, which sounded careful and was in fact the only branch
 * that ever executed — the public booking form captured no ZIP at all, so 100%
 * of bookings took the graceful path and the feature was decoration. Every
 * non-filtering outcome here therefore comes back with a NAMED reason the
 * caller logs. Silence is not available.
 */

/** Why the ZIP filter did not narrow the candidate set. `null` = it did. */
export type EligibilitySkipReason =
    /** The property carries no ZIP — nothing to compare service areas against. */
    | 'property_zip_unknown'
    /** No inspector in the tenant has declared any service area at all. */
    | 'no_service_areas_configured';

export interface EligibilityOutcome {
    /** The surviving candidates. Empty is a real answer, not an error. */
    eligibleIds: string[];
    /** True when the ZIP actually narrowed (or could have narrowed) the set. */
    applied: boolean;
    /** Set iff `applied` is false. Never both null and unapplied. */
    reason: EligibilitySkipReason | null;
    /**
     * True when the filter ran and excluded EVERYONE. Distinct from `applied
     * && eligibleIds.length > 0`: the caller shows a different message for
     * "we do not serve this area" than for "that time is taken".
     */
    excludedEveryone: boolean;
}

/** Normalize a stored prefix or a submitted property ZIP the same way. */
export function normalizeZip(raw: string | null | undefined): string {
    return (raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * v1 match: PREFIX. '787' covers 787xx; '78701' covers only itself. A stored
 * prefix longer than the property ZIP never matches — '78701' does not serve
 * '787', because the shorter string is the less specific claim and treating it
 * as a match would quietly widen every territory.
 */
export function zipMatchesPrefix(propertyZip: string, prefix: string): boolean {
    const p = normalizeZip(propertyZip);
    const q = normalizeZip(prefix);
    if (p === '' || q === '') return false;
    return p.startsWith(q);
}

/**
 * @param qualifiedIds  Candidates that survived service qualification.
 * @param propertyZip   The property's ZIP, or null when the booking has none.
 * @param areasByUser   userId -> declared prefixes. A user ABSENT from this map
 *                      has declared nothing and therefore serves everywhere —
 *                      the same "empty means all" convention as
 *                      `service_inspectors`. Callers must pass a map built from
 *                      rows, never one pre-filled with empty arrays, or that
 *                      convention silently inverts.
 */
export function filterEligibleInspectors(
    qualifiedIds: string[],
    propertyZip: string | null,
    areasByUser: Map<string, string[]>,
): EligibilityOutcome {
    const zip = normalizeZip(propertyZip);
    if (zip === '') {
        return {
            eligibleIds: qualifiedIds,
            applied: false,
            reason: 'property_zip_unknown',
            excludedEveryone: false,
        };
    }
    // Nobody has drawn a territory. Filtering on an empty rulebook would be a
    // no-op that reads like a decision; say so instead.
    const anyAreas = [...areasByUser.values()].some((list) => list.length > 0);
    if (!anyAreas) {
        return {
            eligibleIds: qualifiedIds,
            applied: false,
            reason: 'no_service_areas_configured',
            excludedEveryone: false,
        };
    }

    const eligibleIds = qualifiedIds.filter((id) => {
        const prefixes = areasByUser.get(id) ?? [];
        if (prefixes.length === 0) return true; // declared nothing = serves everywhere
        return prefixes.some((prefix) => zipMatchesPrefix(zip, prefix));
    });

    return {
        eligibleIds,
        applied: true,
        reason: null,
        excludedEveryone: qualifiedIds.length > 0 && eligibleIds.length === 0,
    };
}

/**
 * Declared territories for the given candidates, keyed by user id.
 *
 * Users with no rows are ABSENT from the map, not present with an empty array
 * — `filterEligibleInspectors` reads absence as "serves everywhere" and the
 * two encodings must not drift apart. Same loader-beside-rules shape as
 * `loadSlotGridOptions` in slot-rules.ts.
 */
export async function loadServiceAreasByUser(
    d1: D1Database,
    tenantId: string,
    userIds: string[],
): Promise<Map<string, string[]>> {
    const byUser = new Map<string, string[]>();
    if (userIds.length === 0) return byUser;
    const db = drizzle(d1);
    // D1 binds 100 parameters per statement; the tenant + a chunk of ids fits.
    const CHUNK = 90;
    for (let i = 0; i < userIds.length; i += CHUNK) {
        const rows = await db.select({
            userId: inspectorServiceAreas.userId,
            zipPrefix: inspectorServiceAreas.zipPrefix,
        }).from(inspectorServiceAreas)
            .where(and(
                eq(inspectorServiceAreas.tenantId, tenantId),
                inArray(inspectorServiceAreas.userId, userIds.slice(i, i + CHUNK)),
            )).all();
        for (const row of rows) {
            const list = byUser.get(row.userId) ?? [];
            list.push(row.zipPrefix);
            byUser.set(row.userId, list);
        }
    }
    return byUser;
}
