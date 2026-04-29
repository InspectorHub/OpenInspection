import { drizzle } from 'drizzle-orm/d1';
import { eq, like, and, desc, sql } from 'drizzle-orm';
import { marketplaceTemplates, tenantMarketplaceImports } from '../lib/db/schema/marketplace';
import { templates } from '../lib/db/schema';

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

    const rows = await this.db
      .select()
      .from(marketplaceTemplates)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(marketplaceTemplates.downloadCount))
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
      // Already imported — return existing local template id
      return existing.localTemplateId;
    }

    const newTemplateId = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.db.insert(templates as any).values({
      id:        newTemplateId,
      tenantId:  this.tenantId,
      name:      mkt.name,
      schema:    JSON.parse(mkt.schema as string),
      createdAt: now,
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
}
