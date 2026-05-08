import { z } from '@hono/zod-openapi';

/**
 * Sprint 2 S2-8 — query + response schema for the per-import history endpoint.
 *
 * Either filter by templateId or libraryId (mutually exclusive); omit both to
 * list all events for the tenant. Pagination via simple page/pageSize.
 */
export const ImportHistoryQuerySchema = z.object({
    templateId: z.string().optional(),
    libraryId:  z.string().optional(),
    page:       z.coerce.number().int().min(1).optional(),
    pageSize:   z.coerce.number().int().min(1).max(100).optional(),
});

export const ImportHistoryActionSchema = z.enum(['install', 'update', 'replace', 'migrate']);

export const ImportHistoryItemSchema = z.object({
    id:            z.string(),
    templateId:    z.string().nullable(),
    libraryId:     z.string().nullable(),
    action:        ImportHistoryActionSchema,
    sourceVersion: z.string().nullable(),
    targetVersion: z.string().nullable(),
    rowsAffected:  z.number().int(),
    metadata:      z.record(z.string(), z.unknown()).nullable(),
    createdAt:     z.number().int(),
    createdBy:     z.string(),
});

export type ImportHistoryItem = z.infer<typeof ImportHistoryItemSchema>;
