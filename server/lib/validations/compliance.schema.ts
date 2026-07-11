// server/lib/validations/compliance.schema.ts
// Commercial PCA Phase M Task 6 — request/response Zod schemas for the
// compliance API routes (sign-off, PSQ, document review, conformance).
// Mirrors the ComplianceService (Task 5) row shapes 1:1; timestamp columns
// are epoch-ms numbers on the wire (see admin-esign.ts's `.getTime()`
// convention — the schema-normalization epoch-ms rule applies here too).
import { z } from '@hono/zod-openapi';

export const SignoffBodySchema = z.object({
    role: z.enum(['field_observer', 'pcr_reviewer']).describe('Sign-off role: the field observer who performed the walk-through, or the PCR reviewer exercising responsible control.'),
    personId: z.string().min(1).describe('The signer\'s user/identity id (accountability record).'),
    name: z.string().min(1).describe('The signer\'s display name, as rendered in the Appendix D qualifications block.'),
    license: z.string().nullable().optional().describe('Professional license number, if applicable.'),
    qualificationsRef: z.string().nullable().optional().describe('Pointer to the qualifications narrative/exhibit.'),
    dualRole: z.boolean().optional().describe('True when one person holds both sign-off roles (ASTM §7.6).'),
});

export const DocReviewPatchSchema = z.object({
    requested: z.boolean().optional().describe('Whether the document was requested from the point-of-contact.'),
    received: z.boolean().optional().describe('Whether the requested document was received.'),
    reviewed: z.boolean().optional().describe('Whether the received document was reviewed by the inspector.'),
    na: z.boolean().optional().describe('Whether this document does not apply to this property.'),
    notes: z.string().nullable().optional().describe('Free-text notes on the request/receipt/review status.'),
}).describe('Partial patch — omitted keys are left unchanged.');

export const PsqUpsertSchema = z.object({
    responses: z.record(z.string(), z.unknown()).describe('Structured Pre-Survey Questionnaire responses (ASTM §8.5).'),
});

export const PsqStatusSchema = z.object({
    status: z.enum(['sent', 'received', 'declined']).describe('New PSQ lifecycle status: sent to the point-of-contact, received back, or declined outright.'),
    reason: z.string().optional().describe('Required context when status=declined — carried into the auto-disclosed Deviations entry.'),
});

// ── Response row shapes ─────────────────────────────────────────────────────

export const ReportSignoffRowSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    inspectionId: z.string(),
    role: z.enum(['field_observer', 'pcr_reviewer']),
    personId: z.string(),
    name: z.string(),
    license: z.string().nullable(),
    qualificationsRef: z.string().nullable(),
    signedAt: z.number().describe('Unix epoch milliseconds.'),
    signatureRef: z.string().describe('base64url Ed25519 signature over the canonical attestation payload.'),
    dualRole: z.boolean(),
});

export const PsqResponseRowSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    inspectionId: z.string(),
    responses: z.record(z.string(), z.unknown()).nullable(),
    status: z.enum(['sent', 'received', 'declined']),
    shareToken: z.string().nullable(),
    sentAt: z.number().nullable(),
    receivedAt: z.number().nullable(),
    updatedAt: z.number(),
});

export const DocumentReviewItemRowSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    inspectionId: z.string(),
    documentKey: z.string(),
    label: z.string(),
    requested: z.boolean(),
    received: z.boolean(),
    reviewed: z.boolean(),
    na: z.boolean(),
    notes: z.string().nullable(),
    sortOrder: z.number().int(),
});

export const AstmConformanceSchema = z.object({
    standard: z.literal('E2018-24'),
    conforms: z.boolean(),
});

export const ComplianceResponseSchema = z.object({
    reportSignoffs: z.array(ReportSignoffRowSchema),
    psq: PsqResponseRowSchema.nullable(),
    documentReview: z.array(DocumentReviewItemRowSchema),
    conformance: AstmConformanceSchema,
});
