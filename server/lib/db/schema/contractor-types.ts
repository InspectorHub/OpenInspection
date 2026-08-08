import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// Comments-repair fold (2026-06-12) — tenant-scoped, customizable list of
// recommended contractor types (e.g. "Licensed Electrician"). No .references()
// per schema rules; tenant filtering is enforced at the application layer.
export const contractorTypes = sqliteTable('contractor_types', {
    id:        text('id').primaryKey(),
    tenantId:  text('tenant_id').notNull(),
    name:      text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    /**
     * Soft link to the immutable trade vocabulary in
     * `server/types/defect-fields.ts` (see #277).
     *
     * WHY A SECOND KEY WHEN `name` IS ALREADY HERE. `name` is free text a tenant
     * may rename at will — "Licensed Electrician" becomes "Our Sparky" — and the
     * mapping to the canonical trade is lost the moment they do. The slug
     * survives the rename, so a defect tagged with a trade still resolves to the
     * contractor type the workspace actually uses.
     *
     * NULL is a valid and PERMANENT state, not a backfill gap: a tenant-created
     * type ("Foundation Specialist") has no counterpart in the canonical list,
     * and a tenant who renamed a seeded type before this column existed cannot
     * be matched by name. Both correctly stay NULL.
     *
     * ⚠️ NOT unconditionally unique per tenant, and it must never become so.
     * SQLite treats NULLs as distinct, so a plain unique index would permit
     * unlimited NULL rows while silently doing nothing for them — and the rows
     * that legitimately share NULL are exactly the tenant-created ones. Any
     * uniqueness here has to be a PARTIAL index over non-NULL slugs.
     */
    tradeSlug: text('trade_slug'),
}, (t) => [
    index('idx_contractor_types_tenant').on(t.tenantId),
]);
