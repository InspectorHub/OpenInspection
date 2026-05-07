import { drizzle } from 'drizzle-orm/d1';
import { eq, like, and, desc, sql } from 'drizzle-orm';
import { marketplaceTemplates, tenantMarketplaceImports, marketplaceLibraries, tenantLibraryImports } from '../lib/db/schema/marketplace';
import { templates } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { TemplateService } from './template.service';

export class MarketplaceService {
  private db: ReturnType<typeof drizzle<any>>;
  private rawDb: D1Database;
  private tenantId: string;

  constructor(db: D1Database, tenantId: string) {
    this.db = drizzle(db as any);
    this.rawDb = db;
    this.tenantId = tenantId;
  }

  async list(opts: { search?: string; category?: string; page?: number; pageSize?: number }) {
    const { search = '', category = '', page = 1, pageSize = 12 } = opts;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (category) conditions.push(eq(marketplaceTemplates.category, category));
    if (search)   conditions.push(like(marketplaceTemplates.name, `%${search}%`));

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

  async importTemplate(marketplaceId: string): Promise<string> {
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

    return newTemplateId;
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

  async importLibrary(libraryId: string): Promise<{ rowCount: number; localFirstId: string }> {
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
      // (25 × 5 = 125 placeholders, well under D1 limits).
      const CHUNK = 25;
      const nowSec = Math.floor(Date.now() / 1000);
      for (let i = 0; i < entries.length; i += CHUNK) {
        const batch = entries.slice(i, i + CHUNK);
        const placeholders = batch.map(() => '(?, ?, ?, ?, ?)').join(', ');
        const params: (string | number | null)[] = [];
        for (let j = 0; j < batch.length; j++) {
          const c = batch[j];
          const isFirst = i === 0 && j === 0;
          params.push(
            isFirst ? firstId : crypto.randomUUID(),
            this.tenantId,
            c.text,
            c.section ?? null,
            nowSec,
          );
        }
        const stmt = `INSERT INTO comments (id, tenant_id, text, category, created_at) VALUES ${placeholders}`;
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

    return { rowCount, localFirstId: firstId };
  }
}

function countLibrarySchemaItems(schema: unknown): number {
  if (!schema || typeof schema !== 'object') return 0;
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.comments)) return s.comments.length;
  if (Array.isArray(s.snippets)) return s.snippets.length;
  return 0;
}
