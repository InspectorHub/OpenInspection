import { drizzle } from 'drizzle-orm/d1';
import { eq, like, and, desc, sql } from 'drizzle-orm';
import type { PackEntry } from '../lib/library-edit-marker';
import { parseLibraryComments, countLibrarySchemaItems } from './marketplace/library-pack';
import { insertLibraryComments } from './marketplace/library-insert';
import {
    applyReplaceMode,
    previewLibraryReplace,
    resolveLibraryUpdate,
    type LibraryReplacePreview,
} from './marketplace/library-replace';
import { escapeLikePattern } from '../lib/db/like-escape';
import {
    marketplaceLibraries,
    tenantLibraryImports,
} from '../lib/db/schema/marketplace';
import { templates } from '../lib/db/schema'; // `comments` is reached by raw SQL below, and by ./marketplace/library-replace.ts
import { Errors } from '../lib/errors';
import { writeImportHistory } from './marketplace/import-history';
import { insertLocalTemplate } from './marketplace/local-template';
import { assertStatutorySchema } from './marketplace/statutory-import';
import { TemplateService } from './template.service';

/**
 * Sprint 2 S2-7 — Library update mode. Append (default, legacy behavior) keeps
 * old rows alongside new. Replace deletes the prior import's rows first then
 * inserts the new pack.
 */
type LibraryUpdateMode = 'append' | 'replace';

export interface UpdateLibraryImportOptions {
    mode?: LibraryUpdateMode;
    /**
     * The destructive choice, and it is now enforced rather than merely recorded
     * (#348). Replace mode defaults to KEEPING rows the tenant rewrote; passing
     * true is the caller stating, deliberately, that those rewrites should be
     * deleted along with everything else. Nothing else in this codebase should
     * default it to true.
     */
    confirmLossOfEdits?: boolean;
    /** User id for the history row (S2-8). Defaults to 'system'. */
    userId?: string;
}

export interface UpdateLibraryImportResult {
    rowsAdded: number;
    rowsDeleted: number;
    /** Rows the tenant had rewritten and that this update did not delete. */
    rowsPreserved: number;
    fromSemver: string;
    toSemver: string;
    libraryName: string;
    mode: LibraryUpdateMode;
}

export type { LibraryReplacePreview };

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

    // `schema` is the pack ITSELF — counted here, then dropped. Spreading the
    // whole row was free only while the starter pack was empty; filled in it is
    // ~50KB per library at pageSize 1000. No client reads it; import and preview
    // fetch by id.
    const rows = rawRows.map(({ schema: packSchema, ...l }) => ({
      ...l,
      importedSemver: importMap.get(l.id) ?? null,
      hasUpdate: importMap.has(l.id) && importMap.get(l.id) !== l.semver,
      itemCount: countLibrarySchemaItems(packSchema as unknown),
    }));

    return { rows, total };
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
   * The one import path, for every kind (#293).
   *
   * Branches on `kind` because the two shapes are genuinely different
   * operations, not two flavours of one:
   *
   *   'templates' (1:1) — one catalogue row becomes ONE local `templates` row,
   *                       tracked by that row's id in `local_entity_id`.
   *   'statutory' (1:1) — the same shape, gated by the extended validator that
   *                       admits a statutory declaration.
   *   'comments'  (1:N) — one pack becomes N `comments` rows tagged with the
   *                       catalogue id, tracked by `row_count`.
   *
   * There is no generic fallthrough: writing the comments table because a kind
   * was unrecognised is precisely the failure the branch exists to prevent.
   */
  async importCatalogEntry(catalogId: string, userId: string = 'system'): Promise<{
    kind: 'comments' | 'templates' | 'statutory';
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

    if (entry.kind === 'statutory') {
      // A different validator, because the tenant-facing one refuses the
      // declaration this row carries — and it must keep refusing it, which is
      // why this branch does not reach for a flag on `assertV2Schema`.
      assertStatutorySchema(entry.schema);
      localEntityId = await insertLocalTemplate(this.db, this.tenantId, entry.name, entry.schema, now);
    } else if (entry.kind === 'templates') {
      // Spec 5B P3 — gate imports on v2 schema validation. The catalogue can
      // technically host any JSON; without this check a v1 (legacy
      // `type: 'rating'`) template would leak into a tenant and break the editor.
      this.assertV2Schema(entry.schema);
      localEntityId = await insertLocalTemplate(this.db, this.tenantId, entry.name, entry.schema, now);
    } else if (entry.kind === 'comments') {
      const entries = parseLibraryComments(entry.schema);
      rowCount = await insertLibraryComments(this.rawDb, this.tenantId, catalogId, entries);
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

    await writeImportHistory(this.db, this.tenantId, {
      // Keyed off what the import actually produced rather than off a list of
      // kind names: a 1:1 kind has a local row and a 1:N kind has a count, and a
      // name list here is one more place a new kind has to be remembered.
      templateId:    localEntityId,
      libraryId:     catalogId,
      action:        'install',
      sourceVersion: null,
      targetVersion: entry.semver,
      rowsAffected:  localEntityId !== null ? 1 : rowCount,
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
    await writeImportHistory(this.db, this.tenantId, {
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

  /** What a replace would cost, computed before anything is deleted (#348). */
  previewLibraryReplace(libraryId: string): Promise<LibraryReplacePreview> {
    return previewLibraryReplace(this.db, this.tenantId, libraryId);
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

    const { lib, existing } = await resolveLibraryUpdate(this.db, this.tenantId, libraryId);

    if (lib.kind !== 'comments') {
      throw new Error(`Library kind '${lib.kind}' not yet supported for update`);
    }

    const fromSemver = existing.importedSemver;
    const now = new Date();
    let rowsDeleted = 0;
    let rowsPreserved = 0;

    let entries: PackEntry[] = parseLibraryComments(lib.schema);

    // S2-7 — Replace mode clears the prior import's rows before inserting the
    // new pack. #348 — but not the ones the inspector rewrote, unless the caller
    // has explicitly accepted losing them.
    if (mode === 'replace') {
      const outcome = await applyReplaceMode(
        this.db, this.tenantId, libraryId, entries,
        options.confirmLossOfEdits !== true,
      );
      rowsDeleted   = outcome.rowsDeleted;
      rowsPreserved = outcome.rowsPreserved;
      entries       = outcome.entries;
    }

    // Insert the new pack's entries (all fresh UUIDs, each stamped with the
    // import hash that makes the NEXT update able to ask this same question).
    const rowsAdded = await insertLibraryComments(this.rawDb, this.tenantId, libraryId, entries);

    // Update the marker. Replace mode resets rowCount to the new size; append
    // mode accumulates as before.
    const newRowCount = mode === 'replace'
      ? rowsAdded + rowsPreserved
      : (existing.rowCount + rowsAdded);
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
    await writeImportHistory(this.db, this.tenantId, {
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
        rowsPreserved,
        confirmLossOfEdits: !!options.confirmLossOfEdits,
      },
      userId,
    });

    return {
      rowsAdded,
      rowsDeleted,
      rowsPreserved,
      fromSemver,
      toSemver:    lib.semver,
      libraryName: lib.name,
      mode,
    };
  }
}
