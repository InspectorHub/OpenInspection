import { drizzle } from 'drizzle-orm/d1';
import { and, eq, ne } from 'drizzle-orm';
import { isNull } from 'drizzle-orm';
import { users } from '../../lib/db/schema/tenant';
import { Errors } from '../../lib/errors';
import { isValidTimeZone } from '../../lib/tz';
import { logger } from '../../lib/logger';

export interface AgentProfilePatch {
    slug?: string;
    notifyOnReferral?: boolean;
    notifyOnReport?: boolean;
    notifyOnPaid?: boolean;
    name?: string;
    /** Personal display-timezone override (IANA id). '' clears it (referral
     *  dates then follow each inspecting company's timezone). */
    timezone?: string;
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
    if (patch.timezone !== undefined) {
        // Empty string clears the override (NULL = follow each company's tz).
        // A non-empty value must be a resolvable IANA id — reject anything else
        // fail-closed rather than persisting an unusable zone.
        const tz = patch.timezone.trim();
        if (tz && !isValidTimeZone(tz)) throw Errors.BadRequest('Invalid timezone');
        set.timezone = tz || null;
    }
    if (Object.keys(set).length === 0) return;

    await db.update(users).set(set).where(eq(users.id, userId));
    logger.info('agent.profile.updated', { userId, fields: Object.keys(set) });
}

/**
 * Spec 3 Task 4b — Read the signed-in agent's profile (slug + notification
 * prefs) for GET /api/agent/profile. Agents are global users (tenant_id IS
 * NULL, id globally unique), so a plain by-id lookup is correct here — no
 * tenant scoping applies.
 */
export async function getProfile(rawDb: D1Database, userId: string) {
    const db = drizzle(rawDb);
    const row = await db.select({
        name: users.name, email: users.email, slug: users.slug,
        notifyOnReferral: users.notifyOnReferral, notifyOnReport: users.notifyOnReport, notifyOnPaid: users.notifyOnPaid,
        timezone: users.timezone,
    }).from(users).where(eq(users.id, userId)).get();
    if (!row) throw Errors.NotFound('Agent profile not found');
    return {
        name: row.name ?? null, email: row.email ?? '', slug: row.slug ?? null,
        notifyOnReferral: !!row.notifyOnReferral, notifyOnReport: !!row.notifyOnReport, notifyOnPaid: !!row.notifyOnPaid,
        timezone: row.timezone ?? null,
    };
}
