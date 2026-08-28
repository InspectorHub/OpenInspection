import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from '../shared.schema';
import { SUPPORTED_SIGNATURE_IMAGE_TYPES } from '../../statutory/signature-image';

/**
 * A stored signature must be a format EVERY surface that draws it can draw.
 *
 * ⚠️ WHY THIS IS NARROWER THAN WHAT SOME RENDERERS ACCEPT. The agreement copy
 * and the report are HTML, and an `<img src="data:image/svg+xml,…">` displays
 * there without complaint — which is why `svg+xml` sat in this pattern
 * unnoticed. The statutory renderer is not HTML: it draws onto the authority's
 * own PDF with pdf-lib, which embeds PNG and JPEG and nothing else. The same
 * stored signature feeds both.
 *
 * ⚠️ WHY THE REFUSAL BELONGS AT STORAGE, NOT AT RENDER. A signature is saved
 * once, in Settings, and drawn by every surface afterwards. Refusing it here
 * puts the message in front of the inspector while they are looking at the
 * control that produced it; refusing it at render puts it in front of them in a
 * garage, at the moment they press send.
 *
 * ⚠️ THE LIST IS IMPORTED, NOT RESTATED. Two copies of one capability, only one
 * of them ever revisited, is how the vector format got in. There is one copy
 * now, and it lives beside the renderer that owns the constraint.
 */
const SIGNATURE_DATA_URI = new RegExp(
    `^data:image/(${SUPPORTED_SIGNATURE_IMAGE_TYPES.join('|')});base64,`,
);

/**
 * Validation schema for creating/updating agreements.
 */
export const AgreementSchema = z.object({
    name: z.string().min(1, 'Name is required').max(100).openapi({ example: 'Standard Service Agreement' }).describe('TODO describe name field for the OpenInspection MCP integration'),
    content: z.string().min(1, 'Content is required').openapi({ example: 'This agreement governs...' }).describe('TODO describe content field for the OpenInspection MCP integration'),
}).openapi('Agreement');

export const AgreementListResponseSchema = createApiResponseSchema(z.array(z.object({
    id: z.string().trim().min(1).describe('TODO describe id field for the OpenInspection MCP integration'),
    tenantId: z.string().trim().min(1).describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    name: z.string().describe('TODO describe name field for the OpenInspection MCP integration'),
    content: z.string().describe('TODO describe content field for the OpenInspection MCP integration'),
    version: z.number().describe('TODO describe version field for the OpenInspection MCP integration'),
    // Handler returns the raw Drizzle row; createdAt is a Date instance, not ISO string.
    createdAt: z.date().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
}))).openapi('AgreementListResponse');

/** Track I-a Task 9 — one recipient row in a multi-signer envelope. */
const SignerInputSchema = z.object({
    name: z.string().min(1).max(120).openapi({ example: 'John Smith' }).describe('Full name of this signer as it appears on the agreement'),
    email: z.string().email().openapi({ example: 'client@example.com' }).describe('Email address the per-signer signing link is sent to'),
    role: z.enum(['client', 'co_client', 'agent', 'other']).optional().openapi({ example: 'client' }).describe('Relationship of this signer to the inspection (client, co_client, agent, other)'),
    contactId: z.string().trim().min(1).nullable().optional().describe('Optional contacts.id this signer was picked from, when available'),
}).openapi('AgreementSignerInput');

export const SendAgreementSchema = z.object({
    agreementId: z.string().trim().min(1).openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe agreementId field for the OpenInspection MCP integration'),
    // Recipient email for a single-signer send; normalised to a one-signer envelope.
    // Omit when `signers` is provided. Gated by the refine below so exactly one
    // of the two recipient fields is always satisfiable.
    clientEmail: z.string().email().optional().openapi({ example: 'client@example.com' }).describe('Recipient email for a single-signer send; normalised to a one-signer envelope'),
    clientName: z.string().max(100).optional().openapi({ example: 'John Smith' }).describe('Display name for the single-signer recipient; ignored when signers is provided'),
    // Required: every envelope must be bound to an inspection.
    inspectionId: z.string().trim().min(1).openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('Inspection this agreement envelope is bound to; required for every send'),
    // Explicit multi-signer list; when absent, clientEmail is the sole signer.
    // All sends go through the envelope model (findOrCreate) regardless of which
    // recipient field is used.
    signers: z.array(SignerInputSchema).min(1).max(10).optional().describe('Explicit multi-signer list; when absent, clientEmail is the sole signer'),
    completionPolicy: z.enum(['all', 'one']).optional().openapi({ example: 'all' }).describe('Whether all signers must sign or any one signature completes the envelope'),
}).refine(
    // Valid request = clientEmail (single-signer) OR non-empty signers list
    // (multi-signer). The handler normalises both into the envelope model.
    (v) => Boolean(v.clientEmail) || (Array.isArray(v.signers) && v.signers.length > 0),
    { message: 'Provide clientEmail (single-signer) or a non-empty signers list (multi-signer).', path: ['clientEmail'] },
).openapi('SendAgreement');

export const AgreementResponseSchema = createApiResponseSchema(z.object({
    agreement: z.object({
        id: z.string().trim().min(1).describe('TODO describe id field for the OpenInspection MCP integration'),
        tenantId: z.string().trim().min(1).describe('TODO describe tenantId field for the OpenInspection MCP integration'),
        name: z.string().describe('TODO describe name field for the OpenInspection MCP integration'),
        content: z.string().describe('TODO describe content field for the OpenInspection MCP integration'),
        version: z.number().describe('TODO describe version field for the OpenInspection MCP integration'),
        createdAt: z.string().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
    }).describe('TODO describe agreement field for the OpenInspection MCP integration'),
})).openapi('AgreementResponse');

/**
 * #84 — what a write did to state the caller did not name.
 *
 * Only the two operations that CAN revoke declare it: editing bumps
 * `agreements.version` and deleting removes the row, and either makes
 * `BrandingService.getCancellationAttestation()` return null. Creating a
 * template cannot revoke anything, so `POST /agreements` does not carry a field
 * that would always read false.
 */
const AgreementWriteEffectsSchema = z.object({
    cancellationFeeAttestationRevoked: z.boolean().openapi({ example: false }).describe(
        'True when this write invalidated the confirmation that the workspace agreement contains '
        + 'a cancellation clause. While it is false, cancellation policies that charge a fee are '
        + 'refused; re-confirm under Settings > Online Booking > Cancellation policy. Always '
        + 'present, including when nothing was revoked.',
    ),
}).openapi('AgreementWriteEffects');

/**
 * ⚠️ `effects` is declared BEFORE `data`, and the handler builds its response
 * object in the same order. The MCP tool surface slices a tool result at
 * `MCP_MAX_RESULT_BYTES` (see `lib/mcp/result-limits`) and this body echoes the
 * whole agreement — a long agreement would push a trailing key past the cut.
 */
export const AgreementUpdateResponseSchema = z.object({
    success: z.literal(true),
    effects: AgreementWriteEffectsSchema,
    data: z.object({
        agreement: z.object({
            id: z.string().trim().min(1).describe('Identifier of the template that was updated'),
            tenantId: z.string().trim().min(1).describe('Workspace the template belongs to'),
            name: z.string().describe('Template name after the update'),
            content: z.string().describe('Sanitised agreement HTML after the update'),
            version: z.number().describe('Version after the update; incremented by every save, identical content included'),
            createdAt: z.string().describe('When the template was first created'),
        }).describe('The template as stored after the update'),
    }),
}).openapi('AgreementUpdateResponse');

export const AgreementDeleteResponseSchema = z.object({
    success: z.literal(true),
    effects: AgreementWriteEffectsSchema,
}).openapi('AgreementDeleteResponse');

/**
 * Validation schema for inspector pre-sign request body.
 * Spec 5H D1 — optional inspector signature before sending to client.
 */
export const InspectorSignSchema = z.object({
    signatureBase64: z.string().min(50).max(500_000)
        .regex(SIGNATURE_DATA_URI)
        .openapi({ example: 'data:image/png;base64,iVBORw0KGgo...' })
        .describe('Inspector signature as data URI with a base64-encoded PNG or JPEG body. '
            + 'Vector formats are refused: the statutory renderer draws onto the authority\'s '
            + 'own PDF and cannot embed one.'),
}).openapi('InspectorSign');

/**
 * Spec 5H D2 — save the authenticated user's default signature image.
 * Reused for auto-sign on publish + as the SignaturePad default starting state
 * in Settings → Profile.
 */
export const UserDefaultSignatureSchema = z.object({
    signatureBase64: z.string().min(50).max(500_000)
        .regex(SIGNATURE_DATA_URI)
        .openapi({ example: 'data:image/png;base64,iVBORw0KGgo...' })
        .describe('Inspector\'s saved signature as a PNG or JPEG data URI. Reused for auto-sign '
            + 'on publish + as the SignaturePad default starting state. Vector formats are '
            + 'refused: the statutory renderer draws onto the authority\'s own PDF and cannot '
            + 'embed one.'),
}).openapi('UserDefaultSignature');
