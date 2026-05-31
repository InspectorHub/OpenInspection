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

export const ImportHistoryActionSchema = z.enum(['install', 'update', 'replace', 'migrate']);

export const ImportHistoryItemSchema = z.object({
    id:            z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    templateId:    z.string().nullable().describe('TODO describe templateId field for the OpenInspection MCP integration'),
    libraryId:     z.string().nullable().describe('TODO describe libraryId field for the OpenInspection MCP integration'),
    action:        ImportHistoryActionSchema.describe('TODO describe action field for the OpenInspection MCP integration'),
    sourceVersion: z.string().nullable().describe('TODO describe sourceVersion field for the OpenInspection MCP integration'),
    targetVersion: z.string().nullable().describe('TODO describe targetVersion field for the OpenInspection MCP integration'),
    rowsAffected:  z.number().int().describe('TODO describe rowsAffected field for the OpenInspection MCP integration'),
    metadata:      z.record(z.string(), z.unknown()).nullable().describe('TODO describe metadata field for the OpenInspection MCP integration'),
    createdAt:     z.number().int().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
    createdBy:     z.string().describe('TODO describe createdBy field for the OpenInspection MCP integration'),
});

export type ImportHistoryItem = z.infer<typeof ImportHistoryItemSchema>;
