import { drizzle } from 'drizzle-orm/d1';
import { eq, like, and, desc, sql } from 'drizzle-orm';
import { marketplaceTemplates, tenantMarketplaceImports } from '../lib/db/schema/marketplace';
import { templates, comments } from '../lib/db/schema';

export class MarketplaceService {
  private db: ReturnType<typeof drizzle<any>>;
  private tenantId: string;

  constructor(db: D1Database, tenantId: string) {
    this.db = drizzle(db as any);
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

    const now = new Date().toISOString();
    let localId: string;

    // Spec 5G M2 — Comment Library distribution. When the marketplace row
    // is a comment library (schema = { comments: [...] }) bulk-INSERT each
    // entry into tenants/comments table instead of creating a template.
    if (mkt.category === 'Comment Library') {
      const schema = (mkt.schema as { comments?: Array<{ text: string; section?: string; rating?: string }> }) || {};
      const commentEntries = Array.isArray(schema.comments) ? schema.comments : [];
      // Sentinel id captures "first comment id" for the imports row's
      // localTemplateId column (re-uses existing column name; future
      // schema may rename to localResourceId).
      const firstId = crypto.randomUUID();
      localId = firstId;
      const rows = commentEntries.map((c, i) => ({
        id:        i === 0 ? firstId : crypto.randomUUID(),
        tenantId:  this.tenantId,
        text:      c.text,
        category:  c.section ?? null,
        createdAt: new Date(now),
      }));
      // D1 batch insert — chunk to avoid SQL too long
      for (let i = 0; i < rows.length; i += 50) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.db.insert(comments).values(rows.slice(i, i + 50) as any);
      }
    } else {
      // Default: import as Template
      localId = crypto.randomUUID();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this.db.insert(templates as any).values({
        id:        localId,
        tenantId:  this.tenantId,
        name:      mkt.name,
        schema:    mkt.schema,
        createdAt: new Date(now),
      });
    }

    await this.db.insert(tenantMarketplaceImports).values({
      id:                    crypto.randomUUID(),
      tenantId:              this.tenantId,
      marketplaceTemplateId: marketplaceId,
      importedSemver:        mkt.semver,
      localTemplateId:       localId,
      importedAt:            now,
    });

    await this.db
      .update(marketplaceTemplates)
      .set({ downloadCount: sql`${marketplaceTemplates.downloadCount} + 1`, updatedAt: now })
      .where(eq(marketplaceTemplates.id, marketplaceId));

    return localId;
  }
}
