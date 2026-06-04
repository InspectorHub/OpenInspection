import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';

/**
 * Inspection sync conflicts (Tasks 12-14 of typed-hono-dead-routes-cleanup).
 *
 * Field-level merge conflicts detected by `inspection-sync.ts` (diff3 notes
 * collisions) are persisted here BEFORE the 409 is returned, so the
 * conflict-resolver UI can re-fetch the current pending set via
 * GET /api/inspections/:id/conflicts instead of relying on the transient 409
 * body. A conflict is "pending" while `resolved_at` IS NULL; resolving it
 * deletes the row (see conflicts.service.resolveConflicts).
 *
 * The diff3 `MergeConflict` shape is { itemId, field:'notes', base, ours,
 * theirs } — `ours` maps to `local`, `theirs` maps to `remote`, and there is
 * no per-conflict sectionId (notes are item-level), so `section_id` is null
 * for the diff3 producer but kept nullable for future field producers.
 */
export const inspectionConflicts = sqliteTable('inspection_conflicts', {
    id:           text('id').primaryKey(),
    // A-17 — physical tenant isolation. Previously this was the only tenant-data
    // table without tenant_id (guarded solely by the callers' inspection-ownership
    // pre-check); every query now filters on it directly.
    tenantId:     text('tenant_id').notNull(),
    inspectionId: text('inspection_id').notNull(),
    itemId:       text('item_id').notNull(),
    sectionId:    text('section_id'),
    field:        text('field').notNull(),
    base:         text('base'),
    local:        text('local'),
    remote:       text('remote'),
    createdAt:    text('created_at').notNull(),
    resolvedAt:   text('resolved_at'),
}, (t) => ({
    byInspection: index('idx_inspection_conflicts_inspection').on(t.inspectionId, t.resolvedAt),
}));
