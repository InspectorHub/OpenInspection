import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { tenants } from '../tenant';

export const comments = sqliteTable('comments', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    text: text('text').notNull(),
    // The repair-item vocabulary (safety / maintenance / recommendation, plus
    // tenant-custom values), read and filtered on by RecommendationService and
    // ranked on by the agent repair-items view. Written only by the comment
    // CRUD; a marketplace pack deliberately writes `section` and leaves this
    // NULL, because a pack's word is a section label and not this vocabulary.
    category: text('category'),
    // Section label (Roof, Electrical, ...) — same shape as canned-comments.js
    // entries. Free-text so tenants can grow their own taxonomy.
    section: text('section'),
    // Sprint 2 S2-7 — provenance for marketplace-imported comments.
    // Set when MarketplaceService.importLibrary inserts rows; null for
    // tenant-authored comments. Used by replace-mode update to delete only
    // prior-import rows, never touching the tenant's own comments.
    libraryId: text('library_id'),
    // The Library drawer's matching aids. All four are READ by the drawer's
    // list query and NONE is written by any path in this repo — create, update
    // and marketplace import all leave them NULL — so on any database this
    // repo populates, every filter below narrows nothing. They are live only
    // for rows loaded from outside the application.
    //
    // JSON array of template section ids the snippet is offered for. Narrowed
    // by the drawer's `sectionId` filter through a LIKE on the QUOTED id, so a
    // section id that is a prefix of another cannot cross-match.
    sectionIds: text('section_ids'),
    // Plural and inert: SELECTed into the list response, but nothing filters,
    // sorts or renders it. The singular `itemLabel` below is the one the
    // drawer actually filters on.
    itemLabels: text('item_labels'),
    // Short code (e.g. 'NI') matched EXACTLY. Like `sectionId`, it is a
    // user-typed filter and applies in both filter modes — unlike `section`
    // and `itemLabel`, which are context-derived and apply only in auto mode.
    triggerCode: text('trigger_code'),
    // Curated synonyms, OR'd with `text` in the drawer's search LIKE so a
    // snippet is findable by words it does not contain. The search is pushed
    // down to SQL, so this also moves the pagination total.
    searchKeywords: text('search_keywords'),
    // Comments Library Upgrade — canonical single item label for the sort
    // + filter UI in the inspection-edit Library drawer. Distinct from the
    // existing plural `itemLabels` which stores all matched labels.
    itemLabel: text('item_label'),
    // Module F single severity vocabulary: 'good' | 'marginal' | 'significant'
    // | 'minor' | null (= uncategorized / "All"). Shared with rating levels
    // (server/lib/validations/rating-system.schema.ts's SeverityEnum).
    severity: text('severity'),
    // Comments-repair fold (2026-06-12): deficiency comments carry repair fields.
    // Intended for severity='significant'; enforced in UI/validation, not DDL.
    //
    // Scope only — no price. A repair estimate carried here reached the report
    // as the inspection company's number, and the product cannot know this
    // property, this trade market, or this week. Money on an inspection is
    // written by the buyer or their agent (see `repair_requests`), never
    // produced by the platform. The former `estimate_min_cents` /
    // `estimate_max_cents` columns were DROPPED for that reason and must not
    // come back; `scripts/check-price-capability.mjs` fails if they do.
    repairSummary:     text('repair_summary'),
    // Soft ref → contractor_types.id (no DB FK per schema rules). Stale ref acceptable.
    recommendedContractorTypeId: text('recommended_contractor_type_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    // When this row was last written by the tenant. Display only: it is what
    // lets the UI say "edited 12 March". It is NOT what decides whether a
    // marketplace re-import may overwrite the row — see `importHash`.
    editedAt: integer('edited_at', { mode: 'timestamp_ms' }),
    // Hash of the text this row carried the moment it arrived from a
    // marketplace pack; NULL for tenant-authored comments, which have no
    // import to differ from.
    //
    // This is the marker that makes "edited" answerable at all. A timestamp
    // alone answers "was this row written to", which is a different and worse
    // question: a row the tenant edited and then changed back is not a
    // conflict, and a write path that forgets to stamp a timestamp silently
    // reports "never edited". Comparing the current text against what was
    // imported answers "does this differ from what we gave them", which is the
    // question a destructive re-import actually needs answered, and it answers
    // it for every write path including ones that predate the marker.
    //
    // Rows imported before this column existed carry NULL and are treated as
    // unedited: nothing was recorded, so nothing can be claimed. See #348.
    importHash: text('import_hash'),
}, (t) => [
    index('idx_comments_tenant').on(t.tenantId),
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
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
}, (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.userId, table.commentId] }),
    userLastUsedIdx: index('idx_comment_usage_user_last_used').on(table.tenantId, table.userId, table.lastUsedAt),
}));
