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
import { nextSortOrder, dedupeDrafts, copyName } from '../lib/unit-bulk';
import type { UnitDraft } from '../lib/unit-pattern';
import type { UnitAttrs } from '../lib/db/schema/units';

const MAX_DEPTH = 3;  // root(0) → building(1) → floor(2) → unit(3)

export interface CreateUnitInput {
    inspectionId: string;
    parentUnitId: string | null;
    kind:         'building' | 'floor' | 'unit';
    type?:        'unit' | 'common';
    name:         string;
}

export interface UnitRow {
    id:           string;
    tenantId:     string;
    inspectionId: string;
    parentUnitId: string | null;
    kind:         string;
    type:         string;
    name:         string;
    sortOrder:    number;
    createdAt:    Date;
    attrs:        UnitAttrs | null;
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
            type:         input.type || 'unit',
            name:         input.name,
            sortOrder:    nextSort,
            createdAt:    new Date(),
        });
        return { id };
    }

    /**
     * Batch-create N unit nodes under one parent (spec §5, the "apartment"
     * bulk-create). Skips labels that would collide with an existing sibling or
     * a duplicate within the batch (dedupeDrafts); sortOrder steps 10 past the
     * current sibling max. floor rides into attrs so the per-unit report can
     * group by floor without a dedicated column.
     */
    async createMany(
        tenantId: string,
        inspectionId: string,
        drafts: UnitDraft[],
        opts?: { parentUnitId?: string | null; kind?: 'building' | 'floor' | 'unit'; type?: 'unit' | 'common' },
    ): Promise<{ ids: string[] }> {
        const db = this.getDrizzle();
        const parentUnitId = opts?.parentUnitId ?? null;
        // Same MAX_DEPTH invariant the single-create path enforces — a bulk
        // insert under a depth-3 parent would otherwise silently create depth-4
        // rows and break the bounded parent-walk assumption.
        const depth = await this._depthOf(db, tenantId, parentUnitId);
        if (depth >= MAX_DEPTH) {
            throw new Error(`Max tree depth (${MAX_DEPTH}) exceeded`);
        }
        const siblings = (await this.list(tenantId, inspectionId))
            .filter((s) => (s.parentUnitId ?? null) === parentUnitId);
        const fresh = dedupeDrafts(siblings.map((s) => s.name), drafts);
        if (!fresh.length) return { ids: [] };
        let sort = nextSortOrder(siblings);
        const rows = fresh.map((d) => {
            const id = crypto.randomUUID();
            const row = {
                id,
                tenantId,
                inspectionId,
                parentUnitId,
                kind: opts?.kind ?? ('unit' as const),
                type: opts?.type ?? ('unit' as const),
                name: d.label,
                sortOrder: sort,
                createdAt: new Date(),
                attrs: (d.floor ? { floor: d.floor } : null) as UnitAttrs | null,
            };
            sort += 10;
            return row;
        });
        // D1 caps bind parameters at 100 per prepared statement; each row binds
        // ~10 columns, so a single VALUES list for a full apartment stack (the
        // default 3×4 = 12 units → 120 params) overflows and D1 rejects it.
        // Chunk the VALUES lists, all chunks inside ONE db.batch() (atomic);
        // drivers without batch (better-sqlite3 unit mock) fall back to
        // sequential chunk inserts — same idiom as contacts-import/starter-content.
        const colsPerRow = Object.keys(rows[0]!).length;
        const maxRowsPerStmt = Math.max(1, Math.floor(100 / colsPerRow));
        const stmts = [];
        for (let i = 0; i < rows.length; i += maxRowsPerStmt) {
            stmts.push(db.insert(inspectionUnits).values(rows.slice(i, i + maxRowsPerStmt)));
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (typeof (db as any).batch === 'function') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (db as any).batch(stmts as [any, ...any[]]);
        } else {
            for (const s of stmts) await s;
        }
        return { ids: rows.map((r) => r.id) };
    }

    /**
     * Duplicate a unit's ATTRIBUTES into a new sibling (spec §5) — NOT its
     * findings. Finding keys are prefixed by the source unit id, so the new
     * unit starts empty by construction; only name/kind/type/parent/attrs clone.
     */
    async duplicate(tenantId: string, unitId: string, inspectionId?: string): Promise<{ id: string }> {
        const db = this.getDrizzle();
        const src = await db.select().from(inspectionUnits)
            .where(and(eq(inspectionUnits.id, unitId), eq(inspectionUnits.tenantId, tenantId)))
            .get();
        // When the caller supplies the inspection scope (the route does), the
        // unit MUST belong to it — otherwise a unit from another inspection could
        // be duplicated through this inspection's URL. Treat a mismatch as
        // not-found so we don't confirm the unit's existence across inspections.
        if (!src || (inspectionId !== undefined && src.inspectionId !== inspectionId)) {
            throw new Error('Unit not found');
        }
        const siblings = (await this.list(tenantId, src.inspectionId))
            .filter((s) => (s.parentUnitId ?? null) === (src.parentUnitId ?? null));
        const id = crypto.randomUUID();
        await db.insert(inspectionUnits).values({
            id,
            tenantId,
            inspectionId: src.inspectionId,
            parentUnitId: src.parentUnitId,
            kind: src.kind,
            type: src.type,
            name: copyName(src.name, siblings.map((s) => s.name)),
            sortOrder: nextSortOrder(siblings),
            createdAt: new Date(),
            attrs: src.attrs ?? null,
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
