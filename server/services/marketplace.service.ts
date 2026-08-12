import { drizzle } from 'drizzle-orm/d1';
import { eq, like, and, desc, sql } from 'drizzle-orm';
import { escapeLikePattern } from '../lib/db/like-escape';
import {
    marketplaceLibraries,
    tenantLibraryImports,
    tenantMarketplaceImportHistory,
} from '../lib/db/schema/marketplace';
import { templates, comments } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { TemplateService } from './template.service';

/**
 * Sprint 2 S2-7 — Library update mode. Append (default, legacy behavior) keeps
 * old rows alongside new. Replace deletes the prior import's rows first then
 * inserts the new pack.
 */
type LibraryUpdateMode = 'append' | 'replace';

export interface UpdateLibraryImportOptions {
    mode?: LibraryUpdateMode;
    /** Acknowledged by caller that user-modified rows will be lost. */
    confirmLossOfEdits?: boolean;
    /** User id for the history row (S2-8). Defaults to 'system'. */
    userId?: string;
}

export interface UpdateLibraryImportResult {
    rowsAdded: number;
    rowsDeleted: number;
    fromSemver: string;
    toSemver: string;
    libraryName: string;
    mode: LibraryUpdateMode;
}

export class MarketplaceService {
  private db: ReturnType<typeof drizzle>;
  private rawDb: D1Database;
  private tenantId: string;

  constructor(db: D1Database, tenantId: string) {
    this.db = drizzle(db);
    this.rawDb = db;
    this.tenantId = tenantId;
  }

  /**
   * Browse the one catalogue. Every importable kind is in `marketplace_libraries`
   * and is reached through this method — there is no second query path, which is
   * the point: the two mechanisms that used to sit behind one page returned
   * different shapes from different tables and only one of them was ever wired
   * to a UI.
   *
   * The three axes filter independently, because a jurisdiction's form standard
   * and an inspection kind are not property types and the legacy single
   * `category` column could only describe one of the three at a time.
   */
  async list(opts: {
    search?: string;
    kind?: 'comments' | 'templates';
    propertyType?: string;
    jurisdiction?: string;
    inspectionKind?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { search = '', page = 1, pageSize = 50 } = opts;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (opts.kind)           conditions.push(eq(marketplaceLibraries.kind, opts.kind));
    if (opts.propertyType)   conditions.push(eq(marketplaceLibraries.propertyType, opts.propertyType));
    if (opts.jurisdiction)   conditions.push(eq(marketplaceLibraries.jurisdiction, opts.jurisdiction));
    if (opts.inspectionKind) conditions.push(eq(marketplaceLibraries.inspectionKind, opts.inspectionKind));
    if (search)              conditions.push(like(marketplaceLibraries.name, `%${escapeLikePattern(search)}%`));
    const where = conditions.length ? and(...conditions) : undefined;

    const totalRow = await this.db
      .select({ c: sql<number>`count(*)` })
      .from(marketplaceLibraries)
      .where(where)
      .get();
    const total = totalRow?.c ?? 0;

    // Featured entries always sort first; within tier, sort by download count.
    const rawRows = await this.db
      .select()
      .from(marketplaceLibraries)
      .where(where)
      .orderBy(desc(marketplaceLibraries.featured), desc(marketplaceLibraries.downloadCount))
      .limit(pageSize)
      .offset(offset);

    const imports = await this.db
      .select({
        libraryId:      tenantLibraryImports.libraryId,
        importedSemver: tenantLibraryImports.importedSemver,
      })
      .from(tenantLibraryImports)
      .where(eq(tenantLibraryImports.tenantId, this.tenantId));

    const importMap = new Map(imports.map(i => [i.libraryId, i.importedSemver]));

    const rows = rawRows.map(l => ({
      ...l,
      importedSemver: importMap.get(l.id) ?? null,
      hasUpdate: importMap.has(l.id) && importMap.get(l.id) !== l.semver,
      itemCount: countLibrarySchemaItems(l.schema as unknown),
    }));

    return { rows, total };
  }

  /**
   * Sprint 2 S2-8 — write one row to tenant_marketplace_import_history.
   * Never throws; swallows + logs so audit failure cannot break imports.
   */
  private async writeHistory(input: {
    templateId?: string | null;
    libraryId?: string | null;
    action: 'install' | 'update' | 'replace' | 'migrate';
    sourceVersion?: string | null;
    targetVersion?: string | null;
    rowsAffected: number;
    metadata?: Record<string, unknown>;
    userId: string;
  }): Promise<void> {
    try {
      await this.db.insert(tenantMarketplaceImportHistory).values({
        id:            crypto.randomUUID(),
        tenantId:      this.tenantId,
        templateId:    input.templateId ?? null,
        libraryId:     input.libraryId ?? null,
        action:        input.action,
        sourceVersion: input.sourceVersion ?? null,
        targetVersion: input.targetVersion ?? null,
        rowsAffected:  input.rowsAffected,
        metadata:      input.metadata ? JSON.stringify(input.metadata) : null,
        createdAt:     new Date(),
        createdBy:     input.userId,
      }).run();
    } catch (err) {
      logger.error('[marketplace] history insert failed', {
        tenantId: this.tenantId, action: input.action,
      }, err instanceof Error ? err : undefined);
    }
  }

  /**
   * Gate a marketplace template's schema on v2 validation. Re-wraps the
   * "schema invalid" failure as a BadRequest with launch-friendly copy;
   * re-throws anything else untouched.
   */
  private assertV2Schema(schema: unknown): void {
    try {
      new TemplateService(this.rawDb).validateSchema(schema as string | Record<string, unknown>);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Template schema invalid')) {
        throw Errors.BadRequest('Invalid template schema (must be v2): ' + err.message);
      }
      throw err;
    }
  }

  /**
   * Chunked bulk INSERT of canned-comment rows. Raw SQL with a placeholder
   * list is one statement per chunk — dramatically faster than N individual
   * inserts. D1 caps SQL statement size and bound-parameter count, so chunk to
   * 25 rows (25 × 6 = 150 placeholders, well under D1 limits).
   *
   * @param firstId When supplied, the very first inserted row uses this id
   *   instead of a fresh UUID (lets the caller return a stable local id).
   * @returns The number of rows inserted.
   */
  private async insertLibraryComments(
    libraryId: string,
    entries: Array<{ text: string; section?: string }>,
    firstId?: string,
  ): Promise<number> {
    const CHUNK = 25;
    // comments.created_at is timestamp_ms (Schema Rules) — epoch MILLISECONDS.
    // An earlier version of this line bound a floored-to-whole-seconds value
    // into this column; rows it wrote carry a seconds-magnitude number in a ms
    // column (they read as ~1970). That value is exactly recoverable — it is
    // 1000x too small — so a backfill for pre-existing rows is a mechanical
    // follow-up, not data loss; it just isn't run here (see the report for why
    // this pass is forward-only).
    const nowMs = Date.now();
    let inserted = 0;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const batch = entries.slice(i, i + CHUNK);
      const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const params: (string | number | null)[] = [];
      for (let j = 0; j < batch.length; j++) {
        const c = batch[j];
        const isFirst = i === 0 && j === 0;
        params.push(
          isFirst && firstId ? firstId : crypto.randomUUID(),
          this.tenantId,
          c.text,
          c.section ?? null,
          libraryId,             // S2-7 — provenance for replace mode
          nowMs,
        );
      }
      // `section` (not `category`) — `entries` never carries a category, only
      // text + section (see parseLibraryComments below). Pre-existing imported
      // rows have this backwards (section text landed in `category`, and
      // `section` was never written); that is a separate, deliberately
      // forward-only data-quality issue — see the release report — because
      // `category` is a real, independently-read column elsewhere (repair-item
      // comments' safety/maintenance/recommendation vocabulary,
      // RecommendationService) and this fix does not touch it.
      const stmt = `INSERT INTO comments (id, tenant_id, text, section, library_id, created_at) VALUES ${placeholders}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.rawDb as any).prepare(stmt).bind(...params).run();
      inserted += batch.length;
    }
    return inserted;
  }

  /**
   * The one import path, for every kind (#293).
   *
   * Branches on `kind` because the two shapes are genuinely different
   * operations, not two flavours of one:
   *
   *   'templates' (1:1) — one catalogue row becomes ONE local `templates` row,
   *                       tracked by that row's id in `local_entity_id`.
   *   'comments'  (1:N) — one pack becomes N `comments` rows tagged with the
   *                       catalogue id, tracked by `row_count`.
   *
   * There is no third kind and no generic fallthrough: writing the comments
   * table because a kind was unrecognised is precisely the failure the branch
   * exists to prevent.
   */
  async importCatalogEntry(catalogId: string, userId: string = 'system'): Promise<{
    kind: 'comments' | 'templates';
    localEntityId: string | null;
    rowCount: number;
  }> {
    const [entry] = await this.db
      .select()
      .from(marketplaceLibraries)
      .where(eq(marketplaceLibraries.id, catalogId))
      .limit(1);

    if (!entry) throw new Error('Marketplace entry not found');

    // Idempotent: a second import returns what the first one produced. It
    // returns the LOCAL content id, never the marker row's own id — the marker
    // id is not a handle on anything a caller can use.
    const [existing] = await this.db
      .select()
      .from(tenantLibraryImports)
      .where(and(
        eq(tenantLibraryImports.tenantId, this.tenantId),
        eq(tenantLibraryImports.libraryId, catalogId),
      ))
      .limit(1);

    if (existing) {
      return {
        kind:          entry.kind,
        localEntityId: existing.localEntityId,
        rowCount:      existing.rowCount,
      };
    }

    const now = new Date();
    let rowCount = 0;
    let localEntityId: string | null = null;

    if (entry.kind === 'templates') {
      // Spec 5B P3 — gate imports on v2 schema validation. The catalogue can
      // technically host any JSON; without this check a v1 (legacy
      // `type: 'rating'`) template would leak into a tenant and break the editor.
      this.assertV2Schema(entry.schema);

      localEntityId = crypto.randomUUID();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this.db.insert(templates as any).values({
        id:        localEntityId,
        tenantId:  this.tenantId,
        name:      entry.name,
        schema:    entry.schema,
        createdAt: now,
      });
    } else if (entry.kind === 'comments') {
      const entries = parseLibraryComments(entry.schema);
      rowCount = await this.insertLibraryComments(catalogId, entries);
    } else {
      throw new Error(`Catalogue kind '${String(entry.kind)}' is not importable`);
    }

    await this.db.insert(tenantLibraryImports).values({
      id:             crypto.randomUUID(),
      tenantId:       this.tenantId,
      libraryId:      catalogId,
      importedSemver: entry.semver,
      importedAt:     now,
      rowCount,
      localEntityId,
    });

    await this.db
      .update(marketplaceLibraries)
      .set({ downloadCount: sql`${marketplaceLibraries.downloadCount} + 1`, updatedAt: now })
      .where(eq(marketplaceLibraries.id, catalogId));

    await this.writeHistory({
      templateId:    entry.kind === 'templates' ? localEntityId : null,
      libraryId:     catalogId,
      action:        'install',
      sourceVersion: null,
      targetVersion: entry.semver,
      rowsAffected:  entry.kind === 'templates' ? 1 : rowCount,
      metadata:      { name: entry.name, kind: entry.kind },
      userId,
    });

    return { kind: entry.kind, localEntityId, rowCount };
  }

  /**
   * Round 37 — "Update available" flow. Scheme 2: keep the old local
   * template untouched (preserves any inspector edits / live inspections
   * that reference it) and create a NEW local copy at the new semver,
   * then re-point the import marker. The inspector can then compare
   * side-by-side, migrate inspections manually, or delete the stale copy
   * when satisfied.
   *
   * Throws Errors.BadRequest if no import row exists or the marketplace
   * version has not advanced past the imported semver.
   */
  async updateTemplateImport(marketplaceId: string, userId: string = 'system'): Promise<{
    newLocalId: string;
    newName: string;
    fromSemver: string;
    toSemver: string;
    oldLocalId: string | null;
  }> {
    const [mkt] = await this.db
      .select()
      .from(marketplaceLibraries)
      .where(eq(marketplaceLibraries.id, marketplaceId))
      .limit(1);

    if (!mkt) throw Errors.NotFound('Marketplace template not found');

    // A 1:N kind has no single local row to re-point, so this path would
    // silently create a template out of a comment pack's schema.
    if (mkt.kind !== 'templates') {
      throw Errors.BadRequest(`Catalogue entry '${mkt.name}' is not a template — use the library update path`);
    }

    const [existing] = await this.db
      .select()
      .from(tenantLibraryImports)
      .where(and(
        eq(tenantLibraryImports.tenantId, this.tenantId),
        eq(tenantLibraryImports.libraryId, marketplaceId),
      ))
      .limit(1);

    if (!existing) {
      throw Errors.BadRequest('Template has not been imported yet — use Import instead of Update');
    }

    if (existing.importedSemver === mkt.semver) {
      throw Errors.BadRequest('No update available — already on the latest version');
    }

    // Re-validate the new schema. A v1 template should never have made it
    // into the marketplace, but if it did we refuse to import it (same
    // gate as importTemplate above).
    this.assertV2Schema(mkt.schema);

    const newTemplateId = crypto.randomUUID();
    const now = new Date();
    const newName = `${mkt.name} (v${mkt.semver})`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.db.insert(templates as any).values({
      id:        newTemplateId,
      tenantId:  this.tenantId,
      name:      newName,
      schema:    mkt.schema,
      createdAt: now,
    });

    const oldLocalId = existing.localEntityId;
    const fromSemver = existing.importedSemver;

    await this.db
      .update(tenantLibraryImports)
      .set({
        localEntityId:  newTemplateId,
        importedSemver: mkt.semver,
        importedAt:     now,
      })
      .where(eq(tenantLibraryImports.id, existing.id));

    await this.db
      .update(marketplaceLibraries)
      .set({ downloadCount: sql`${marketplaceLibraries.downloadCount} + 1`, updatedAt: now })
      .where(eq(marketplaceLibraries.id, marketplaceId));

    // Sprint 2 S2-8 — record the template update event.
    await this.writeHistory({
      templateId:    newTemplateId,
      action:        'update',
      sourceVersion: fromSemver,
      targetVersion: mkt.semver,
      rowsAffected:  1,
      libraryId:     marketplaceId,
      metadata: {
        catalogEntryId: marketplaceId,
        oldLocalId,
        newLocalId: newTemplateId,
        newName,
      },
      userId,
    });

    return {
      newLocalId: newTemplateId,
      newName,
      fromSemver,
      toSemver: mkt.semver,
      oldLocalId,
    };
  }

  // ─── The unified catalogue (marketplace_libraries) ───

  /**
   * Thin alias over `list()` for the kind-filtered `/libraries` route. It is an
   * alias rather than a second query so there is exactly one place that knows
   * how to read the catalogue — maintaining two was the defect this work
   * removes. The route's contract is an unpaginated array, so it asks for a
   * page large enough to be one.
   */
  async listLibraries(opts: { kind?: string } = {}) {
    const { rows } = await this.list({
      ...(opts.kind ? { kind: opts.kind as 'comments' | 'templates' } : {}),
      page:     1,
      pageSize: 1000,
    });
    return rows;
  }

  /**
   * Sprint 2 S2-7 — Library update with explicit Append vs Replace mode.
   *
   * - 'append' (default, legacy behavior): adds the new pack's rows alongside
   *   the prior import's rows. Risks duplication when the marketplace bumps a
   *   library 248 → 248+248 entries.
   * - 'replace': deletes every comment with the matching `library_id` for this
   *   tenant, then inserts the new pack. Tenant-authored comments
   *   (library_id IS NULL) are NEVER touched.
   *
   * Throws Errors.BadRequest if no prior import exists or the marketplace
   * version has not advanced past the imported semver.
   */
  async updateLibraryImport(
    libraryId: string,
    options: UpdateLibraryImportOptions = {},
  ): Promise<UpdateLibraryImportResult> {
    const mode: LibraryUpdateMode = options.mode ?? 'append';
    const userId = options.userId ?? 'system';

    const [lib] = await this.db
      .select()
      .from(marketplaceLibraries)
      .where(eq(marketplaceLibraries.id, libraryId))
      .limit(1);
    if (!lib) throw Errors.NotFound('Marketplace library not found');

    const [existing] = await this.db
      .select()
      .from(tenantLibraryImports)
      .where(and(
        eq(tenantLibraryImports.tenantId, this.tenantId),
        eq(tenantLibraryImports.libraryId, libraryId),
      ))
      .limit(1);

    if (!existing) {
      throw Errors.BadRequest('Library has not been imported yet — use Import instead of Update');
    }

    if (existing.importedSemver === lib.semver) {
      throw Errors.BadRequest('No update available — already on the latest version');
    }

    if (lib.kind !== 'comments') {
      throw new Error(`Library kind '${lib.kind}' not yet supported for update`);
    }

    const fromSemver = existing.importedSemver;
    const now = new Date();
    let rowsAdded = 0;
    let rowsDeleted = 0;

    // S2-7 — Replace mode: clear prior-import rows for this tenant first.
    if (mode === 'replace') {
      const deleted = await this.db.delete(comments)
        .where(and(
          eq(comments.tenantId, this.tenantId),
          eq(comments.libraryId, libraryId),
        ))
        .run();
      // Drizzle returns a meta object on D1; better-sqlite3 returns
      // { changes: number }. We tolerate both via duck-typing.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const changes = (deleted as any)?.meta?.changes ?? (deleted as any)?.changes ?? 0;
      rowsDeleted = typeof changes === 'number' ? changes : 0;
    }

    // Parse the new pack's entries and insert them (all fresh UUIDs).
    const entries = parseLibraryComments(lib.schema);
    rowsAdded = await this.insertLibraryComments(libraryId, entries);

    // Update the marker. Replace mode resets rowCount to the new size; append
    // mode accumulates as before.
    const newRowCount = mode === 'replace' ? rowsAdded : (existing.rowCount + rowsAdded);
    await this.db
      .update(tenantLibraryImports)
      .set({
        importedSemver: lib.semver,
        importedAt:     now,
        rowCount:       newRowCount,
      })
      .where(eq(tenantLibraryImports.id, existing.id));

    await this.db
      .update(marketplaceLibraries)
      .set({ downloadCount: sql`${marketplaceLibraries.downloadCount} + 1`, updatedAt: now })
      .where(eq(marketplaceLibraries.id, libraryId));

    // Sprint 2 S2-8 — write history. action='replace' surfaces the destructive
    // event distinctly from a plain 'update' (append).
    await this.writeHistory({
      libraryId,
      action:        mode === 'replace' ? 'replace' : 'update',
      sourceVersion: fromSemver,
      targetVersion: lib.semver,
      rowsAffected:  rowsAdded,
      metadata: {
        libraryName: lib.name,
        kind:        lib.kind,
        rowsAdded,
        rowsDeleted,
        confirmLossOfEdits: !!options.confirmLossOfEdits,
      },
      userId,
    });

    return {
      rowsAdded,
      rowsDeleted,
      fromSemver,
      toSemver:    lib.semver,
      libraryName: lib.name,
      mode,
    };
  }
}

/**
 * Extract the comment entries from a library schema. The schema may arrive as a
 * parsed object (Drizzle json mode) or a raw string (some D1 driver / json
 * encoding paths); both are handled. Returns [] for anything malformed.
 */
function parseLibraryComments(
  schema: unknown,
): Array<{ text: string; section?: string; rating?: string }> {
  let parsed: { comments?: Array<{ text: string; section?: string; rating?: string }> } = {};
  if (typeof schema === 'string') {
    try { parsed = JSON.parse(schema); } catch { parsed = {}; }
  } else if (schema && typeof schema === 'object') {
    parsed = schema as typeof parsed;
  }
  return Array.isArray(parsed.comments) ? parsed.comments : [];
}

/**
 * Count the importable items a catalogue entry advertises. Tolerates the same
 * two encodings `parseLibraryComments` does — a parsed object (Drizzle json
 * mode) or a raw string — because both read the SAME column and a reader that
 * silently returns 0 for one of them is how an entry renders "0 items" while
 * holding content.
 */
function countLibrarySchemaItems(schema: unknown): number {
  let parsed: unknown = schema;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return 0; }
  }
  if (!parsed || typeof parsed !== 'object') return 0;
  const s = parsed as Record<string, unknown>;
  if (Array.isArray(s.comments)) return s.comments.length;
  return 0;
}
