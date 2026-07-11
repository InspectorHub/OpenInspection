/**
 * Design System 0520 subsystem D phase 1 — UnitTree hierarchy.
 *
 * One row per Building / Floor / Unit node in a multi-unit inspection
 * (hotel, apartment complex, commercial). Parent pointers materialise
 * the tree; depth ≤ 3 enforced at the service layer (UnitService.create).
 *
 * Items inside inspection_results.data[itemId] gain an optional unitId
 * pointer so the editor + report can scope rendering by unit. Existing
 * residential inspections (no units) render exactly as today — no
 * schema migration of legacy rows needed.
 */
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const inspectionUnits = sqliteTable('inspection_units', {
    id:           text('id').primaryKey(),
    tenantId:     text('tenant_id').notNull(),
    inspectionId: text('inspection_id').notNull(),
    parentUnitId: text('parent_unit_id'),
    kind:         text('kind', { enum: ['building', 'floor', 'unit'] }).notNull(),
    type:         text('type', { enum: ['unit', 'common'] }).notNull().default('unit'),
    name:         text('name').notNull(),
    sortOrder:    integer('sort_order').notNull().default(0),
    createdAt:    text('created_at').notNull().default(sql`(datetime('now'))`),
    // Commercial PCA Phase F — optional building/floor/unit-level attributes
    // (e.g. primaryUse, yearBuilt, area, areaUom, stories for a 'building'
    // node). Rides here instead of a parallel `buildings` table: the building_id
    // referenced by later phases (cost items, multi-instance systems) is this
    // row's id. See the commercial-pca-report-foundation design spec §3.1.
    attrs:        text('attrs', { mode: 'json' }).$type<UnitAttrs>(),
}, (t) => [
    index('idx_inspection_units_tenant_inspection').on(t.tenantId, t.inspectionId),
    index('idx_inspection_units_parent').on(t.parentUnitId),
]);

/**
 * Commercial PCA (Phase U / Phase F §3.1) — optional per-node attributes on the
 * shared `attrs` JSON column (the column itself is created by Phase F Task 1).
 * Unit nodes (kind='unit') carry unit_type/floor/occupied; building nodes
 * (kind='building') carry the Phase F building profile.
 */
export interface UnitAttrs {
    unitType?: string | null;
    floor?: string | null;
    occupied?: boolean | null;
    primaryUse?: string | null;
    yearBuilt?: number | null;
    area?: number | null;
    areaUom?: string | null;
    stories?: number | null;
}

/** Drop empty/unknown values so we never persist noise into the JSON blob. */
export function normalizeUnitAttrs(input: Partial<UnitAttrs> | null | undefined): UnitAttrs {
    if (!input) return {};
    const out: UnitAttrs = {};
    if (input.unitType) out.unitType = input.unitType;
    if (input.floor) out.floor = input.floor;
    if (typeof input.occupied === 'boolean') out.occupied = input.occupied;
    if (input.primaryUse) out.primaryUse = input.primaryUse;
    if (typeof input.yearBuilt === 'number') out.yearBuilt = input.yearBuilt;
    if (typeof input.area === 'number') out.area = input.area;
    if (input.areaUom) out.areaUom = input.areaUom;
    if (typeof input.stories === 'number') out.stories = input.stories;
    return out;
}
