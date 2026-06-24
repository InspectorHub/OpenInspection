import { z } from '@hono/zod-openapi';

export const InspectorSignatureSchema = z.object({
    signatureBase64: z.string().min(100).max(500_000).describe('TODO describe signatureBase64 field for the OpenInspection MCP integration'),
    signedAt:        z.number().int().positive().describe('TODO describe signedAt field for the OpenInspection MCP integration'),
}).openapi('InspectorSignature');
