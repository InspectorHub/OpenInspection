import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const marketplaceTemplates = sqliteTable('marketplace_templates', {
  id:            text('id').primaryKey(),
  name:          text('name').notNull(),
  category:      text('category').notNull(),
  semver:        text('semver').notNull(),
  schema:        text('schema', { mode: 'json' }).notNull(),
  authorId:      text('author_id').notNull().default('system'),
  changelog:     text('changelog'),
  downloadCount: integer('download_count').notNull().default(0),
  featured:      integer('featured', { mode: 'boolean' }).notNull().default(false),
  createdAt:     text('created_at').notNull(),
  updatedAt:     text('updated_at').notNull(),
});

export const tenantMarketplaceImports = sqliteTable('tenant_marketplace_imports', {
  id:                    text('id').primaryKey(),
  tenantId:              text('tenant_id').notNull(),
  marketplaceTemplateId: text('marketplace_template_id').notNull().references(() => marketplaceTemplates.id),
  importedSemver:        text('imported_semver').notNull(),
  localTemplateId:       text('local_template_id').notNull(),
  importedAt:            text('imported_at').notNull(),
});

// Spec 5G M2 — sibling table for non-template marketplace content
// (comment libraries, snippet packs, …). Avoids the legacy CHECK
// constraint + FK complexity of marketplace_templates.
export const marketplaceLibraries = sqliteTable('marketplace_libraries', {
  id:            text('id').primaryKey(),
  name:          text('name').notNull(),
  kind:          text('kind', { enum: ['comments', 'snippets'] }).notNull(),
  semver:        text('semver').notNull(),
  schema:        text('schema', { mode: 'json' }).notNull(),
  authorId:      text('author_id').notNull().default('system'),
  changelog:     text('changelog'),
  downloadCount: integer('download_count').notNull().default(0),
  featured:      integer('featured', { mode: 'boolean' }).notNull().default(false),
  createdAt:     text('created_at').notNull(),
  updatedAt:     text('updated_at').notNull(),
});

export const tenantLibraryImports = sqliteTable('tenant_library_imports', {
  id:             text('id').primaryKey(),
  tenantId:       text('tenant_id').notNull(),
  libraryId:      text('library_id').notNull(),
  importedSemver: text('imported_semver').notNull(),
  importedAt:     text('imported_at').notNull(),
  rowCount:       integer('row_count').notNull().default(0),
});
