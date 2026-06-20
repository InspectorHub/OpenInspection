import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from '../shared.schema';

/**
 * Validation schema for creating/updating agreements.
 */
export const AgreementSchema = z.object({
    name: z.string().min(1, 'Name is required').max(100).openapi({ example: 'Standard Service Agreement' }).describe('TODO describe name field for the OpenInspection MCP integration'),
    content: z.string().min(1, 'Content is required').openapi({ example: 'This agreement governs...' }).describe('TODO describe content field for the OpenInspection MCP integration'),
}).openapi('Agreement');

export const AgreementListResponseSchema = createApiResponseSchema(z.array(z.object({
    id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
    tenantId: z.string().uuid().describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    name: z.string().describe('TODO describe name field for the OpenInspection MCP integration'),
    content: z.string().describe('TODO describe content field for the OpenInspection MCP integration'),
    version: z.number().describe('TODO describe version field for the OpenInspection MCP integration'),
    // Handler returns the raw Drizzle row; createdAt is a Date instance, not ISO string.
    createdAt: z.date().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
}))).openapi('AgreementListResponse');

/** Track I-a Task 9 — one recipient row in a multi-signer envelope. */
export const SignerInputSchema = z.object({
    name: z.string().min(1).max(120).openapi({ example: 'John Smith' }).describe('Full name of this signer as it appears on the agreement'),
    email: z.string().email().openapi({ example: 'client@example.com' }).describe('Email address the per-signer signing link is sent to'),
    role: z.enum(['client', 'co_client', 'agent', 'other']).optional().openapi({ example: 'client' }).describe('Relationship of this signer to the inspection (client, co_client, agent, other)'),
    contactId: z.string().uuid().nullable().optional().describe('Optional contacts.id this signer was picked from, when available'),
}).openapi('AgreementSignerInput');

export const SendAgreementSchema = z.object({
    agreementId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe agreementId field for the OpenInspection MCP integration'),
    // Track I-a Task 9 — `clientEmail` is only consumed on the legacy
    // single-recipient path; the multi-signer path keys recipients off the
    // `signers` array. Optional here, gated by the refine below so exactly one
    // of the two paths is always satisfiable.
    clientEmail: z.string().email().optional().openapi({ example: 'client@example.com' }).describe('Recipient email for the legacy single-signer send; omit when `signers` is provided'),
    clientName: z.string().max(100).optional().openapi({ example: 'John Smith' }).describe('TODO describe clientName field for the OpenInspection MCP integration'),
    inspectionId: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe inspectionId field for the OpenInspection MCP integration'),
    // Track I-a Task 9 — multi-signer envelope. When `signers` is provided the
    // send routes through AgreementService.findOrCreate (signer rows + snapshot
    // pinning + per-signer links). Omitted → legacy single-recipient behavior.
    signers: z.array(SignerInputSchema).min(1).max(10).optional().describe('Optional multi-signer recipient list; when present routes through the envelope model'),
    completionPolicy: z.enum(['all', 'one']).optional().openapi({ example: 'all' }).describe('Whether all signers must sign or any one signature completes the envelope'),
}).refine(
    // Valid request = legacy path (clientEmail present) OR multi-signer path
    // (signers non-empty). The handler routes on these same two conditions.
    (v) => Boolean(v.clientEmail) || (Array.isArray(v.signers) && v.signers.length > 0),
    { message: 'Provide clientEmail (single-signer) or a non-empty signers list (multi-signer).', path: ['clientEmail'] },
).openapi('SendAgreement');

export const AgreementResponseSchema = createApiResponseSchema(z.object({
    agreement: z.object({
        id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
        tenantId: z.string().uuid().describe('TODO describe tenantId field for the OpenInspection MCP integration'),
        name: z.string().describe('TODO describe name field for the OpenInspection MCP integration'),
        content: z.string().describe('TODO describe content field for the OpenInspection MCP integration'),
        version: z.number().describe('TODO describe version field for the OpenInspection MCP integration'),
        createdAt: z.string().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
    }).describe('TODO describe agreement field for the OpenInspection MCP integration'),
})).openapi('AgreementResponse');

/**
 * Validation schema for inspector pre-sign request body.
 * Spec 5H D1 — optional inspector signature before sending to client.
 */
export const InspectorSignSchema = z.object({
    signatureBase64: z.string().min(50).max(500_000)
        .regex(/^data:image\/(png|jpeg|svg\+xml);base64,/)
        .openapi({ example: 'data:image/png;base64,iVBORw0KGgo...' })
        .describe('Inspector signature as data URI with base64-encoded PNG/JPEG/SVG body.'),
}).openapi('InspectorSign');

/**
 * Spec 5H D2 — save the authenticated user's default signature image.
 * Reused for auto-sign on publish + as the SignaturePad default starting state
 * in Settings → Profile.
 */
export const UserDefaultSignatureSchema = z.object({
    signatureBase64: z.string().min(50).max(500_000)
        .regex(/^data:image\/(png|jpeg|svg\+xml);base64,/)
        .openapi({ example: 'data:image/png;base64,iVBORw0KGgo...' })
        .describe('Inspector\'s saved signature as data URI. Reused for auto-sign on publish + as the SignaturePad default starting state.'),
}).openapi('UserDefaultSignature');
