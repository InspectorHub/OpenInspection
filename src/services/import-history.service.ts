import { drizzle } from 'drizzle-orm/d1';
import { eq, and, desc } from 'drizzle-orm';
import { tenantMarketplaceImportHistory } from '../lib/db/schema/marketplace';
import type { ImportHistoryItem } from '../lib/validations/import-history.schema';

interface ListOptions {
    templateId?: string;
    libraryId?: string;
    page?: number;
    pageSize?: number;
}

/**
 * Sprint 2 S2-8 — read-only access to per-import history rows for a tenant.
 * Always tenant-scoped; supports optional filter by templateId or libraryId.
 */
export class ImportHistoryService {
    private db: ReturnType<typeof drizzle>;

    constructor(rawDb: D1Database, private tenantId: string) {
        this.db = drizzle(rawDb);
    }

    async list(opts: ListOptions = {}): Promise<{
        items: ImportHistoryItem[];
        page: number;
        pageSize: number;
        hasMore: boolean;
    }> {
        const page = Math.max(1, opts.page ?? 1);
        const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
        const offset = (page - 1) * pageSize;

        const conds = [eq(tenantMarketplaceImportHistory.tenantId, this.tenantId)];
        if (opts.templateId) conds.push(eq(tenantMarketplaceImportHistory.templateId, opts.templateId));
        if (opts.libraryId)  conds.push(eq(tenantMarketplaceImportHistory.libraryId, opts.libraryId));

        const rows = await this.db.select()
            .from(tenantMarketplaceImportHistory)
            .where(and(...conds))
            .orderBy(desc(tenantMarketplaceImportHistory.createdAt))
            .limit(pageSize + 1)
            .offset(offset)
            .all();

        const hasMore = rows.length > pageSize;
        const slice = hasMore ? rows.slice(0, pageSize) : rows;

        const items: ImportHistoryItem[] = slice.map((r) => {
            let meta: Record<string, unknown> | null = null;
            if (r.metadata) {
                try { meta = JSON.parse(r.metadata as string) as Record<string, unknown>; }
                catch { meta = null; }
            }
            return {
                id:            r.id as string,
                templateId:    (r.templateId as string | null) ?? null,
                libraryId:     (r.libraryId as string | null) ?? null,
                action:        r.action as ImportHistoryItem['action'],
                sourceVersion: (r.sourceVersion as string | null) ?? null,
                targetVersion: (r.targetVersion as string | null) ?? null,
                rowsAffected:  r.rowsAffected as number,
                metadata:      meta,
                createdAt:     r.createdAt as number,
                createdBy:     r.createdBy as string,
            };
        });

        return { items, page, pageSize, hasMore };
    }
}
