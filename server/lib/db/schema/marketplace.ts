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
  // Also the only browse axis that is an enum — property_type reuses the
  // template validator's, and the two below are bounded free text. Backed by
  // idx(kind, featured), which serves list()'s featured-then-downloads order.
  // 'statutory' is a 1:1 kind like 'templates' — one catalogue row becomes one
  // local `templates` row — but it is a separate kind rather than a flag on that
  // one, because its import validates with a schema that admits a statutory
  // declaration and its update retires the row it supersedes. Neither is
  // something an ordinary template import should ever do.
  kind:          text('kind', { enum: ['comments', 'templates', 'statutory'] }).notNull(),
  // The catalogue's current version. Never ordered or range-compared, only
  // tested for EQUALITY against tenant_library_imports.imported_semver:
  // unequal is what list() reports as `hasUpdate`, equal is what the update
  // paths refuse. A downgrade therefore reads as an update.
  semver:        text('semver').notNull(),
  // The pack ITSELF, not a description of one: a v2 template document for
  // kind='templates' (validated at import time, never on write) or the entries
  // parseLibraryComments explodes into N rows. list() strips it from every
  // response — ~50KB per row that no client reads.
  schema:        text('schema', { mode: 'json' }).notNull(),
  authorId:      text('author_id').notNull().default('system'),
  // Release note for the entry. Written only by the starter-content seeder;
  // NO READER FOUND in server/ or app/ — nothing renders or returns it.
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
  // Both are exact-match conditions in list() and are reachable only as
  // /api/marketplace query params — the browse page ships no control for
  // either, so today they narrow nothing a user can click.
  jurisdiction:   text('jurisdiction'),
  inspectionKind: text('inspection_kind'),   // exact-match browse filter, reachable only as an API query param

  /**
   * When the platform took this entry out of the browse listing, or null.
   *
   * NOT a delete, and the reason is the same one that makes uninstall a flag:
   * `tenant_library_imports.library_id` points here, so removing the row would
   * orphan every workspace that installed the pack — the update path could no
   * longer find what they are on, and the un-import path could no longer find
   * what to undo. Delisting therefore changes VISIBILITY only. An entry that is
   * delisted disappears from `browseCatalogue` for everyone, which also removes
   * its "update available" badge (that badge is computed inside the same
   * query), and every existing install keeps working untouched.
   *
   * Written only by the platform admin surface (server/portal/), never by a
   * workspace: which entries the catalogue offers is not a tenant's decision.
   */
  delistedAt:     integer('delisted_at', { mode: 'timestamp_ms' }),
}, (t) => [
  index('idx_marketplace_libraries_kind_featured').on(t.kind, t.featured),
]);

export const tenantLibraryImports = sqliteTable('tenant_library_imports', {
  id:             text('id').primaryKey(),
  tenantId:       text('tenant_id').notNull(),
  libraryId:      text('library_id').notNull(),
  // The catalogue semver this tenant is currently ON. Re-pointed in place by
  // every update, so it is a position and never a history. Its whole job is the
  // equality test against marketplace_libraries.semver: unequal raises the
  // "update available" badge, equal makes both update paths throw.
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

  /**
   * When this workspace uninstalled the entry, or null.
   *
   * The row is kept rather than deleted: it records which version this
   * workspace was ON, and re-issuing a report produced back then is expected to
   * keep working. The unique index above is on (tenant_id, library_id), so with
   * the row kept there is exactly one way back in, and it is `importCatalogEntry`
   * — which, finding a marker in this state, clears it rather than returning
   * early. At the same version that means un-retiring the local row this
   * un-install retired; when the catalogue has moved on it takes the update
   * path's shape instead, minting the current version and retiring the old row,
   * because reinstating a superseded statutory revision is precisely the trap
   * `templates.retired_at` exists to close.
   *
   * ⚠️ Every reader of this column must exclude uninstalled markers explicitly.
   * A query that asks only "is there a marker" reports every pack a workspace
   * ever had as installed — `browseCatalogue` did, and offered updates for packs
   * nobody had.
   *
   * ⚠️ Un-installing changes VISIBILITY, never content. Nothing on this path
   * deletes a local template (a legacy foreign key from inspections.template_id
   * forbids it, and the snapshot makes it unnecessary) and nothing deletes the
   * shared `_platform/` form bytes, which other tenants read.
   */
  uninstalledAt: integer('uninstalled_at', { mode: 'timestamp_ms' }),
}, (t) => [
  uniqueIndex('uq_tenant_library_import').on(t.tenantId, t.libraryId),
]);

// Sprint 2 Track 3 (S2-8) — per-import history. One row per
// install/update/replace event, indexed for fast tenant scoping
// and per-resource (template / library) lookups.
export const tenantMarketplaceImportHistory = sqliteTable('tenant_marketplace_import_history', {
  id:            text('id').primaryKey(),
  tenantId:      text('tenant_id').notNull(),
  libraryId:     text('library_id'),
  templateId:    text('template_id'),
  // 'install' | 'update' | 'replace'
  action:        text('action').notNull(),
  // The semver the tenant moved FROM / TO. source is NULL for 'install' —
  // there was nothing to move from.
  sourceVersion: text('source_version'),
  targetVersion: text('target_version'),
  rowsAffected:  integer('rows_affected').notNull().default(0),
  // JSON-encoded action-specific context (deleted ids, migration counts, …).
  // Stored as TEXT so we can keep parity with raw SQL inserts in tests.
  metadata:      text('metadata'),
  createdAt:     integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  // The JWT sub of whoever caused the event — but only the library replace
  // route actually passes one. Install and plain update call the service with
  // no userId, so their rows carry the literal 'system': a 'system' value means
  // "the route did not say", not "no human did it".
  createdBy:     text('created_by').notNull(),
}, (t) => [
  index('idx_marketplace_history_tenant').on(t.tenantId, t.createdAt),
  index('idx_marketplace_history_template').on(t.templateId),
  index('idx_marketplace_history_library').on(t.libraryId),
]);
