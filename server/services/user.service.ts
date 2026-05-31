import { drizzle } from 'drizzle-orm/d1';
import { and, eq, ne } from 'drizzle-orm';
import * as schema from '../lib/db/schema';
import { logger } from '../lib/logger';
import { Errors } from '../lib/errors';

const { users, slugReservations } = schema;

/**
 * Spec 5H D2 — persists the inspector's default signature image (data URI)
 * to users.default_signature_base64. Reused by auto-sign-on-publish (Task 3.4)
 * and pre-fills the SignaturePad in Settings → Profile.
 */
export async function saveUserDefaultSignature(
    d1: D1Database,
    userId: string,
    signatureBase64: string,
): Promise<void> {
    const db = drizzle(d1, { schema });
    const row = await db.select({ id: users.id }).from(users)
        .where(eq(users.id, userId)).get();
    if (!row) throw new Error('user not found');
    await db.update(users)
        .set({ defaultSignatureBase64: signatureBase64 })
        .where(eq(users.id, userId));
}

export interface SlugAvailability {
    available: boolean;
    reason?: 'taken' | 'reserved' | 'invalid';
    suggestions?: string[];
}

/**
 * Booking #7 Sprint C-1 — public inspector profile shape consumed by
 * `/inspector/<slug>`. Service-areas JSON is parsed once here so the page
 * template (and Settings → Profile editor) never has to handle the raw blob.
 */
export interface InspectorProfile {
    id: string;
    name: string | null;
    bio: string | null;
    photoUrl: string | null;
    licenseNumber: string | null;
    email: string | null;
    phone: string | null;
    slug: string | null;
    serviceAreas: Array<{ city: string; state: string; zip: string }>;
}

function parseServiceAreas(raw: string | null): InspectorProfile['serviceAreas'] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((a): a is InspectorProfile['serviceAreas'][number] =>
            !!a && typeof a === 'object' && typeof a.city === 'string' && typeof a.state === 'string' && typeof a.zip === 'string',
        );
    } catch {
        return [];
    }
}

/**
 * Booking #7 Sprint A — UserService.
 *
 * Owns slug-related queries that back the per-inspector `/book/<slug>` link.
 * Per-tenant uniqueness is enforced by the partial unique index
 * `idx_users_slug_per_tenant` (migration 0052_inspector_slug.sql); the service
 * additionally consults the `slug_reservations` blacklist before allowing a
 * write so customers can't claim names that shadow real route paths.
 */
export class UserService {
    constructor(private db: D1Database) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    /**
     * Resolves a slug to a user within the given tenant. Returns null when no
     * match is found. Tenant scope is enforced at the query level — the same
     * slug may legitimately exist in multiple tenants.
     */
    async findBySlug(tenantId: string, slug: string) {
        const db = this.getDrizzle();
        const row = await db.select().from(users)
            .where(and(eq(users.tenantId, tenantId), eq(users.slug, slug)))
            .get();
        return row ?? null;
    }

    /**
     * Booking #7 Sprint C-1 — returns the public-profile shape used by
     * `/inspector/<slug>`. service_areas JSON is parsed defensively (malformed
     * blobs degrade to an empty array rather than 500-ing the page).
     */
    async getProfileBySlug(tenantId: string, slug: string): Promise<InspectorProfile | null> {
        const db = this.getDrizzle();
        const row = await db.select().from(users)
            .where(and(eq(users.tenantId, tenantId), eq(users.slug, slug)))
            .get();
        if (!row) return null;
        return {
            id: row.id,
            name: row.name,
            bio: row.bio,
            photoUrl: row.photoUrl,
            licenseNumber: row.licenseNumber,
            email: row.email,
            phone: row.phone,
            slug: row.slug,
            serviceAreas: parseServiceAreas(row.serviceAreas),
        };
    }

    /**
     * Checks whether `slug` is available for `tenantId`. The optional
     * `excludeUserId` lets a user "save" their own existing slug without it
     * appearing taken.
     *
     * Order of checks: reserved blacklist → existing taken row in same tenant.
     * When taken, three numeric-suffix suggestions are returned.
     */
    async checkSlug(tenantId: string, slug: string, excludeUserId?: string): Promise<SlugAvailability> {
        const db = this.getDrizzle();

        const reserved = await db.select().from(slugReservations)
            .where(eq(slugReservations.slug, slug))
            .get();
        if (reserved) return { available: false, reason: 'reserved' };

        const conds = [eq(users.tenantId, tenantId), eq(users.slug, slug)];
        if (excludeUserId) conds.push(ne(users.id, excludeUserId));
        const taken = await db.select({ id: users.id }).from(users)
            .where(and(...conds))
            .get();
        if (taken) {
            return {
                available: false,
                reason: 'taken',
                suggestions: this.suggestAlternatives(slug, 3),
            };
        }
        return { available: true };
    }

    /**
     * Persists a slug for `userId` (scoped to `tenantId`). Re-validates
     * availability before writing so a concurrent claim can't race past the
     * UI check.
     */
    async setSlug(userId: string, tenantId: string, slug: string): Promise<void> {
        const check = await this.checkSlug(tenantId, slug, userId);
        if (!check.available) {
            throw Errors.Conflict(`Slug not available: ${check.reason ?? 'unknown'}`);
        }
        const db = this.getDrizzle();
        await db.update(users)
            .set({ slug })
            .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
        logger.info('user.slug.set', { userId, tenantId, slug });
    }

    /**
     * Design System 0520 subsystem B phase 1 task 1.2 — update users.last_active_at.
     * Called by touchLastActiveMiddleware via c.executionCtx.waitUntil() so the
     * write never blocks the user-visible response. Middleware debounces to
     * 30 s per userId per worker isolate, so this method is rate-limited
     * upstream and does not need its own throttle.
     */
    async touchLastActive(userId: string, epochSeconds: number): Promise<void> {
        const db = this.getDrizzle();
        await db.update(users).set({ lastActiveAt: epochSeconds }).where(eq(users.id, userId));
    }

    /**
     * Generates `count` numeric-suffix alternatives — `<base>-2`, `<base>-3`,
     * etc. Pure helper kept side-effect-free so it can be reused by the API
     * route when it wants to surface suggestions on a 409 response.
     */
    suggestAlternatives(base: string, count = 3): string[] {
        const out: string[] = [];
        for (let i = 2; out.length < count && i < 100; i++) {
            out.push(`${base}-${i}`);
        }
        return out;
    }
}
