import { drizzle } from 'drizzle-orm/d1';
import { eq, and, isNotNull } from 'drizzle-orm';
import { comments } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import type { SeedRecommendation } from '../data/recommendation-seeds';

// Comments-repair fold (2026-06-12): RecommendationService is now a THIN ALIAS
// over "repair-item comments" — rows in `comments` carrying repair fields. The
// dedicated `recommendations` table was dropped. The defining predicate is
// content-based (`repair_summary IS NOT NULL`), NOT rating_bucket='defect', so
// migrated rows that preserved a non-defect severity still surface here.
//
// Field mapping recommendation ↔ comment:
//   name                 → comments.text
//   category             → comments.category
//   severity             → comments.severity        (rating_bucket also set on create)
//   defaultEstimateMin   → comments.estimateMinCents
//   defaultEstimateMax   → comments.estimateMaxCents
//   defaultRepairSummary → comments.repairSummary
export interface Recommendation {
    id: string; tenantId: string; category: string | null; name: string;
    severity: 'satisfactory' | 'monitor' | 'defect';
    defaultEstimateMin: number | null; defaultEstimateMax: number | null;
    defaultRepairSummary: string; createdByUserId: string | null; createdAt: number | null;
    recommendedContractorTypeId: string | null;
}
export interface CreateRecommendationInput {
    category?: string | null; name: string;
    severity: 'satisfactory' | 'monitor' | 'defect';
    defaultEstimateMin?: number | null; defaultEstimateMax?: number | null;
    defaultRepairSummary: string; createdByUserId?: string | null;
    recommendedContractorTypeId?: string | null;
}
export type UpdateRecommendationInput = Partial<CreateRecommendationInput>;

type CommentRow = typeof comments.$inferSelect;
function toRec(c: CommentRow): Recommendation {
    const createdAt = c.createdAt as Date | number | null;
    return {
        id: c.id, tenantId: c.tenantId, category: c.category ?? null,
        name: c.text,
        severity: (c.severity as Recommendation['severity']) ?? 'defect',
        defaultEstimateMin: c.estimateMinCents ?? null,
        defaultEstimateMax: c.estimateMaxCents ?? null,
        defaultRepairSummary: c.repairSummary ?? '',
        recommendedContractorTypeId: c.recommendedContractorTypeId ?? null,
        createdByUserId: null,
        createdAt: createdAt instanceof Date ? createdAt.getTime() : (createdAt ?? null),
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
            ratingBucket: 'defect', severity: input.severity,
            repairSummary: input.defaultRepairSummary,
            estimateMinCents: input.defaultEstimateMin ?? null,
            estimateMaxCents: input.defaultEstimateMax ?? null,
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

    async listByTenant(tenantId: string, filter?: { category?: string; severity?: 'satisfactory'|'monitor'|'defect' }): Promise<Recommendation[]> {
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
        const updates: Partial<CommentRow> = {};
        if (patch.category !== undefined)             updates.category = patch.category ?? null;
        if (patch.name !== undefined)                 updates.text = patch.name;
        if (patch.severity !== undefined)             updates.severity = patch.severity;
        if (patch.defaultEstimateMin !== undefined)   updates.estimateMinCents = patch.defaultEstimateMin ?? null;
        if (patch.defaultEstimateMax !== undefined)   updates.estimateMaxCents = patch.defaultEstimateMax ?? null;
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
                ratingBucket: 'defect', severity: s.severity, repairSummary: s.defaultRepairSummary,
                estimateMinCents: s.defaultEstimateMin ?? null, estimateMaxCents: s.defaultEstimateMax ?? null,
                createdAt: new Date(),
            });
            inserted++;
        }
        return { inserted, skipped };
    }
}
