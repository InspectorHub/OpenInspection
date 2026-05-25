import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

export const ImportResultSchema = z.object({
    imported: z.number().describe('TODO describe imported field for the OpenInspection MCP integration'),
    skipped:  z.number().describe('TODO describe skipped field for the OpenInspection MCP integration'),
    errors:   z.array(z.string()).describe('TODO describe errors field for the OpenInspection MCP integration'),
});

export const ImportResultResponseSchema = createApiResponseSchema(ImportResultSchema);
