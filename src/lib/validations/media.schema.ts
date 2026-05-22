// Design System 0520 M14 — PhotoStudio annotation persistence (subsystem A,
// phase 4). The annotation payload is opaque to the server — only the size
// bound is enforced. Caption is user-supplied and surfaces in the published
// report. Validation runs server-side via OpenAPIHono createRoute().
import { z } from '@hono/zod-openapi';

export const UpdateMediaAnnotationsSchema = z.object({
    annotations: z.string().max(8 * 1024, 'annotations must be ≤ 8 KB').describe('TODO describe annotations field for the OpenInspection MCP integration'),
    caption:     z.string().max(200, 'caption must be ≤ 200 chars').describe('TODO describe caption field for the OpenInspection MCP integration'),
}).openapi('UpdateMediaAnnotations');

export type UpdateMediaAnnotationsInput = z.infer<typeof UpdateMediaAnnotationsSchema>;
