import { drizzle } from 'drizzle-orm/d1';
import { eq, like, and, desc, sql } from 'drizzle-orm';
import { escapeLikePattern } from '../lib/db/like-escape';
import {
    marketplaceTemplates,
    tenantMarketplaceImports,
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
export type LibraryUpdateMode = 'append' | 'replace';

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

  async list(opts: { search?: string; category?: string; page?: number; pageSize?: number }) {
    const { search = '', category = '', page = 1, pageSize = 12 } = opts;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (category) conditions.push(eq(marketplaceTemplates.category, category));
    if (search)   conditions.push(like(marketplaceTemplates.name, `%${escapeLikePattern(search)}%`));

    // Spec 4F — featured templates always sort first; within tier, sort by download count.
    const rows = await this.db
      .select()
      .from(marketplaceTemplates)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(marketplaceTemplates.featured), desc(marketplaceTemplates.downloadCount))
      .limit(pageSize)
      .offset(offset);

    const imports = await this.db
      .select()
      .from(tenantMarketplaceImports)
      .where(eq(tenantMarketplaceImports.tenantId, this.tenantId));

    const importMap = new Map(imports.map(i => [i.marketplaceTemplateId, i.importedSemver]));

    return rows.map(t => ({
      ...t,
      importedSemver: importMap.get(t.id) ?? null,
      hasUpdate: importMap.has(t.id) && importMap.get(t.id) !== t.semver,
    }));
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
        createdAt:     Date.now(),
        createdBy:     input.userId,
      }).run();
    } catch (err) {
      logger.error('[marketplace] history insert failed', {
        tenantId: this.tenantId, action: input.action,
      }, err instanceof Error ? err : undefined);
    }
  }

  async importTemplate(marketplaceId: string, userId: string = 'system'): Promise<string> {
    const [mkt] = await this.db
      .select()
      .from(marketplaceTemplates)
      .where(eq(marketplaceTemplates.id, marketplaceId))
      .limit(1);

    if (!mkt) throw new Error('Marketplace template not found');

    // Check if already imported by this tenant — make endpoint idempotent
    const [existing] = await this.db
      .select()
      .from(tenantMarketplaceImports)
      .where(and(
        eq(tenantMarketplaceImports.tenantId, this.tenantId),
        eq(tenantMarketplaceImports.marketplaceTemplateId, marketplaceId),
      ))
      .limit(1);

    if (existing) {
      // Already imported — return existing local id (template or first comment)
      return existing.localTemplateId;
    }

    // Spec 5B P3 — gate marketplace imports on v2 schema validation. The
    // marketplace can technically host any JSON; without this check, a v1
    // (legacy `type: 'rating'`) template would leak into a tenant and break
    // the editor. validateSchema throws Errors.BadRequest with a Zod-style
    // message on failure.
    try {
      const tplSvc = new TemplateService(this.rawDb);
      tplSvc.validateSchema(mkt.schema as string | Record<string, unknown>);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Template schema invalid')) {
        throw Errors.BadRequest('Invalid template schema (must be v2): ' + err.message);
      }
      throw err;
    }

    const newTemplateId = crypto.randomUUID();
    const now = new Date().toISOString();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.db.insert(templates as any).values({
      id:        newTemplateId,
      tenantId:  this.tenantId,
      name:      mkt.name,
      schema:    mkt.schema,
      createdAt: new Date(now),
    });

    await this.db.insert(tenantMarketplaceImports).values({
      id:                    crypto.randomUUID(),
      tenantId:              this.tenantId,
      marketplaceTemplateId: marketplaceId,
      importedSemver:        mkt.semver,
      localTemplateId:       newTemplateId,
      importedAt:            now,
    });

    await this.db
      .update(marketplaceTemplates)
      .set({ downloadCount: sql`${marketplaceTemplates.downloadCount} + 1`, updatedAt: now })
      .where(eq(marketplaceTemplates.id, marketplaceId));

    // Sprint 2 S2-8 — record the install in import history.
    await this.writeHistory({
      templateId:    newTemplateId,
      action:        'install',
      sourceVersion: null,
      targetVersion: mkt.semver,
      rowsAffected:  1,
      metadata:      { marketplaceTemplateId: marketplaceId, name: mkt.name },
      userId,
    });

    return newTemplateId;
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
    oldLocalId: string;
  }> {
    const [mkt] = await this.db
      .select()
      .from(marketplaceTemplates)
      .where(eq(marketplaceTemplates.id, marketplaceId))
      .limit(1);

    if (!mkt) throw Errors.NotFound('Marketplace template not found');

    const [existing] = await this.db
      .select()
      .from(tenantMarketplaceImports)
      .where(and(
        eq(tenantMarketplaceImports.tenantId, this.tenantId),
        eq(tenantMarketplaceImports.marketplaceTemplateId, marketplaceId),
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
    try {
      const tplSvc = new TemplateService(this.rawDb);
      tplSvc.validateSchema(mkt.schema as string | Record<string, unknown>);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Template schema invalid')) {
        throw Errors.BadRequest('Invalid template schema (must be v2): ' + err.message);
      }
      throw err;
    }

    const newTemplateId = crypto.randomUUID();
    const now = new Date().toISOString();
    const newName = `${mkt.name} (v${mkt.semver})`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.db.insert(templates as any).values({
      id:        newTemplateId,
      tenantId:  this.tenantId,
      name:      newName,
      schema:    mkt.schema,
      createdAt: new Date(now),
    });

    const oldLocalId = existing.localTemplateId;
    const fromSemver = existing.importedSemver;

    await this.db
      .update(tenantMarketplaceImports)
      .set({
        localTemplateId: newTemplateId,
        importedSemver:  mkt.semver,
        importedAt:      now,
      })
      .where(eq(tenantMarketplaceImports.id, existing.id));

    await this.db
      .update(marketplaceTemplates)
      .set({ downloadCount: sql`${marketplaceTemplates.downloadCount} + 1`, updatedAt: now })
      .where(eq(marketplaceTemplates.id, marketplaceId));

    // Sprint 2 S2-8 — record the template update event.
    await this.writeHistory({
      templateId:    newTemplateId,
      action:        'update',
      sourceVersion: fromSemver,
      targetVersion: mkt.semver,
      rowsAffected:  1,
      metadata: {
        marketplaceTemplateId: marketplaceId,
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

  // ─── Spec 5G M2 — Library marketplace (comments, snippets, etc) ───

  async listLibraries(opts: { kind?: string } = {}) {
    const conditions: ReturnType<typeof eq>[] = [];
    if (opts.kind) conditions.push(eq(marketplaceLibraries.kind, opts.kind as 'comments' | 'snippets'));
    const list = await this.db
      .select()
      .from(marketplaceLibraries)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(marketplaceLibraries.featured), desc(marketplaceLibraries.downloadCount));

    const imports = await this.db
      .select({ libraryId: tenantLibraryImports.libraryId, importedSemver: tenantLibraryImports.importedSemver })
      .from(tenantLibraryImports)
      .where(eq(tenantLibraryImports.tenantId, this.tenantId));
    const importMap = new Map(imports.map((i) => [i.libraryId, i.importedSemver]));

    return list.map((l) => ({
      ...l,
      importedSemver: importMap.get(l.id) ?? null,
      hasUpdate: importMap.has(l.id) && importMap.get(l.id) !== l.semver,
      itemCount: countLibrarySchemaItems(l.schema as unknown),
    }));
  }

  async importLibrary(libraryId: string, userId: string = 'system'): Promise<{ rowCount: number; localFirstId: string }> {
    const [lib] = await this.db
      .select()
      .from(marketplaceLibraries)
      .where(eq(marketplaceLibraries.id, libraryId))
      .limit(1);
    if (!lib) throw new Error('Marketplace library not found');

    // Idempotent: if already imported, return the previous import meta
    const [existing] = await this.db
      .select()
      .from(tenantLibraryImports)
      .where(and(
        eq(tenantLibraryImports.tenantId, this.tenantId),
        eq(tenantLibraryImports.libraryId, libraryId),
      ))
      .limit(1);
    if (existing) {
      return { rowCount: existing.rowCount, localFirstId: existing.id };
    }

    const now = new Date().toISOString();
    let rowCount = 0;
    const firstId = crypto.randomUUID();

    if (lib.kind === 'comments') {
      // schema may arrive as parsed object (Drizzle json mode) or raw string
      // (some D1 driver / json encoding paths). Handle both.
      let schema: { comments?: Array<{ text: string; section?: string; rating?: string }> } = {};
      if (typeof lib.schema === 'string') {
        try { schema = JSON.parse(lib.schema); } catch { schema = {}; }
      } else if (lib.schema && typeof lib.schema === 'object') {
        schema = lib.schema as typeof schema;
      }
      const entries = Array.isArray(schema.comments) ? schema.comments : [];
      // Use raw SQL with placeholder list — single statement per chunk
      // is dramatically faster than 248 individual inserts. D1 caps SQL
      // statement size and bound-parameter count, so chunk to 25 rows
      // (25 × 6 = 150 placeholders, well under D1 limits).
      const CHUNK = 25;
      const nowSec = Math.floor(Date.now() / 1000);
      for (let i = 0; i < entries.length; i += CHUNK) {
        const batch = entries.slice(i, i + CHUNK);
        const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
        const params: (string | number | null)[] = [];
        for (let j = 0; j < batch.length; j++) {
          const c = batch[j];
          const isFirst = i === 0 && j === 0;
          params.push(
            isFirst ? firstId : crypto.randomUUID(),
            this.tenantId,
            c.text,
            c.section ?? null,
            libraryId,             // S2-7 — provenance for replace mode
            nowSec,
          );
        }
        const stmt = `INSERT INTO comments (id, tenant_id, text, category, library_id, created_at) VALUES ${placeholders}`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (this.rawDb as any).prepare(stmt).bind(...params).run();
        rowCount += batch.length;
      }
    } else {
      // 'snippets' or future kinds — extend with their target tables here
      throw new Error(`Library kind '${lib.kind}' not yet supported for import`);
    }

    await this.db.insert(tenantLibraryImports).values({
      id:             crypto.randomUUID(),
      tenantId:       this.tenantId,
      libraryId,
      importedSemver: lib.semver,
      importedAt:     now,
      rowCount,
    });
    await this.db
      .update(marketplaceLibraries)
      .set({ downloadCount: sql`${marketplaceLibraries.downloadCount} + 1`, updatedAt: now })
      .where(eq(marketplaceLibraries.id, libraryId));

    // Sprint 2 S2-8 — record the library install.
    await this.writeHistory({
      libraryId,
      action:        'install',
      sourceVersion: null,
      targetVersion: lib.semver,
      rowsAffected:  rowCount,
      metadata:      { libraryName: lib.name, kind: lib.kind },
      userId,
    });

    return { rowCount, localFirstId: firstId };
  }

  /**
   * Round 37 — Library equivalent of updateTemplateImport. Scheme 2:
   * does NOT delete previously imported library rows (e.g. existing
   * canned_comments). Instead, re-runs the chunked INSERT to add the
   * new pack's rows alongside the old ones, then advances the import
   * marker to the new semver. If the inspector wants a clean state,
   * they can delete the old rows from /comments after updating.
   *
   * Throws Errors.BadRequest if no prior import or no version bump.
   */
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
    const now = new Date().toISOString();
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

    // Parse the new pack's entries.
    let parsed: { comments?: Array<{ text: string; section?: string; rating?: string }> } = {};
    if (typeof lib.schema === 'string') {
      try { parsed = JSON.parse(lib.schema); } catch { parsed = {}; }
    } else if (lib.schema && typeof lib.schema === 'object') {
      parsed = lib.schema as typeof parsed;
    }
    const entries = Array.isArray(parsed.comments) ? parsed.comments : [];

    const CHUNK = 25;
    const nowSec = Math.floor(Date.now() / 1000);
    for (let i = 0; i < entries.length; i += CHUNK) {
      const batch = entries.slice(i, i + CHUNK);
      const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const params: (string | number | null)[] = [];
      for (let j = 0; j < batch.length; j++) {
        const c = batch[j];
        params.push(
          crypto.randomUUID(),
          this.tenantId,
          c.text,
          c.section ?? null,
          libraryId,             // S2-7 provenance
          nowSec,
        );
      }
      const stmt = `INSERT INTO comments (id, tenant_id, text, category, library_id, created_at) VALUES ${placeholders}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.rawDb as any).prepare(stmt).bind(...params).run();
      rowsAdded += batch.length;
    }

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

function countLibrarySchemaItems(schema: unknown): number {
  if (!schema || typeof schema !== 'object') return 0;
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.comments)) return s.comments.length;
  if (Array.isArray(s.snippets)) return s.snippets.length;
  return 0;
}
