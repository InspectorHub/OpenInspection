import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// Authoring unification Plan-4 module K — tenant-scoped, account-editable
// defect categories. Replaces the hard-coded DefectCategory enum. Orthogonal
// to the rating-axis severity: a category carries only name/color/
// drivesSummary/order. No .references() (Schema Rules — app-layer tenant
// filter); booleans are integer-mode; timestamps are timestamp_ms; index
// names are idx_-prefixed.
export const defectCategories = sqliteTable('defect_categories', {
    id:        text('id').primaryKey(),
    tenantId:  text('tenant_id').notNull(),
    name:      text('name').notNull(),
    color:     text('color').notNull().default('#6b7280'),
    // When true, defects in this category are pulled into the report Summary.
    drivesSummary: integer('drives_summary', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    // Seed rows (maintenance/recommendation/safety) — not user-deletable in the UI.
    isSeed:    integer('is_seed', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_defect_categories_tenant').on(t.tenantId),
]);
