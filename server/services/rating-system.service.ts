/**
 * Sprint 2 S2-1 — RatingSystemService.
 *
 * Tenant-scoped CRUD over the `rating_systems` table. Levels are stored
 * inline as JSON on the row itself (no separate `rating_levels` table)
 * because: (a) every read path needs the full level list, (b) row count
 * per system is at most 10, and (c) Drizzle lacks first-class array-of-
 * relations support on D1, so the join query was strictly slower.
 *
 * Seed systems (`isSeed = true`) are immutable — clone first, then edit.
 * Default systems (`isDefault = true`) are returned by `getDefault()` for
 * templates that don't bind a specific system. Setting a new default
 * automatically clears the flag on any other system inside the tenant.
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, ne } from 'drizzle-orm';
import { ratingSystems, templates } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { RATING_SYSTEM_SEEDS } from '../data/rating-system-seeds';
import type {
    CreateRatingSystemInput,
    UpdateRatingSystemInput,
    RatingLevel,
    RatingLevelInput,
} from '../lib/validations/rating-system.schema';

export interface RatingSystemRecord {
    id:          string;
    tenantId:    string;
    name:        string;
    slug:        string;
    description: string | null;
    levels:      RatingLevel[];
    isDefault:   boolean;
    isSeed:      boolean;
    createdAt:   number;
    updatedAt:   number;
}

/** Normalize an incoming level array — assign UUIDs + display order. */
function normalizeLevels(input: RatingLevelInput[]): RatingLevel[] {
    return input.map((lvl, idx) => ({
        id:           lvl.id ?? crypto.randomUUID(),
        abbreviation: lvl.abbreviation,
        label:        lvl.label,
        color:        lvl.color,
        severity:     lvl.severity,
        isDefect:     lvl.isDefect ?? false,
        ...(lvl.pausesAdvance !== undefined ? { pausesAdvance: lvl.pausesAdvance } : {}),
        ...(lvl.hotkey !== undefined ? { hotkey: lvl.hotkey } : {}),
        order:  lvl.order ?? idx,
    }));
}

function rowToRecord(row: typeof ratingSystems.$inferSelect): RatingSystemRecord {
    // Drizzle's `mode: 'json'` parses on read but tolerates raw strings.
    let levels: RatingLevel[] = [];
    const raw = row.levels as unknown;
    if (Array.isArray(raw)) {
        levels = raw as RatingLevel[];
    } else if (typeof raw === 'string') {
        try { levels = JSON.parse(raw) as RatingLevel[]; }
        catch { levels = []; }
    }
    levels.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return {
        id:          row.id as string,
        tenantId:    row.tenantId as string,
        name:        row.name as string,
        slug:        row.slug as string,
        description: row.description as string | null,
        levels,
        isDefault:   Boolean(row.isDefault),
        isSeed:      Boolean(row.isSeed),
        createdAt:   Number(row.createdAt),
        updatedAt:   Number(row.updatedAt),
    };
}

export class RatingSystemService {
    constructor(private db: D1Database) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private getDrizzle() { return drizzle(this.db as any); }

    /** All systems visible to a tenant — seeds + tenant-owned. Sorted: default first, then seeds, then alpha. */
    async list(tenantId: string): Promise<RatingSystemRecord[]> {
        const db = this.getDrizzle();
        const rows = await db.select().from(ratingSystems)
            .where(eq(ratingSystems.tenantId, tenantId))
            .all();
        const records = rows.map(rowToRecord);
        records.sort((a, b) => {
            if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
            if (a.isSeed   !== b.isSeed)    return a.isSeed   ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        return records;
    }

    /** Single system by id, scoped to the tenant. */
    async get(id: string, tenantId: string): Promise<RatingSystemRecord | null> {
        const db = this.getDrizzle();
        const row = await db.select().from(ratingSystems)
            .where(and(eq(ratingSystems.id, id), eq(ratingSystems.tenantId, tenantId)))
            .get();
        return row ? rowToRecord(row) : null;
    }

    /** Tenant default — the single row marked isDefault=true, or the first seed as fallback. */
    async getDefault(tenantId: string): Promise<RatingSystemRecord | null> {
        const db = this.getDrizzle();
        const def = await db.select().from(ratingSystems)
            .where(and(eq(ratingSystems.tenantId, tenantId), eq(ratingSystems.isDefault, true)))
            .get();
        if (def) return rowToRecord(def);
        // Fallback: first seed in the tenant. Ensures inspections always
        // resolve a level set even if the tenant accidentally cleared the
        // default flag.
        const fallback = await db.select().from(ratingSystems)
            .where(and(eq(ratingSystems.tenantId, tenantId), eq(ratingSystems.isSeed, true)))
            .orderBy(ratingSystems.createdAt)
            .limit(1)
            .get();
        return fallback ? rowToRecord(fallback) : null;
    }

    /** Resolve the rating system the inspection-edit page should use for a template. */
    async resolveForTemplate(templateId: string | null, tenantId: string): Promise<RatingSystemRecord | null> {
        if (!templateId) return this.getDefault(tenantId);
        const db = this.getDrizzle();
        const tpl = await db.select({ ratingSystemId: templates.ratingSystemId })
            .from(templates)
            .where(and(eq(templates.id, templateId), eq(templates.tenantId, tenantId)))
            .get();
        if (tpl?.ratingSystemId) {
            const sys = await this.get(tpl.ratingSystemId as string, tenantId);
            if (sys) return sys;
        }
        return this.getDefault(tenantId);
    }

    async create(tenantId: string, input: CreateRatingSystemInput): Promise<RatingSystemRecord> {
        const db = this.getDrizzle();
        // Slug uniqueness — friendlier error than the SQLite unique-index conflict.
        const existing = await db.select({ id: ratingSystems.id }).from(ratingSystems)
            .where(and(eq(ratingSystems.tenantId, tenantId), eq(ratingSystems.slug, input.slug)))
            .get();
        if (existing) throw Errors.Conflict(`Rating system with slug '${input.slug}' already exists`);

        const id = crypto.randomUUID();
        const now = Date.now();
        const levels = normalizeLevels(input.levels);
        await db.insert(ratingSystems).values({
            id,
            tenantId,
            name:        input.name,
            slug:        input.slug,
            description: input.description ?? null,
            levels:      levels as unknown as typeof ratingSystems.$inferInsert['levels'],
            isDefault:   Boolean(input.isDefault),
            isSeed:      false,
            createdAt:   now,
            updatedAt:   now,
        });
        if (input.isDefault) await this.clearOtherDefaults(tenantId, id);
        const created = await this.get(id, tenantId);
        if (!created) throw Errors.Internal('Failed to read back created rating system');
        return created;
    }

    /**
     * Clone any existing system into a fresh editable copy. Seed copies are
     * the canonical entry point for tenant customization.
     */
    async clone(sourceId: string, tenantId: string, newName: string, newSlug?: string): Promise<RatingSystemRecord> {
        const src = await this.get(sourceId, tenantId);
        if (!src) throw Errors.NotFound('Rating system not found');
        const slug = newSlug ?? `${src.slug}-copy-${Date.now().toString(36)}`;
        return this.create(tenantId, {
            name:        newName,
            slug,
            ...(src.description ? { description: src.description } : {}),
            isDefault:   false,
            // Drop ids so normalizeLevels mints fresh ones for the new system.
            levels:      src.levels.map(({ id: _id, order: _order, ...rest }) => rest),
        });
    }

    async update(id: string, tenantId: string, input: UpdateRatingSystemInput): Promise<RatingSystemRecord> {
        const db = this.getDrizzle();
        const existing = await this.get(id, tenantId);
        if (!existing) throw Errors.NotFound('Rating system not found');
        if (existing.isSeed) throw Errors.Forbidden('Seed rating systems are read-only — clone first to customize');

        const updates: Record<string, unknown> = { updatedAt: Date.now() };
        if (input.name !== undefined)        updates.name        = input.name;
        if (input.slug !== undefined)        updates.slug        = input.slug;
        if (input.description !== undefined) updates.description = input.description ?? null;
        if (input.isDefault !== undefined)   updates.isDefault   = Boolean(input.isDefault);
        if (input.levels !== undefined)      updates.levels      = normalizeLevels(input.levels);

        // Slug uniqueness when changed.
        if (input.slug !== undefined && input.slug !== existing.slug) {
            const conflict = await db.select({ id: ratingSystems.id }).from(ratingSystems)
                .where(and(
                    eq(ratingSystems.tenantId, tenantId),
                    eq(ratingSystems.slug, input.slug),
                    ne(ratingSystems.id, id),
                ))
                .get();
            if (conflict) throw Errors.Conflict(`Rating system with slug '${input.slug}' already exists`);
        }

        await db.update(ratingSystems).set(updates)
            .where(and(eq(ratingSystems.id, id), eq(ratingSystems.tenantId, tenantId)));

        if (input.isDefault) await this.clearOtherDefaults(tenantId, id);

        const refreshed = await this.get(id, tenantId);
        if (!refreshed) throw Errors.Internal('Failed to read back updated rating system');
        return refreshed;
    }

    async delete(id: string, tenantId: string): Promise<{ deleted: true }> {
        const db = this.getDrizzle();
        const existing = await this.get(id, tenantId);
        if (!existing) throw Errors.NotFound('Rating system not found');
        if (existing.isSeed) throw Errors.Forbidden('Seed rating systems cannot be deleted');

        // Refuse to delete a system that any template still binds.
        const refs = await db.select({ id: templates.id }).from(templates)
            .where(and(eq(templates.tenantId, tenantId), eq(templates.ratingSystemId, id)))
            .all();
        if (refs.length > 0) {
            throw Errors.Conflict(`${refs.length} template${refs.length === 1 ? '' : 's'} still bind this rating system`);
        }

        await db.delete(ratingSystems)
            .where(and(eq(ratingSystems.id, id), eq(ratingSystems.tenantId, tenantId)));
        return { deleted: true as const };
    }

    /**
     * Idempotent first-run seeder. Creates the four default rating systems
     * for a tenant if they don't already exist. Marks them isSeed=true so
     * they are immutable. The first seed becomes isDefault for the tenant.
     */
    async seedDefaults(tenantId: string): Promise<{ inserted: number; skipped: number }> {
        const db = this.getDrizzle();
        const existingRows = await db.select({ slug: ratingSystems.slug }).from(ratingSystems)
            .where(eq(ratingSystems.tenantId, tenantId)).all();
        const existingSlugs = new Set(existingRows.map(r => r.slug as string));

        let inserted = 0;
        let skipped = 0;
        const now = Date.now();
        for (const seed of RATING_SYSTEM_SEEDS) {
            if (existingSlugs.has(seed.slug)) { skipped++; continue; }
            const id = crypto.randomUUID();
            const levels: RatingLevel[] = seed.levels.map((lvl, idx) => ({
                id:           crypto.randomUUID(),
                abbreviation: lvl.abbreviation,
                label:        lvl.label,
                color:        lvl.color,
                severity:     lvl.severity,
                isDefect:     lvl.isDefect,
                ...(lvl.pausesAdvance ? { pausesAdvance: true } : {}),
                ...(lvl.hotkey ? { hotkey: lvl.hotkey } : {}),
                order:  idx,
            }));
            await db.insert(ratingSystems).values({
                id,
                tenantId,
                name:        seed.name,
                slug:        seed.slug,
                description: seed.description,
                levels:      levels as unknown as typeof ratingSystems.$inferInsert['levels'],
                isDefault:   seed.isDefault,
                isSeed:      true,
                createdAt:   now,
                updatedAt:   now,
            });
            inserted++;
        }
        if (inserted > 0) {
            logger.info('rating-systems.seeded', { tenantId, inserted, skipped });
        }
        return { inserted, skipped };
    }

    /** Internal — flip the default flag off on every system other than `keepId`. */
    private async clearOtherDefaults(tenantId: string, keepId: string): Promise<void> {
        const db = this.getDrizzle();
        await db.update(ratingSystems)
            .set({ isDefault: false, updatedAt: Date.now() })
            .where(and(
                eq(ratingSystems.tenantId, tenantId),
                eq(ratingSystems.isDefault, true),
                ne(ratingSystems.id, keepId),
            ));
    }
}
