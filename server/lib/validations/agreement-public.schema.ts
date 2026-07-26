import { z } from '@hono/zod-openapi';

/** Envelope / per-signer lifecycle status. */
const AgreementSignerStatusSchema = z.enum([
    'pending', 'sent', 'viewed', 'signed', 'declined', 'expired',
]);

/** Who a signer is to the inspection. */
const AgreementSignerRoleSchema = z.enum(['client', 'co_client', 'agent', 'other']);

/**
 * Body of GET /api/public/agreements/:token — what the public sign page renders
 * for the signer the presented token resolves to (Track I-a, multi-signer).
 *
 * Extracted from the route's inline response schema so the frontend can derive
 * its type (`z.infer`) instead of hand-copying the fields. `app/` imports from
 * `server/lib/**` only, so a schema a client type depends on cannot live in
 * `server/api/**`.
 */
export const PublicAgreementBodySchema = z.object({
    status: AgreementSignerStatusSchema.describe('Envelope aggregate status'),
    envelopeId: z.string().describe('Stable envelope id — the public /verify/:envelopeId page identifier surfaced to signers after signing'),
    clientName: z.string().nullable().describe('Client name shown in the agreement header'),
    agreementName: z.string().describe('Agreement template name'),
    agreementContent: z.string().describe('Pinned content snapshot served to the signer (never the live template)'),
    signer: z.object({
        name: z.string(),
        role: AgreementSignerRoleSchema,
        status: AgreementSignerStatusSchema,
    }).describe('The signer resolved from the presented token'),
    progress: z.object({
        signed: z.number().int(),
        total: z.number().int(),
    }).describe('Signature progress across the envelope'),
    completionPolicy: z.enum(['all', 'one']).describe('Envelope completion policy'),
});
