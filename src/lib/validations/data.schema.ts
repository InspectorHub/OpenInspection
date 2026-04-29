import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

export const ImportResultSchema = z.object({
    imported: z.number(),
    skipped:  z.number(),
    errors:   z.array(z.string()),
});

export const ImportResultResponseSchema = createApiResponseSchema(ImportResultSchema);
