import { drizzle } from 'drizzle-orm/d1';
import { and, eq, ne } from 'drizzle-orm';
import { isNull } from 'drizzle-orm';
import { users } from '../../lib/db/schema/tenant';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';

export interface AgentProfilePatch {
    slug?: string;
    notifyOnReferral?: boolean;
    notifyOnReport?: boolean;
    notifyOnPaid?: boolean;
    name?: string;
}

/**
 * A2 — Persist agent profile patches (slug + 3 notification toggles + name).
 * Slug uniqueness is enforced across global agent users only — agent slugs
 * live in a separate namespace from per-tenant inspector slugs because
 * agent users have `tenantId IS NULL`.
 */
export async function updateProfile(
    rawDb: D1Database,
    userId: string,
    patch: AgentProfilePatch,
): Promise<void> {
    const db = drizzle(rawDb);
    if (patch.slug !== undefined) {
        const candidate = patch.slug.trim().toLowerCase();
        if (!candidate) throw Errors.BadRequest('Slug must not be empty');
        const taken = await db
            .select({ id: users.id })
            .from(users)
            .where(
                and(
                    eq(users.slug, candidate),
                    isNull(users.tenantId),
                    eq(users.role, 'agent'),
                    ne(users.id, userId),
                ),
            )
            .get();
        if (taken) throw Errors.Conflict('Slug already taken');
    }

    const set: Record<string, unknown> = {};
    if (patch.slug !== undefined) set.slug = patch.slug.trim().toLowerCase();
    if (patch.notifyOnReferral !== undefined) set.notifyOnReferral = patch.notifyOnReferral;
    if (patch.notifyOnReport !== undefined) set.notifyOnReport = patch.notifyOnReport;
    if (patch.notifyOnPaid !== undefined) set.notifyOnPaid = patch.notifyOnPaid;
    if (patch.name !== undefined) set.name = patch.name;
    if (Object.keys(set).length === 0) return;

    await db.update(users).set(set).where(eq(users.id, userId));
    logger.info('agent.profile.updated', { userId, fields: Object.keys(set) });
}
