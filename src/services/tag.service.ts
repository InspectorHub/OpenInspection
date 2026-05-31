/**
 * Sprint 3 S3-3 — TagService.
 *
 * Tenant-scoped CRUD over the `tags` table plus link/unlink helpers
 * for the `inspection_item_tag_links` join. Tags are internal-only —
 * never rendered on the customer-facing report.
 *
 * Inspector workflow: T hotkey on inspection-edit opens a picker;
 * multi-select toggles links/unlinks for the active item.
 *
 * Seed defaults: five canonical tags planted on first /tags visit
 * via `seedDefaults`. Idempotent — re-runs are no-ops.
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { tags, inspectionItemTagLinks } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import type { CreateTagInput, UpdateTagInput, TagRecord } from '../lib/validations/tag.schema';

/** Five canonical tags planted on first-run via `seedDefaults`. */
export const SEED_TAGS: ReadonlyArray<{ name: string; color: string }> = Object.freeze([
    { name: 'Needs follow-up',    color: 'amber'   },
    { name: 'Waiting for client', color: 'slate'   },
    { name: 'Critical',           color: 'rose'    },
    { name: 'Customer concern',   color: 'indigo'  },
    { name: 'Inspector note',     color: 'emerald' },
]);

export interface TagRow extends TagRecord {
    tenantId: string;
}

function rowToRecord(row: typeof tags.$inferSelect): TagRow {
    return {
        id:        row.id as string,
        tenantId:  row.tenantId as string,
        name:      row.name as string,
        color:     (row.color as string | null) ?? null,
        isSeed:    Boolean(row.isSeed),
        createdAt: Number(row.createdAt),
    };
}

export class TagService {
    constructor(private db: D1Database) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private getDrizzle() { return drizzle(this.db as any); }

    /** All tags visible to a tenant. Sorted: seeds first, then alpha. */
    async list(tenantId: string): Promise<TagRow[]> {
        const db = this.getDrizzle();
        const rows = await db.select().from(tags)
            .where(eq(tags.tenantId, tenantId))
            .all();
        const records = rows.map(rowToRecord);
        records.sort((a, b) => {
            if (a.isSeed !== b.isSeed) return a.isSeed ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        return records;
    }

    async get(id: string, tenantId: string): Promise<TagRow | null> {
        const db = this.getDrizzle();
        const row = await db.select().from(tags)
            .where(and(eq(tags.id, id), eq(tags.tenantId, tenantId)))
            .get();
        return row ? rowToRecord(row) : null;
    }

    async create(tenantId: string, input: CreateTagInput): Promise<TagRow> {
        const db = this.getDrizzle();
        const name = input.name.trim();
        if (!name) throw Errors.BadRequest('Name is required');

        const existing = await db.select({ id: tags.id }).from(tags)
            .where(and(eq(tags.tenantId, tenantId), eq(tags.name, name)))
            .get();
        if (existing) throw Errors.Conflict(`A tag named '${name}' already exists`);

        const id = crypto.randomUUID();
        await db.insert(tags).values({
            id,
            tenantId,
            name,
            color:     input.color ?? null,
            isSeed:    0,
            createdAt: Date.now(),
        });
        const created = await this.get(id, tenantId);
        if (!created) throw Errors.Internal('Failed to read back created tag');
        return created;
    }

    async update(id: string, tenantId: string, input: UpdateTagInput): Promise<TagRow> {
        const db = this.getDrizzle();
        const existing = await this.get(id, tenantId);
        if (!existing) throw Errors.NotFound('Tag not found');
        if (existing.isSeed && input.name !== undefined && input.name !== existing.name) {
            throw Errors.Forbidden('Seed tags cannot be renamed');
        }

        const updates: Record<string, unknown> = {};
        if (input.name !== undefined) {
            const name = input.name.trim();
            if (!name) throw Errors.BadRequest('Name is required');
            if (name !== existing.name) {
                const conflict = await db.select({ id: tags.id }).from(tags)
                    .where(and(eq(tags.tenantId, tenantId), eq(tags.name, name)))
                    .get();
                if (conflict) throw Errors.Conflict(`A tag named '${name}' already exists`);
            }
            updates.name = name;
        }
        if (input.color !== undefined) {
            updates.color = input.color ?? null;
        }
        if (Object.keys(updates).length === 0) return existing;

        await db.update(tags).set(updates)
            .where(and(eq(tags.id, id), eq(tags.tenantId, tenantId)));
        const refreshed = await this.get(id, tenantId);
        if (!refreshed) throw Errors.Internal('Failed to read back updated tag');
        return refreshed;
    }

    /** Deletes the tag + cascades to all item links. */
    async delete(id: string, tenantId: string): Promise<{ deleted: true }> {
        const db = this.getDrizzle();
        const existing = await this.get(id, tenantId);
        if (!existing) throw Errors.NotFound('Tag not found');

        // Cascade delete item links first to keep the FK-less link table consistent.
        await db.delete(inspectionItemTagLinks)
            .where(and(eq(inspectionItemTagLinks.tagId, id), eq(inspectionItemTagLinks.tenantId, tenantId)));
        await db.delete(tags)
            .where(and(eq(tags.id, id), eq(tags.tenantId, tenantId)));
        return { deleted: true as const };
    }

    /** Idempotent first-run seeder. Returns counts of inserted vs. skipped. */
    async seedDefaults(tenantId: string): Promise<{ inserted: number; skipped: number }> {
        const db = this.getDrizzle();
        const existingRows = await db.select({ name: tags.name }).from(tags)
            .where(eq(tags.tenantId, tenantId)).all();
        const existingNames = new Set(existingRows.map(r => r.name as string));

        let inserted = 0;
        let skipped = 0;
        const now = Date.now();
        for (const seed of SEED_TAGS) {
            if (existingNames.has(seed.name)) { skipped++; continue; }
            await db.insert(tags).values({
                id:        crypto.randomUUID(),
                tenantId,
                name:      seed.name,
                color:     seed.color,
                isSeed:    1,
                createdAt: now,
            });
            inserted++;
        }
        if (inserted > 0) logger.info('tags.seeded', { tenantId, inserted, skipped });
        return { inserted, skipped };
    }

    /**
     * Link a tag to an item position on an inspection. Idempotent — the
     * composite PK (inspection_id, item_id, tag_id) catches re-links.
     */
    async linkToItem(tenantId: string, inspectionId: string, itemId: string, tagId: string): Promise<void> {
        const tag = await this.get(tagId, tenantId);
        if (!tag) throw Errors.NotFound('Tag not found');
        const db = this.getDrizzle();
        try {
            await db.insert(inspectionItemTagLinks).values({
                inspectionId,
                itemId,
                tagId,
                tenantId,
                createdAt: Date.now(),
            });
        } catch (e) {
            // PK conflict on re-link is expected — swallow.
            const msg = e instanceof Error ? e.message.toLowerCase() : '';
            if (!msg.includes('unique') && !msg.includes('constraint')) throw e;
        }
    }

    async unlinkFromItem(tenantId: string, inspectionId: string, itemId: string, tagId: string): Promise<void> {
        const db = this.getDrizzle();
        await db.delete(inspectionItemTagLinks)
            .where(and(
                eq(inspectionItemTagLinks.tenantId, tenantId),
                eq(inspectionItemTagLinks.inspectionId, inspectionId),
                eq(inspectionItemTagLinks.itemId, itemId),
                eq(inspectionItemTagLinks.tagId, tagId),
            ));
    }

    /** Tags currently linked to a single inspection-item position. */
    async getItemTags(tenantId: string, inspectionId: string, itemId: string): Promise<TagRow[]> {
        const db = this.getDrizzle();
        const links = await db.select({ tagId: inspectionItemTagLinks.tagId }).from(inspectionItemTagLinks)
            .where(and(
                eq(inspectionItemTagLinks.tenantId, tenantId),
                eq(inspectionItemTagLinks.inspectionId, inspectionId),
                eq(inspectionItemTagLinks.itemId, itemId),
            ))
            .all();
        if (links.length === 0) return [];
        const tagIds = links.map(l => l.tagId as string);
        const rows = await db.select().from(tags)
            .where(and(eq(tags.tenantId, tenantId), inArray(tags.id, tagIds)))
            .all();
        return rows.map(rowToRecord).sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Bulk fetch — returns a map of itemId → TagRow[] for an entire
     * inspection. Used by inspection-edit on initial render to hydrate
     * tag chips for every item in one round-trip.
     */
    async getInspectionTagMap(tenantId: string, inspectionId: string): Promise<Record<string, TagRow[]>> {
        const db = this.getDrizzle();
        const links = await db.select().from(inspectionItemTagLinks)
            .where(and(
                eq(inspectionItemTagLinks.tenantId, tenantId),
                eq(inspectionItemTagLinks.inspectionId, inspectionId),
            ))
            .all();
        if (links.length === 0) return {};

        const tagIds = Array.from(new Set(links.map(l => l.tagId as string)));
        const tagRows = await db.select().from(tags)
            .where(and(eq(tags.tenantId, tenantId), inArray(tags.id, tagIds)))
            .all();
        const tagById = new Map<string, TagRow>(tagRows.map(r => [r.id as string, rowToRecord(r)]));

        const map: Record<string, TagRow[]> = {};
        for (const link of links) {
            const itemId = link.itemId as string;
            const tag = tagById.get(link.tagId as string);
            if (!tag) continue;
            if (!map[itemId]) map[itemId] = [];
            map[itemId].push(tag);
        }
        for (const k of Object.keys(map)) {
            map[k]!.sort((a, b) => a.name.localeCompare(b.name));
        }
        return map;
    }

    /** Count of items tagged with each tag inside one inspection. */
    async countByTag(tenantId: string, inspectionId: string): Promise<Record<string, number>> {
        const db = this.getDrizzle();
        const rows = await db.select({
            tagId: inspectionItemTagLinks.tagId,
            count: sql<number>`count(*)`,
        }).from(inspectionItemTagLinks)
            .where(and(
                eq(inspectionItemTagLinks.tenantId, tenantId),
                eq(inspectionItemTagLinks.inspectionId, inspectionId),
            ))
            .groupBy(inspectionItemTagLinks.tagId)
            .all();
        const out: Record<string, number> = {};
        for (const r of rows) out[r.tagId as string] = Number(r.count);
        return out;
    }

    /** All inspection ids in the tenant that have at least one item tagged with `tagId`. */
    async listInspectionsByTag(tenantId: string, tagId: string): Promise<string[]> {
        const db = this.getDrizzle();
        const rows = await db.selectDistinct({ inspectionId: inspectionItemTagLinks.inspectionId })
            .from(inspectionItemTagLinks)
            .where(and(eq(inspectionItemTagLinks.tenantId, tenantId), eq(inspectionItemTagLinks.tagId, tagId)))
            .all();
        return rows.map(r => r.inspectionId as string);
    }
}
