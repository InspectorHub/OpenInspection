import { z } from '@hono/zod-openapi';

export const InspectorSignatureSchema = z.object({
    signatureBase64: z.string().min(100).max(500_000).describe('Signature image encoded as base64 text.'),
    signedAt:        z.number().int().positive().describe('When the inspector signed, as a Unix timestamp in milliseconds.'),
}).openapi('InspectorSignature');
