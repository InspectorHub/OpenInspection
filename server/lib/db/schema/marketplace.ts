import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

// The legacy `marketplace_templates` / `tenant_marketplace_imports` pair was
// retired here (#293). Its 12 rows moved onto marketplace_libraries as
// kind='templates' and the import table was 0 rows, so there was no history to
// preserve. Dropping the child also removed the only FK pointing INTO
// `templates`, which D1 makes a permanent migration liability.

// The single marketplace catalogue. Every importable kind lives here, keyed by
// `kind`: a 1:1 kind ('templates' — one catalogue row becomes one local
// `templates` row) and a 1:N kind ('comments' — one pack becomes N tagged
// `comments` rows) share one table, one browse query and one import path.
//
// `kind` is the only thing that decides which local table an import writes and
// how an un-import undoes it. Adding a kind means adding both halves; there is
// no generic fallthrough, because a silent one is how the wrong table gets
// written. See #293.
export const marketplaceLibraries = sqliteTable('marketplace_libraries', {
  id:            text('id').primaryKey(),
  name:          text('name').notNull(),
  kind:          text('kind', { enum: ['comments', 'templates'] }).notNull(),
  semver:        text('semver').notNull(),
  schema:        text('schema', { mode: 'json' }).notNull(),
  authorId:      text('author_id').notNull().default('system'),
  changelog:     text('changelog'),
  downloadCount: integer('download_count').notNull().default(0),
  featured:      integer('is_featured', { mode: 'boolean' }).notNull().default(false),
  createdAt:     integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt:     integer('updated_at', { mode: 'timestamp_ms' }).notNull(),

  // The legacy `category` did not survive as one column. It was free text
  // mixing three independent concepts (a property type / a jurisdiction's form
  // standard / an inspection kind), so a single column could only ever describe
  // one of the three: a Texas inspector looking for the TREC form and a
  // new-build buyer looking for a new-construction template are not asking
  // about a property type, and neither could be expressed alongside one.
  //
  // property_type reuses the template validator's enum verbatim
  // (server/lib/validations/template.schema.ts) because a catalogue template
  // exists to BECOME a local `templates` row — a second vocabulary here could
  // not survive the import. All three are NULL for non-template kinds, and
  // property_type is nullable even for templates: a row may genuinely not
  // commit to one.
  propertyType:   text('property_type'),
  jurisdiction:   text('jurisdiction'),
  inspectionKind: text('inspection_kind'),
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

  // An import produces ONE local row for a 1:1 kind (templates, tracked by this
  // id) or N tagged rows for a 1:N kind (comments, tracked by row_count). A kind
  // is one or the other, and un-import branches on that: deleting a template's
  // local row is not the same operation as deleting 248 tagged comments, and one
  // table pretending otherwise is how one of them gets it wrong. NULL for the
  // 1:N kinds, where row_count is the tracking value instead. See #293.
  localEntityId: text('local_entity_id'),
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
