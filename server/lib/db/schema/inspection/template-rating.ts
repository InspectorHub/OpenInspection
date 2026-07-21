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
    levels:      text('levels', { mode: 'json' }).notNull(),
    isDefault:   integer('is_default', { mode: 'boolean' }).notNull().default(false),
    isSeed:      integer('is_seed',    { mode: 'boolean' }).notNull().default(false),
    createdAt:   integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt:   integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => ({
    tenantSlugUnique: uniqueIndex('idx_rating_systems_tenant_slug').on(t.tenantId, t.slug),
    tenantIdx:        index('idx_rating_systems_tenant').on(t.tenantId),
}));

export const templates = sqliteTable('templates', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    version: integer('version').notNull().default(1),
    schema: text('schema', { mode: 'json' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    // Sprint 2 S2-1 — selects the active rating system. Null = use tenant default.
    ratingSystemId: text('rating_system_id'),
    propertyType: text('property_type'),
    commercialSubtype: text('commercial_subtype'),
    description: text('description'),
    featured: integer('is_featured', { mode: 'boolean' }).notNull().default(false),
    // Report Style Presets — ties a report type to a default appearance profile.
    // NULL = inherit tenant default. Appended at table end (FK-referenced).
    defaultProfileId: text('default_profile_id'),
}, (t) => [
    index('idx_templates_tenant').on(t.tenantId),
    index('idx_templates_rating_system').on(t.ratingSystemId),
]);
