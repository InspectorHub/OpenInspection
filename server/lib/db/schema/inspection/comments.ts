import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { tenants } from '../tenant';

export const comments = sqliteTable('comments', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    text: text('text').notNull(),
    category: text('category'),
    // Spec 2026-05-07 — rating bucket so user snippets stack alongside the
    // 248 seeded library entries in the inspection-edit Library drawer.
    // 'satisfactory' | 'monitor' | 'defect' | null (= uncategorized / "All")
    ratingBucket: text('rating_bucket'),
    // Section label (Roof, Electrical, ...) — same shape as canned-comments.js
    // entries. Free-text so tenants can grow their own taxonomy.
    section: text('section'),
    // Sprint 2 S2-7 — provenance for marketplace-imported comments.
    // Set when MarketplaceService.importLibrary inserts rows; null for
    // tenant-authored comments. Used by replace-mode update to delete only
    // prior-import rows, never touching the tenant's own comments.
    libraryId: text('library_id'),
    sectionIds: text('section_ids'),
    itemLabels: text('item_labels'),
    triggerCode: text('trigger_code'),
    searchKeywords: text('search_keywords'),
    // Comments Library Upgrade — canonical single item label for the sort
    // + filter UI in the inspection-edit Library drawer. Distinct from the
    // existing plural `itemLabels` which stores all matched labels.
    itemLabel: text('item_label'),
    severity: text('severity'),
    // Comments-repair fold (2026-06-12): deficiency comments carry repair fields.
    // Intended for rating_bucket='defect'; enforced in UI/validation, not DDL.
    repairSummary:     text('repair_summary'),
    estimateMinCents:  integer('estimate_min_cents'),
    estimateMaxCents:  integer('estimate_max_cents'),
    // Soft ref → contractor_types.id (no DB FK per schema rules). Stale ref acceptable.
    recommendedContractorTypeId: text('recommended_contractor_type_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
    index('idx_comments_tenant').on(t.tenantId),
    index('idx_comments_rating_bucket').on(t.tenantId, t.ratingBucket),
    index('idx_comments_library_id').on(t.libraryId),
]);

// Comments Library Upgrade — per-user usage tracking. Drives the "most-used by
// you" sort option + AUTO filter mode in the Library drawer. Composite PK on
// (tenant, user, comment) gives O(1) upsert per touch.
export const commentUsage = sqliteTable('comment_usage', {
    tenantId:   text('tenant_id').notNull(),
    userId:     text('user_id').notNull(),
    commentId:  text('comment_id').notNull().references(() => comments.id, { onDelete: 'cascade' }),
    useCount:   integer('use_count').notNull().default(0),
    lastUsedAt: integer('last_used_at'),
}, (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.userId, table.commentId] }),
    userLastUsedIdx: index('idx_comment_usage_user_last_used').on(table.tenantId, table.userId, table.lastUsedAt),
}));
