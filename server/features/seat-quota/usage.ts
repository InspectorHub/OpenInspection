import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants, users } from '../../lib/db/schema';
import { computeSeatsUsed } from '../../lib/middleware/seat-guard';

/**
 * Tenant seat-quota usage snapshot.
 *
 * `max` mirrors the tenant's seat cap: a positive integer for capped plans,
 * or `null` for "unlimited" deployments (e.g. self-hosted standalone or a
 * future enterprise tier). The DB column `tenants.max_users` is NOT NULL
 * with a default of 3, and unlimited is currently expressed as `0` — this
 * helper normalises both `0` and a literal `null` to `max: null` so callers
 * can branch on a single shape.
 *
 * `remaining` is `Number.POSITIVE_INFINITY` whenever `max` is `null`, and
 * `Math.max(0, max - used)` otherwise. It never goes negative even if the
 * stored row count somehow exceeds the cap.
 */
export interface SeatUsage {
    used: number;
    max: number | null;
    remaining: number;
}

/**
 * Returns the current seat usage for a tenant.
 *
 * Pure helper: takes a tenantId + a Drizzle (D1) database handle and returns
 * the usage snapshot. No DI, no env access — callers (services, middleware)
 * are responsible for resolving the DB and tenant id.
 *
 * Note on "active" filter: this codebase does NOT track per-user status on
 * `users` (no `users.status` / `users.deletedAt` column at time of writing).
 * Membership is implied by an existing `users` row carrying `tenant_id`.
 * If a future migration introduces a status column, update the WHERE clause
 * here and in the matching test.
 */
export async function getSeatUsage(
    tenantId: string,
    db: D1Database,
): Promise<SeatUsage> {
    const drizzleDb = drizzle(db);

    const tenantRow = await drizzleDb
        .select({ maxUsers: tenants.maxUsers })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);

    // Normalise: schema stores `max_users` NOT NULL with default 3, and uses
    // `0` to mean "unlimited". Surface both `0` and `null` as `max: null` so
    // callers see a single sentinel.
    const rawMax = tenantRow[0]?.maxUsers;
    const max: number | null = rawMax == null || rawMax <= 0 ? null : rawMax;

    // Every member counts as one seat. Defer to the shared pure helper so
    // settings-billing and the invite middleware all agree on "used".
    const rows = await drizzleDb
        .select({ id: users.id })
        .from(users)
        .where(eq(users.tenantId, tenantId));
    const used = computeSeatsUsed(rows);

    const remaining = max === null ? Number.POSITIVE_INFINITY : Math.max(0, max - used);
    return { used, max, remaining };
}
