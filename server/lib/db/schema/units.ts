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
    attrs:        text('attrs', { mode: 'json' }).$type<Record<string, unknown>>(),
}, (t) => [
    index('idx_inspection_units_tenant_inspection').on(t.tenantId, t.inspectionId),
    index('idx_inspection_units_parent').on(t.parentUnitId),
]);
