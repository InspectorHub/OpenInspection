import { drizzle } from 'drizzle-orm/d1';
import { eq, and, isNotNull } from 'drizzle-orm';
import { comments } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import type { SeedRecommendation } from '../data/recommendation-seeds';
import type { Severity } from '../lib/validations/rating-system.schema';

// Comments-repair fold (2026-06-12): RecommendationService is now a THIN ALIAS
// over "repair-item comments" — rows in `comments` carrying repair fields. The
// dedicated `recommendations` table was dropped. The defining predicate is
// content-based (`repair_summary IS NOT NULL`), NOT severity='significant', so
// migrated rows that preserved a non-significant severity still surface here.
//
// Field mapping recommendation ↔ comment:
//   name                 → comments.text
//   category             → comments.category
//   severity             → comments.severity        (module F canonical vocabulary; the older rating_bucket column is gone)
//   defaultRepairSummary → comments.repairSummary
//
// A repair item carries SCOPE, not a price. The former defaultEstimateMin /
// defaultEstimateMax pair (comments.estimate_*_cents) is gone: a figure the
// product puts on a report reads as the inspection company's figure, and no
// catalogue default knows the property, the trade market, or the week. Money on
// an inspection is written by the buyer or their agent in the repair request.
export interface Recommendation {
    id: string; tenantId: string; category: string | null; name: string;
    severity: Severity;
    defaultRepairSummary: string; createdByUserId: string | null;
    /** Epoch MILLISECONDS. `comments.created_at` is NOT NULL, so this is never null. */
    createdAt: number;
    recommendedContractorTypeId: string | null;
}
// Every optional key spells `| undefined` explicitly. These inputs are handed a
// Zod-parsed request body, and `.optional()` infers `T | undefined`, which
// `exactOptionalPropertyTypes` refuses to assign to a plain `k?: T`.
export interface CreateRecommendationInput {
    category?: string | null | undefined; name: string;
    severity: Severity;
    defaultRepairSummary: string; createdByUserId?: string | null | undefined;
    recommendedContractorTypeId?: string | null | undefined;
}
export type UpdateRecommendationInput = {
    [K in keyof CreateRecommendationInput]?: CreateRecommendationInput[K] | undefined;
};

type CommentRow = typeof comments.$inferSelect;
function toRec(c: CommentRow): Recommendation {
    // Drizzle types the column `Date`, but D1 hands back a raw epoch-ms integer
    // on some read paths, so accept both and normalise to milliseconds. NOT
    // safeISODate/safeTimestamp: both read a bare number as SECONDS, and this
    // column is milliseconds — running it through them shifts the year by ~1900.
    const createdAt = c.createdAt as Date | number;
    return {
        id: c.id, tenantId: c.tenantId, category: c.category ?? null,
        name: c.text,
        severity: (c.severity as Recommendation['severity']) ?? 'significant',
        defaultRepairSummary: c.repairSummary ?? '',
        recommendedContractorTypeId: c.recommendedContractorTypeId ?? null,
        createdByUserId: null,
        createdAt: createdAt instanceof Date ? createdAt.getTime() : createdAt,
    };
}

export class RecommendationService {
    constructor(private db: D1Database) {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private getDrizzle() { return drizzle(this.db as any); }

    async create(tenantId: string, input: CreateRecommendationInput): Promise<Recommendation> {
        const db = this.getDrizzle();
        const row = {
            id: crypto.randomUUID(), tenantId, text: input.name,
            category: input.category ?? null,
            severity: input.severity,
            repairSummary: input.defaultRepairSummary,
            recommendedContractorTypeId: input.recommendedContractorTypeId ?? null,
            createdAt: new Date(),
        };
        await db.insert(comments).values(row);
        const c = await db.select().from(comments).where(eq(comments.id, row.id)).get();
        return toRec(c!);
    }

    async getById(id: string, tenantId: string): Promise<Recommendation | null> {
        const db = this.getDrizzle();
        const c = await db.select().from(comments)
            .where(and(eq(comments.id, id), eq(comments.tenantId, tenantId), isNotNull(comments.repairSummary))).get();
        return c ? toRec(c) : null;
    }

    async listByTenant(tenantId: string, filter?: { category?: string; severity?: Severity }): Promise<Recommendation[]> {
        const db = this.getDrizzle();
        const conds = [eq(comments.tenantId, tenantId), isNotNull(comments.repairSummary)];
        if (filter?.category) conds.push(eq(comments.category, filter.category));
        if (filter?.severity) conds.push(eq(comments.severity, filter.severity));
        const rows = await db.select().from(comments).where(and(...conds)).all();
        return rows.map(toRec);
    }

    async update(id: string, tenantId: string, patch: UpdateRecommendationInput): Promise<Recommendation> {
        const db = this.getDrizzle();
        const existing = await this.getById(id, tenantId);
        if (!existing) throw Errors.NotFound('Recommendation not found');
        // #348 — display marker ("edited 12 March"); see comments.edited_at. The
        // repair-items surface writes the same physical row as the canned-comment
        // library, so it stamps the same marker.
        const updates: Partial<CommentRow> = { editedAt: new Date() };
        if (patch.category !== undefined)             updates.category = patch.category ?? null;
        if (patch.name !== undefined)                 updates.text = patch.name;
        if (patch.severity !== undefined)             updates.severity = patch.severity;
        if (patch.defaultRepairSummary !== undefined) updates.repairSummary = patch.defaultRepairSummary;
        if (patch.recommendedContractorTypeId !== undefined) updates.recommendedContractorTypeId = patch.recommendedContractorTypeId ?? null;
        await db.update(comments).set(updates).where(and(eq(comments.id, id), eq(comments.tenantId, tenantId)));
        const refetched = await this.getById(id, tenantId);
        if (!refetched) throw Errors.Internal('Failed to read back updated recommendation');
        return refetched;
    }

    async delete(id: string, tenantId: string): Promise<void> {
        const db = this.getDrizzle();
        await db.delete(comments).where(and(eq(comments.id, id), eq(comments.tenantId, tenantId), isNotNull(comments.repairSummary)));
    }

    /**
     * Bulk-insert default repair-item comments for a tenant. Idempotent: skips
     * any entry whose (category, name) pair already exists as a repair-item
     * comment for the tenant.
     */
    async bulkSeed(tenantId: string, seeds: SeedRecommendation[]): Promise<{ inserted: number; skipped: number }> {
        const db = this.getDrizzle();
        const existing = await db.select().from(comments)
            .where(and(eq(comments.tenantId, tenantId), isNotNull(comments.repairSummary))).all();
        const seen = new Set(existing.map(c => `${c.category ?? ''}::${c.text}`));
        let inserted = 0, skipped = 0;
        for (const s of seeds) {
            const key = `${s.category ?? ''}::${s.name}`;
            if (seen.has(key)) { skipped++; continue; }
            await db.insert(comments).values({
                id: crypto.randomUUID(), tenantId, text: s.name, category: s.category ?? null,
                severity: s.severity, repairSummary: s.defaultRepairSummary,
                createdAt: new Date(),
            });
            inserted++;
        }
        return { inserted, skipped };
    }
}
