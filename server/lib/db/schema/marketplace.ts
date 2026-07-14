import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { templates } from './inspection';

export const marketplaceTemplates = sqliteTable('marketplace_templates', {
  id:            text('id').primaryKey(),
  name:          text('name').notNull(),
  category:      text('category').notNull(),
  semver:        text('semver').notNull(),
  schema:        text('schema', { mode: 'json' }).notNull(),
  authorId:      text('author_id').notNull().default('system'),
  changelog:     text('changelog'),
  downloadCount: integer('download_count').notNull().default(0),
  featured:      integer('is_featured', { mode: 'boolean' }).notNull().default(false),
  createdAt:     integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt:     integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const tenantMarketplaceImports = sqliteTable('tenant_marketplace_imports', {
  id:                    text('id').primaryKey(),
  tenantId:              text('tenant_id').notNull(),
  marketplaceTemplateId: text('marketplace_template_id').notNull().references(() => marketplaceTemplates.id),
  importedSemver:        text('imported_semver').notNull(),
  localTemplateId:       text('local_template_id').notNull().references(() => templates.id),
  importedAt:            integer('imported_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
  index('idx_mkt_imports_tmpl').on(t.marketplaceTemplateId),
  index('idx_mkt_imports_tenant').on(t.tenantId),
]);

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
  featured:      integer('is_featured', { mode: 'boolean' }).notNull().default(false),
  createdAt:     integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt:     integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
  index('idx_marketplace_libraries_kind_featured').on(t.kind, t.featured),
]);

export const tenantLibraryImports = sqliteTable('tenant_library_imports', {
  id:             text('id').primaryKey(),
  tenantId:       text('tenant_id').notNull(),
  libraryId:      text('library_id').notNull(),
  importedSemver: text('imported_semver').notNull(),
  importedAt:     integer('imported_at', { mode: 'timestamp_ms' }).notNull(),
  rowCount:       integer('row_count').notNull().default(0),
}, (t) => [
  uniqueIndex('uq_tenant_library_import').on(t.tenantId, t.libraryId),
  index('idx_tenant_library_imports_tenant').on(t.tenantId),
]);

// Sprint 2 Track 3 (S2-8) — per-import history. One row per
// install/update/replace/migrate event, indexed for fast tenant scoping
// and per-resource (template / library) lookups.
export const tenantMarketplaceImportHistory = sqliteTable('tenant_marketplace_import_history', {
  id:            text('id').primaryKey(),
  tenantId:      text('tenant_id').notNull(),
  libraryId:     text('library_id'),
  templateId:    text('template_id'),
  // 'install' | 'update' | 'replace' | 'migrate'
  action:        text('action').notNull(),
  sourceVersion: text('source_version'),
  targetVersion: text('target_version'),
  rowsAffected:  integer('rows_affected').notNull().default(0),
  // JSON-encoded action-specific context (deleted ids, migration counts, …).
  // Stored as TEXT so we can keep parity with raw SQL inserts in tests.
  metadata:      text('metadata'),
  createdAt:     integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  createdBy:     text('created_by').notNull(),
}, (t) => [
  index('idx_marketplace_history_tenant').on(t.tenantId, t.createdAt),
  index('idx_marketplace_history_template').on(t.templateId),
  index('idx_marketplace_history_library').on(t.libraryId),
]);
