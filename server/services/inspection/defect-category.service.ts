import { drizzle } from 'drizzle-orm/d1';
import { eq, and, asc } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { defectCategories } from '../../lib/db/schema';
import type { CreateDefectCategoryInput, UpdateDefectCategoryInput } from '../../lib/validations/defect-category.schema';

export type DefectCategory = InferSelectModel<typeof defectCategories>;

// Authoring unification Plan-4 module K — the seed rows every tenant gets on
// first read of `/api/admin/defect-categories`. `safety` is the only seed that
// drives the report Summary by default (spec §4.K); tenants may edit/add more.
const SEED: Array<{ name: string; color: string; drivesSummary: boolean; sortOrder: number }> = [
    { name: 'maintenance',    color: '#3b82f6', drivesSummary: false, sortOrder: 0 },
    { name: 'recommendation', color: '#f59e0b', drivesSummary: false, sortOrder: 1 },
    { name: 'safety',         color: '#ef4444', drivesSummary: true,  sortOrder: 2 },
];

export class DefectCategoryService {
    constructor(private db: D1Database) {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private getDrizzle() { return drizzle(this.db as any); }

    async list(tenantId: string): Promise<DefectCategory[]> {
        const db = this.getDrizzle();
        return db.select().from(defectCategories)
            .where(eq(defectCategories.tenantId, tenantId))
            .orderBy(asc(defectCategories.sortOrder), asc(defectCategories.name)).all();
    }

    async create(tenantId: string, input: CreateDefectCategoryInput, isSeed = false): Promise<DefectCategory> {
        const db = this.getDrizzle();
        const row: DefectCategory = {
            id: crypto.randomUUID(),
            tenantId,
            name: input.name,
            color: input.color ?? '#6b7280',
            drivesSummary: input.drivesSummary ?? true,
            sortOrder: input.sortOrder ?? 0,
            isSeed,
            createdAt: new Date(),
        };
        await db.insert(defectCategories).values(row);
        return row;
    }

    async update(tenantId: string, id: string, patch: UpdateDefectCategoryInput): Promise<void> {
        const db = this.getDrizzle();
        const updates: Partial<DefectCategory> = {};
        if (patch.name !== undefined) updates.name = patch.name;
        if (patch.color !== undefined) updates.color = patch.color;
        if (patch.drivesSummary !== undefined) updates.drivesSummary = patch.drivesSummary;
        if (patch.sortOrder !== undefined) updates.sortOrder = patch.sortOrder;
        await db.update(defectCategories).set(updates)
            .where(and(eq(defectCategories.tenantId, tenantId), eq(defectCategories.id, id)));
    }

    async remove(tenantId: string, id: string): Promise<void> {
        const db = this.getDrizzle();
        // Seed rows (maintenance/recommendation/safety) are protected — the UI
        // hides Delete for them, but enforce it here too so a direct API call
        // cannot remove a category the report Summary logic depends on.
        await db.delete(defectCategories)
            .where(and(
                eq(defectCategories.tenantId, tenantId),
                eq(defectCategories.id, id),
                eq(defectCategories.isSeed, false),
            ));
    }

    async ensureSeed(tenantId: string): Promise<DefectCategory[]> {
        const existing = await this.list(tenantId);
        if (existing.length > 0) return existing;
        for (const s of SEED) await this.create(tenantId, s, true);
        return this.list(tenantId);
    }
}
