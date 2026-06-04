import { z } from '@hono/zod-openapi';

/** PUT body — save an override. blocks is a partial blockKey→value map. */
export const SaveEmailTemplateSchema = z.object({
  subject: z.string().max(200).nullable(),
  blocks: z.record(z.string(), z.string().max(4000)).nullable(),
  enabled: z.boolean(),
}).openapi('SaveEmailTemplate');

/** POST preview body — render unsaved edits against sample data. */
export const PreviewEmailTemplateSchema = z.object({
  subject: z.string().max(200).nullable().optional(),
  blocks: z.record(z.string(), z.string().max(4000)).nullable().optional(),
}).openapi('PreviewEmailTemplate');
