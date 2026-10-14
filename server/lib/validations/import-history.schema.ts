import { z } from '@hono/zod-openapi';

/**
 * Sprint 2 S2-8 — query + response schema for the per-import history endpoint.
 *
 * Either filter by templateId or libraryId (mutually exclusive); omit both to
 * list all events for the tenant. Pagination via simple page/pageSize.
 */
export const ImportHistoryQuerySchema = z.object({
    templateId: z.string().optional().describe('Return only events for this local template id. Meant to be used instead of libraryId, not together with it.'),
    libraryId:  z.string().optional().describe('Return only events for this marketplace library (catalogue entry) id. Meant to be used instead of templateId, not together with it.'),
    page:       z.coerce.number().int().min(1).optional().describe('1-indexed page number. Defaults to 1.'),
    pageSize:   z.coerce.number().int().min(1).max(100).optional().describe('Events per page. Defaults to 20.'),
});

// Shape of a single import-history event row returned by the service. Declared
// as a plain interface — the row is assembled in code, not parsed from untrusted
// input, so no runtime Zod schema is needed here.
export interface ImportHistoryItem {
    id: string;
    templateId: string | null;
    libraryId: string | null;
    action: 'install' | 'update' | 'replace';
    sourceVersion: string | null;
    targetVersion: string | null;
    rowsAffected: number;
    metadata: Record<string, unknown> | null;
    createdAt: number;
    createdBy: string;
}
