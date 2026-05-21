/**
 * Design System 0520 subsystem D phase 1 task 1.2 — UnitService.
 *
 * Owns the Building → Floor → Unit hierarchy used for commercial /
 * multi-unit inspections. The tree is materialised by parent pointers
 * (no closure table) — depth ≤ 3 (root/Building → Floor → Unit) so a
 * recursive parent walk for depth + cycle detection stays bounded.
 *
 * Tenant isolation: every method takes an explicit `tenantId` and
 * filters by it; the underlying `inspection_units` table has a
 * tenant_id NOT NULL column per multi-tenant rules in
 * apps/core/CLAUDE.md.
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, asc } from 'drizzle-orm';
import { inspectionUnits } from '../lib/db/schema';

const MAX_DEPTH = 3;  // root(0) → building(1) → floor(2) → unit(3)

export interface CreateUnitInput {
    inspectionId: string;
    parentUnitId: string | null;
    kind:         'building' | 'floor' | 'unit';
    name:         string;
}

export interface UnitRow {
    id:           string;
    tenantId:     string;
    inspectionId: string;
    parentUnitId: string | null;
    kind:         string;
    name:         string;
    sortOrder:    number;
    createdAt:    string;
}

export class UnitService {
    constructor(private db: D1Database) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    async create(tenantId: string, input: CreateUnitInput): Promise<{ id: string }> {
        const db = this.getDrizzle();

        // 1. Depth check via parent walk.
        const depth = await this._depthOf(db, tenantId, input.parentUnitId);
        if (depth >= MAX_DEPTH) {
            throw new Error(`Max tree depth (${MAX_DEPTH}) exceeded`);
        }

        // 2. Sibling-name uniqueness within parent.
        const siblings = await db.select().from(inspectionUnits)
            .where(and(
                eq(inspectionUnits.tenantId, tenantId),
                eq(inspectionUnits.inspectionId, input.inspectionId),
            )).all();
        const sameParent = siblings.filter(s => s.parentUnitId === input.parentUnitId);
        if (sameParent.some(s => s.name === input.name)) {
            throw new Error(`Duplicate sibling name: ${input.name}`);
        }

        const nextSort = sameParent.length > 0
            ? Math.max(...sameParent.map(s => s.sortOrder)) + 10
            : 0;
        const id = crypto.randomUUID();
        await db.insert(inspectionUnits).values({
            id,
            tenantId,
            inspectionId: input.inspectionId,
            parentUnitId: input.parentUnitId,
            kind:         input.kind,
            name:         input.name,
            sortOrder:    nextSort,
            createdAt:    new Date().toISOString(),
        });
        return { id };
    }

    async list(tenantId: string, inspectionId: string): Promise<UnitRow[]> {
        return await this.getDrizzle().select().from(inspectionUnits)
            .where(and(
                eq(inspectionUnits.tenantId, tenantId),
                eq(inspectionUnits.inspectionId, inspectionId),
            ))
            .orderBy(asc(inspectionUnits.sortOrder))
            .all();
    }

    async update(tenantId: string, unitId: string, patch: { name?: string; sortOrder?: number }): Promise<void> {
        const db = this.getDrizzle();
        await db.update(inspectionUnits).set(patch)
            .where(and(eq(inspectionUnits.id, unitId), eq(inspectionUnits.tenantId, tenantId)));
    }

    async delete(tenantId: string, unitId: string): Promise<void> {
        const db = this.getDrizzle();
        // Recursive cascade — depth ≤ 3 so worst-case ~Nchildren queries.
        const children = await db.select().from(inspectionUnits)
            .where(and(eq(inspectionUnits.parentUnitId, unitId), eq(inspectionUnits.tenantId, tenantId)))
            .all();
        for (const c of children) {
            await this.delete(tenantId, c.id);
        }
        await db.delete(inspectionUnits)
            .where(and(eq(inspectionUnits.id, unitId), eq(inspectionUnits.tenantId, tenantId)));
    }

    async move(tenantId: string, unitId: string, newParentUnitId: string | null, newSortOrder: number): Promise<void> {
        const db = this.getDrizzle();

        if (newParentUnitId) {
            // Cycle check: walk newParent's ancestors; must not encounter unitId.
            let cursor: string | null = newParentUnitId;
            const seen = new Set<string>();
            while (cursor) {
                if (cursor === unitId) throw new Error('Cannot move: would create a cycle');
                if (seen.has(cursor)) break;  // defensive — shouldn't happen
                seen.add(cursor);
                const row = await db.select().from(inspectionUnits)
                    .where(and(eq(inspectionUnits.id, cursor), eq(inspectionUnits.tenantId, tenantId)))
                    .get();
                cursor = row?.parentUnitId ?? null;
            }
        }

        await db.update(inspectionUnits)
            .set({ parentUnitId: newParentUnitId, sortOrder: newSortOrder })
            .where(and(eq(inspectionUnits.id, unitId), eq(inspectionUnits.tenantId, tenantId)));
    }

    private async _depthOf(
        db: ReturnType<typeof drizzle>,
        tenantId: string,
        parentUnitId: string | null,
    ): Promise<number> {
        if (!parentUnitId) return 0;
        let depth = 0;
        let cursor: string | null = parentUnitId;
        while (cursor) {
            depth++;
            if (depth > MAX_DEPTH) return depth;
            const row = await db.select().from(inspectionUnits)
                .where(and(eq(inspectionUnits.id, cursor), eq(inspectionUnits.tenantId, tenantId)))
                .get();
            cursor = row?.parentUnitId ?? null;
        }
        return depth;
    }
}
