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
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const inspectionUnits = sqliteTable('inspection_units', {
    id:           text('id').primaryKey(),
    tenantId:     text('tenant_id').notNull(),
    inspectionId: text('inspection_id').notNull(),
    parentUnitId: text('parent_unit_id'),
    kind:         text('kind', { enum: ['building', 'floor', 'unit'] }).notNull(),
    type:         text('type', { enum: ['unit', 'common'] }).notNull().default('unit'),
    name:         text('name').notNull(),
    sortOrder:    integer('sort_order').notNull().default(0),
    createdAt:    text('created_at').notNull(),
});
