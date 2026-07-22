import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { and, eq, inArray } from 'drizzle-orm';
import { contactRoleProfiles } from '../../lib/db/schema';
import { DEFAULT_ROLE_PROFILES } from '../../lib/people/default-role-profiles';

// Idempotent: only inserts default keys the tenant does not already have.
// Mirrors the CONTRACTOR_TYPES inline-const seed pattern in starter-content.
export async function seedRoleProfiles(db: DrizzleD1Database, tenantId: string, now: Date = new Date()): Promise<void> {
    const keys = DEFAULT_ROLE_PROFILES.map(p => p.key);
    const existing = await db.select({ key: contactRoleProfiles.key }).from(contactRoleProfiles)
        .where(and(eq(contactRoleProfiles.tenantId, tenantId), inArray(contactRoleProfiles.key, keys)));
    const have = new Set(existing.map(r => r.key));
    const toInsert = DEFAULT_ROLE_PROFILES.filter(p => !have.has(p.key)).map(p => ({
        id: `crp_${tenantId}_${p.key}`,
        tenantId, key: p.key, label: p.label, kind: p.kind,
        isSystem: p.isSystem, sortOrder: p.sortOrder, active: true,
        createdAt: now, updatedAt: now,
    }));
    // onConflictDoNothing guards the check-then-insert race: two concurrent
    // first-use seeds (e.g. two ensureSeeds in flight) would otherwise collide on
    // the deterministic PK `crp_<tenant>_<key>`. Deterministic ids make the
    // insert naturally idempotent under the conflict.
    if (toInsert.length > 0) await db.insert(contactRoleProfiles).values(toInsert).onConflictDoNothing();
}
