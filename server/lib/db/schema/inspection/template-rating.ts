import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { tenants } from '../tenant';

// Sprint 2 S2-1 — tenant-scoped rating systems library. The level list
// itself is stored as JSON because it is never queried independently and
// the row count per system is tiny (≤ 10).
export const ratingSystems = sqliteTable('rating_systems', {
    id:          text('id').primaryKey(),
    tenantId:    text('tenant_id').notNull().references(() => tenants.id),
    name:        text('name').notNull(),
    slug:        text('slug').notNull(),
    description: text('description'),
    // The ordered RatingLevel array (id / abbreviation / label / color /
    // severity / isDefect / order). Readers must go through RatingSystemService:
    // it re-sorts by `order` and tolerates a raw string, and an unparseable
    // value degrades to an EMPTY list rather than throwing. `id`, `label` and
    // `abbreviation` are all matched by the findings analytics, which keys its
    // columns off them — renaming a level moves a report's numbers.
    levels:      text('levels', { mode: 'json' }).notNull(),
    isDefault:   integer('is_default', { mode: 'boolean' }).notNull().default(false),
    isSeed:      integer('is_seed',    { mode: 'boolean' }).notNull().default(false),
    createdAt:   integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt:   integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => ({
    tenantSlugUnique: uniqueIndex('idx_rating_systems_tenant_slug').on(t.tenantId, t.slug),
}));

export const templates = sqliteTable('templates', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    version: integer('version').notNull().default(1),
    // The LIVE authoring structure (TemplateSchemaV2 — sections, items, rating
    // system, applicability), revalidated on every save. It is not what any
    // report renders: an inspection freezes its own snapshot at creation, and
    // reading this column instead would silently re-derive a published report
    // from today's template. `server/services/inspection/shared.ts` is the only
    // sanctioned way to read an inspection's structure and never falls back here.
    schema: text('schema', { mode: 'json' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    // Sprint 2 S2-1 — selects the active rating system. Null = use tenant default.
    ratingSystemId: text('rating_system_id'),
    // MIRRORS of `schema.propertyType` / `schema.commercialSubtype`, recomputed
    // by deriveTemplateMirrorColumns on every create and every schema-bearing
    // update — the schema is the source of truth, these can never be edited
    // apart from it, and the subtype is forced NULL unless the type is
    // 'commercial'. NULL = the template declares no property type.
    // ⚠️ No reader found: nothing in server/ or app/ selects or filters on
    // either column today. They exist so the filter can be an indexable column
    // rather than a JSON scan; until something queries them they are write-only.
    propertyType: text('property_type'),
    commercialSubtype: text('commercial_subtype'),   // forced NULL unless propertyType is 'commercial'; no reader either
    description: text('description'),
    featured: integer('is_featured', { mode: 'boolean' }).notNull().default(false),
    // Report Style Presets — ties a report type to a default appearance profile.
    // NULL = inherit tenant default. Appended at table end (FK-referenced).
    defaultProfileId: text('default_profile_id'),
}, (t) => [
    index('idx_templates_tenant').on(t.tenantId),
    index('idx_templates_rating_system').on(t.ratingSystemId),
]);
