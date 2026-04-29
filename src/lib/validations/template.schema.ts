import { z } from '@hono/zod-openapi';

/**
 * Validation schema for inspection templates.
 */
export const CreateTemplateSchema = z.object({
    name: z.string().min(1, 'Template name is required').max(100),
    schema: z.union([z.string(), z.record(z.string(), z.unknown())]),
});

/**
 * Validation schema for updating a template.
 */
export const UpdateTemplateSchema = CreateTemplateSchema.partial();
