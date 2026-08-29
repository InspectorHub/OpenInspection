/**
 * Reading the catalogue.
 *
 * One query for every importable kind, and the only one — the two mechanisms
 * that used to sit behind one page returned different shapes from different
 * tables, and only one of them was ever wired to a UI. A free function beside
 * the write halves so the browse page and anything else that lists the
 * catalogue provably ask the same question.
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';

import { and, desc, eq, isNull, like, sql } from 'drizzle-orm';
import { escapeLikePattern } from '../../lib/db/like-escape';
import { marketplaceLibraries, tenantLibraryImports } from '../../lib/db/schema/marketplace';
import { countLibrarySchemaItems } from './library-pack';

/** The service's `drizzle(env.DB)` handle. Named so this signature does not
 *  silently narrow to the schema-less default and reject its only caller. */
type MarketplaceDb = DrizzleD1Database<Record<string, unknown>>;

/**
 * The three axes filter INDEPENDENTLY, because a jurisdiction's form standard
 * and an inspection kind are not property types, and the legacy single
 * `category` column could only ever describe one of the three at a time.
 */
export interface CatalogueBrowseOptions {
    search?: string;
    kind?: 'comments' | 'templates' | 'statutory';
    propertyType?: string;
    jurisdiction?: string;
    inspectionKind?: string;
    page?: number;
    pageSize?: number;
}

export async function browseCatalogue(
    db: MarketplaceDb,
    tenantId: string,
    opts: CatalogueBrowseOptions = {},
) {
    const { search = '', page = 1, pageSize = 50 } = opts;
    const offset = (page - 1) * pageSize;

    // A delisted entry is invisible to everyone, and this ONE condition is the
    // whole of delisting: it removes the row from the listing and from the
    // count above it, and — because `hasUpdate` is computed further down in this
    // same query — it also stops the "update available" badge for workspaces
    // that already installed. Their install itself is untouched; nothing here
    // reads or writes tenant_library_imports.
    const conditions = [isNull(marketplaceLibraries.delistedAt)];
    if (opts.kind)           conditions.push(eq(marketplaceLibraries.kind, opts.kind));
    if (opts.propertyType)   conditions.push(eq(marketplaceLibraries.propertyType, opts.propertyType));
    if (opts.jurisdiction)   conditions.push(eq(marketplaceLibraries.jurisdiction, opts.jurisdiction));
    if (opts.inspectionKind) conditions.push(eq(marketplaceLibraries.inspectionKind, opts.inspectionKind));
    if (search)              conditions.push(like(marketplaceLibraries.name, `%${escapeLikePattern(search)}%`));
    const where = conditions.length ? and(...conditions) : undefined;

    const totalRow = await db
        .select({ c: sql<number>`count(*)` })
        .from(marketplaceLibraries)
        .where(where)
        .get();
    const total = totalRow?.c ?? 0;

    // Featured entries always sort first; within tier, sort by download count.
    const rawRows = await db
        .select()
        .from(marketplaceLibraries)
        .where(where)
        .orderBy(desc(marketplaceLibraries.featured), desc(marketplaceLibraries.downloadCount))
        .limit(pageSize)
        .offset(offset);

    const imports = await db
        .select({
            libraryId:      tenantLibraryImports.libraryId,
            importedSemver: tenantLibraryImports.importedSemver,
        })
        .from(tenantLibraryImports)
        .where(eq(tenantLibraryImports.tenantId, tenantId));

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
