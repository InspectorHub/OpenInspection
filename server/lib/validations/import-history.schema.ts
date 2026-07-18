import { z } from '@hono/zod-openapi';

/**
 * Sprint 2 S2-8 — query + response schema for the per-import history endpoint.
 *
 * Either filter by templateId or libraryId (mutually exclusive); omit both to
 * list all events for the tenant. Pagination via simple page/pageSize.
 */
export const ImportHistoryQuerySchema = z.object({
    templateId: z.string().optional().describe('TODO describe templateId field for the OpenInspection MCP integration'),
    libraryId:  z.string().optional().describe('TODO describe libraryId field for the OpenInspection MCP integration'),
    page:       z.coerce.number().int().min(1).optional().describe('TODO describe page field for the OpenInspection MCP integration'),
    pageSize:   z.coerce.number().int().min(1).max(100).optional().describe('TODO describe pageSize field for the OpenInspection MCP integration'),
});

// Shape of a single import-history event row returned by the service. Declared
// as a plain interface — the row is assembled in code, not parsed from untrusted
// input, so no runtime Zod schema is needed here.
export interface ImportHistoryItem {
    id: string;
    templateId: string | null;
    libraryId: string | null;
    action: 'install' | 'update' | 'replace' | 'migrate';
    sourceVersion: string | null;
    targetVersion: string | null;
    rowsAffected: number;
    metadata: Record<string, unknown> | null;
    createdAt: number;
    createdBy: string;
}
