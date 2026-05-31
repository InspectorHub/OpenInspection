import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

/**
 * Validation schema for the branding configuration update.
 */
export const UpdateBrandingSchema = z.object({
    siteName: z.string().min(1, 'Site name is required').max(50).optional().openapi({ example: 'My Inspection Pro' }).describe('TODO describe siteName field for the OpenInspection MCP integration'),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').optional().openapi({ example: '#4f46e5' }).describe('TODO describe primaryColor field for the OpenInspection MCP integration'),
    supportEmail: z.string().email('Invalid email address').optional().openapi({ example: 'support@example.com' }).describe('TODO describe supportEmail field for the OpenInspection MCP integration'),
    billingUrl: z.string().url('Invalid URL').or(z.literal('')).optional().openapi({ example: 'https://example.com/billing' }).describe('TODO describe billingUrl field for the OpenInspection MCP integration'),
    gaMeasurementId: z.string().regex(/^G-[A-Z0-9]+$/, 'Invalid GA Measurement ID').or(z.literal('')).optional().openapi({ example: 'G-12345678' }).describe('TODO describe gaMeasurementId field for the OpenInspection MCP integration'),
    reportTheme: z.enum(['modern', 'classic', 'minimal']).optional().openapi({ example: 'modern' }).describe('TODO describe reportTheme field for the OpenInspection MCP integration'),
    // Sprint 2 S2-4 — gate the per-defect "Estimated cost: $X – $Y" badge.
    showEstimates: z.boolean().optional().openapi({ example: true }).describe('TODO describe showEstimates field for the OpenInspection MCP integration'),
    // Track E1 (ITB §11) — gate the "Repair List" tab on the published report.
    enableRepairList: z.boolean().optional().openapi({ example: true }).describe('TODO describe enableRepairList field for the OpenInspection MCP integration'),
    // Sprint 3 S3-2 — gate the customer-driven "Generate repair request"
    // export link on the published report. Independent of enableRepairList.
    enableCustomerRepairExport: z.boolean().optional().openapi({ example: true }).describe('TODO describe enableCustomerRepairExport field for the OpenInspection MCP integration'),
    // Round-2 backlog #10 — tenant-wide default for the per-inspection
    // paywall introduced in Sprint 1 D-7 (ReportGatePage). When true, every
    // newly created inspection inherits paymentRequired=true. Per-inspection
    // override remains the source of truth at gate time.
    blockUnpaid: z.boolean().optional().openapi({ example: false }).describe('TODO describe blockUnpaid field for the OpenInspection MCP integration'),
    // Round-2 backlog #10 — tenant-wide default for the per-inspection
    // agreement gate. When true, every newly created inspection inherits
    // agreementRequired=true.
    blockUnsignedAgreement: z.boolean().optional().openapi({ example: false }).describe('TODO describe blockUnsignedAgreement field for the OpenInspection MCP integration'),
    // Round-2 backlog G3 (Spectora §4.1) — extra referral-source labels the
    // tenant wants on the inspection settings dropdown. The seed list of
    // seven values (Realtor / Past Client / …) is hardcoded; this array
    // appends to it. Trimmed entries; max 32 to keep the dropdown usable.
    customReferralSources: z.array(z.string().min(1).max(50)).max(32).optional().openapi({ example: ['Magazine ad', 'Trade show'] }).describe('TODO describe customReferralSources field for the OpenInspection MCP integration'),
    // Migration 0059 — Workers Paid PDF pipeline opt-in. Default OFF.
    enablePdfPipeline: z.boolean().optional().openapi({ example: false }).describe('TODO describe enablePdfPipeline field for the OpenInspection MCP integration'),
    // Design System 0520 subsystem E P8 — InterNACHI inspector ID.
    // Surfaced in the TeamCredit footer block on the customer report.
    // Accepts the canonical NACHI format (NACHI##### or numeric IDs).
    nachiNumber: z.string().regex(/^[A-Za-z0-9-]{4,32}$/, 'Invalid NACHI number')
        .nullable().optional()
        .openapi({ example: 'NACHI22041901' }).describe('TODO describe nachiNumber field for the OpenInspection MCP integration'),
}).openapi('UpdateBranding');

/**
 * Validation schema for inviting a new team member.
 */
export const InviteMemberSchema = z.object({
    email: z.string().email('Invalid email address').openapi({ example: 'new-user@example.com' }).describe('TODO describe email field for the OpenInspection MCP integration'),
    role: z.enum(['admin', 'inspector', 'agent', 'owner', 'lead', 'specialist', 'apprentice', 'office'])
        .default('inspector').openapi({ example: 'lead' }).describe('TODO describe role field for the OpenInspection MCP integration'),
    /** Required when role === 'apprentice'. Must be a user id from the
     *  inviting tenant. Carried through to users.mentor_id at accept. */
    mentorId: z.string().uuid().optional().openapi({ example: '6e9b6b1c-4a3f-4ae3-9c10-1f1c3f4d5e6a' }).describe('TODO describe mentorId field for the OpenInspection MCP integration'),
    /** Used when role === 'specialist'. Section ids from the active
     *  template. Carried through to users.assigned_section_ids JSON. */
    assignedSectionIds: z.array(z.string().min(1)).optional().openapi({ example: ['s-roof', 's-elec'] }).describe('TODO describe assignedSectionIds field for the OpenInspection MCP integration'),
}).openapi('InviteMember');

/**
 * Validation schema for the GDPA data erasure request.
 */
export const DataErasureSchema = z.object({
    clientEmail: z.string().email('Invalid email address').openapi({ example: 'client-to-delete@example.com' }).describe('TODO describe clientEmail field for the OpenInspection MCP integration'),
}).openapi('DataErasure');

/**
 * Validation schema for creating/updating agreements.
 */
export const AgreementSchema = z.object({
    name: z.string().min(1, 'Name is required').max(100).openapi({ example: 'Standard Service Agreement' }).describe('TODO describe name field for the OpenInspection MCP integration'),
    content: z.string().min(1, 'Content is required').openapi({ example: 'This agreement governs...' }).describe('TODO describe content field for the OpenInspection MCP integration'),
}).openapi('Agreement');

/**
 * Validation schema for tenant status updates (M2M).
 */
export const TenantStatusSchema = z.object({
    id: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe id field for the OpenInspection MCP integration'),
    subdomain: z.string().min(1).openapi({ example: 'acme' }).describe('TODO describe subdomain field for the OpenInspection MCP integration'),
    status: z.string().min(1).openapi({ example: 'active' }).describe('TODO describe status field for the OpenInspection MCP integration'),
    tier: z.string().optional().openapi({ example: 'pro' }).describe('TODO describe tier field for the OpenInspection MCP integration'),
    name: z.string().optional().openapi({ example: 'Acme Corp' }).describe('TODO describe name field for the OpenInspection MCP integration'),
    deploymentMode: z.enum(['shared', 'silo']).default('shared').openapi({ example: 'shared' }).describe('TODO describe deploymentMode field for the OpenInspection MCP integration'),
    setupVerificationCode: z.string().optional().openapi({ example: 'XYZ12345' }).describe('TODO describe setupVerificationCode field for the OpenInspection MCP integration'),
    adminEmail: z.string().email().optional().openapi({ example: 'admin@acme.com' }).describe('TODO describe adminEmail field for the OpenInspection MCP integration'),
    adminPasswordHash: z.string().optional().openapi({ example: '...sha256...' }).describe('TODO describe adminPasswordHash field for the OpenInspection MCP integration'),
}).openapi('TenantStatus');

/**
 * Validation schema for silo DB ID updates (M2M).
 */
export const SiloUpdateSchema = z.object({
    tenantId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    siloDbId: z.string().min(1).openapi({ example: 'db_12345' }).describe('TODO describe siloDbId field for the OpenInspection MCP integration'),
}).openapi('SiloUpdate');

/**
 * Validation schema for Stripe Connect updates (M2M).
 */
export const StripeConnectSchema = z.object({
    subdomain: z.string().min(1).openapi({ example: 'acme' }).describe('TODO describe subdomain field for the OpenInspection MCP integration'),
    stripeConnectAccountId: z.string().min(1).openapi({ example: 'acct_12345' }).describe('TODO describe stripeConnectAccountId field for the OpenInspection MCP integration'),
}).openapi('StripeConnect');

/**
 * Body schema for PATCH /api/integration/tenants/:subdomain (M2M).
 * subdomain comes from URL param, not body.
 */
export const TenantStatusBodySchema = z.object({
    id: z.string().uuid().optional().describe('TODO describe id field for the OpenInspection MCP integration'),
    status: z.string().min(1).describe('TODO describe status field for the OpenInspection MCP integration'),
    tier: z.string().optional().describe('TODO describe tier field for the OpenInspection MCP integration'),
    name: z.string().optional().describe('TODO describe name field for the OpenInspection MCP integration'),
    deploymentMode: z.enum(['shared', 'silo']).optional().describe('TODO describe deploymentMode field for the OpenInspection MCP integration'),
    setupVerificationCode: z.string().optional().describe('TODO describe setupVerificationCode field for the OpenInspection MCP integration'),
    maxUsers: z.number().int().positive().optional().describe('TODO describe maxUsers field for the OpenInspection MCP integration'),
    adminEmail: z.string().email().optional().describe('TODO describe adminEmail field for the OpenInspection MCP integration'),
    adminPasswordHash: z.string().optional().describe('TODO describe adminPasswordHash field for the OpenInspection MCP integration'),
});

/**
 * Body schema for POST /api/integration/tenants/:subdomain/stripe-connect (M2M).
 */
export const StripeConnectBodySchema = z.object({
    accountId: z.string().min(1).describe('TODO describe accountId field for the OpenInspection MCP integration'),
});

/**
 * Body schema for inspector-facing PUT /api/admin/stripe-connect.
 * Validates the account ID matches Stripe's `acct_*` format.
 */
export const StripeConnectAccountSchema = z.object({
    accountId: z.string().regex(/^acct_[a-zA-Z0-9]{10,}$/, 'Invalid Stripe account ID — must look like acct_xxxxx').openapi({ example: 'acct_1AbCdEfGhIjKlMnO' }).describe('TODO describe accountId field for the OpenInspection MCP integration'),
}).openapi('StripeConnectAccount');

/**
 * Response Schemas
 */
export const AdminExportResponseSchema = createApiResponseSchema(z.object({
    exportedAt: z.string().openapi({ example: '2024-04-09T10:00:00Z' }).describe('TODO describe exportedAt field for the OpenInspection MCP integration'),
    tenantId: z.string().uuid().describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    inspections: z.array(z.record(z.string(), z.any())).describe('TODO describe inspections field for the OpenInspection MCP integration'),
    templates: z.array(z.record(z.string(), z.any())).describe('TODO describe templates field for the OpenInspection MCP integration'),
    agreements: z.array(z.record(z.string(), z.any())).describe('TODO describe agreements field for the OpenInspection MCP integration'),
    inspectionResults: z.array(z.record(z.string(), z.any())).describe('TODO describe inspectionResults field for the OpenInspection MCP integration'),
})).openapi('AdminExportResponse');

export const MemberListResponseSchema = createApiResponseSchema(z.array(z.object({
    id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
    email: z.string().describe('TODO describe email field for the OpenInspection MCP integration'),
    role: z.string().describe('TODO describe role field for the OpenInspection MCP integration'),
    createdAt: z.string().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
}))).openapi('MemberListResponse');

export const AuditLogResponseSchema = createApiResponseSchema(z.object({
    items: z.array(z.object({
        id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
        action: z.string().describe('TODO describe action field for the OpenInspection MCP integration'),
        entityType: z.string().describe('TODO describe entityType field for the OpenInspection MCP integration'),
        metadata: z.any().nullable().describe('TODO describe metadata field for the OpenInspection MCP integration'),
        ipAddress: z.string().nullable().describe('TODO describe ipAddress field for the OpenInspection MCP integration'),
        createdAt: z.string().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
        userId: z.string().uuid().nullable().describe('TODO describe userId field for the OpenInspection MCP integration'),
    })).describe('TODO describe items field for the OpenInspection MCP integration'),
    nextCursor: z.string().nullable().describe('TODO describe nextCursor field for the OpenInspection MCP integration'),
})).openapi('AuditLogResponse');

export const BrandingResponseSchema = createApiResponseSchema(z.object({
    branding: z.object({
        siteName: z.string().describe('TODO describe siteName field for the OpenInspection MCP integration'),
        primaryColor: z.string().describe('TODO describe primaryColor field for the OpenInspection MCP integration'),
        logoUrl: z.string().nullable().describe('TODO describe logoUrl field for the OpenInspection MCP integration'),
        supportEmail: z.string().describe('TODO describe supportEmail field for the OpenInspection MCP integration'),
        billingUrl: z.string().nullable().describe('TODO describe billingUrl field for the OpenInspection MCP integration'),
        gaMeasurementId: z.string().nullable().describe('TODO describe gaMeasurementId field for the OpenInspection MCP integration'),
    }).describe('TODO describe branding field for the OpenInspection MCP integration'),
})).openapi('BrandingResponse');

export const InviteResponseSchema = createApiResponseSchema(z.object({
    inviteLink: z.string().describe('TODO describe inviteLink field for the OpenInspection MCP integration'),
    expiresAt: z.string().describe('TODO describe expiresAt field for the OpenInspection MCP integration'),
})).openapi('InviteResponse');

export const ImportResponseSchema = createApiResponseSchema(z.object({
    message: z.string().describe('TODO describe message field for the OpenInspection MCP integration'),
    imported: z.object({
        templates: z.number().describe('TODO describe templates field for the OpenInspection MCP integration'),
        agreements: z.number().describe('TODO describe agreements field for the OpenInspection MCP integration'),
        inspections: z.number().describe('TODO describe inspections field for the OpenInspection MCP integration'),
        results: z.number().describe('TODO describe results field for the OpenInspection MCP integration'),
    }).describe('TODO describe imported field for the OpenInspection MCP integration'),
})).openapi('ImportResponse');

export const AgreementListResponseSchema = createApiResponseSchema(z.array(z.object({
    id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
    tenantId: z.string().uuid().describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    name: z.string().describe('TODO describe name field for the OpenInspection MCP integration'),
    content: z.string().describe('TODO describe content field for the OpenInspection MCP integration'),
    version: z.number().describe('TODO describe version field for the OpenInspection MCP integration'),
    // Handler returns the raw Drizzle row; createdAt is a Date instance, not ISO string.
    createdAt: z.date().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
}))).openapi('AgreementListResponse');

export const SendAgreementSchema = z.object({
    agreementId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe agreementId field for the OpenInspection MCP integration'),
    clientEmail: z.string().email().openapi({ example: 'client@example.com' }).describe('TODO describe clientEmail field for the OpenInspection MCP integration'),
    clientName: z.string().max(100).optional().openapi({ example: 'John Smith' }).describe('TODO describe clientName field for the OpenInspection MCP integration'),
    inspectionId: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe inspectionId field for the OpenInspection MCP integration'),
}).openapi('SendAgreement');

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

export const EraseDataResponseSchema = createApiResponseSchema(z.object({
    message: z.string().describe('TODO describe message field for the OpenInspection MCP integration'),
    templates: z.number().optional().describe('TODO describe templates field for the OpenInspection MCP integration'),
    inspections: z.number().optional().describe('TODO describe inspections field for the OpenInspection MCP integration'),
    results: z.number().optional().describe('TODO describe results field for the OpenInspection MCP integration'),
})).openapi('EraseDataResponse');

export const TeamMembersResponseSchema = createApiResponseSchema(z.object({
    members: z.array(z.object({
        id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
        email: z.string().describe('TODO describe email field for the OpenInspection MCP integration'),
        role: z.string().describe('TODO describe role field for the OpenInspection MCP integration'),
        createdAt: z.string().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
    })).describe('TODO describe members field for the OpenInspection MCP integration'),
    invites: z.array(z.object({
        id: z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
        email: z.string().describe('TODO describe email field for the OpenInspection MCP integration'),
        role: z.string().describe('TODO describe role field for the OpenInspection MCP integration'),
        status: z.string().describe('TODO describe status field for the OpenInspection MCP integration'),
        expiresAt: z.string().describe('TODO describe expiresAt field for the OpenInspection MCP integration'),
    })).describe('TODO describe invites field for the OpenInspection MCP integration'),
})).openapi('TeamMembersResponse');

// Spec 2026-05-07 — Comments Library unification.
// `ratingBucket` aligns user snippets with the seeded 248-entry library so
// both surfaces (the /comments page and the inspection-edit Library drawer)
// classify entries identically. `section` is free-text so tenants can grow
// their own taxonomy alongside the seeded sections (Roof / Electrical / …).
const RatingBucketSchema = z.enum(['satisfactory', 'monitor', 'defect']);

export const CommentSchema = z.object({
    text: z.string().min(1).max(1000).openapi({ example: 'Evidence of previous repair was observed.' }).describe('TODO describe text field for the OpenInspection MCP integration'),
    category: z.string().max(50).optional().nullable().openapi({ example: 'Roofing' }).describe('TODO describe category field for the OpenInspection MCP integration'),
    ratingBucket: RatingBucketSchema.optional().nullable().openapi({ example: 'defect' }).describe('TODO describe ratingBucket field for the OpenInspection MCP integration'),
    section: z.string().max(64).optional().nullable().openapi({ example: 'Roof' }).describe('TODO describe section field for the OpenInspection MCP integration'),
    // Comments Library Upgrade — canonical single item label drives sort/filter.
    itemLabel: z.string().max(120).optional().nullable().openapi({ example: 'Roof Covering' }),
}).openapi('Comment');

export const UpdateCommentSchema = z.object({
    text: z.string().min(1).max(1000).openapi({ example: 'Evidence of previous repair was observed.' }).describe('TODO describe text field for the OpenInspection MCP integration'),
    category: z.string().max(50).nullable().optional().openapi({ example: 'Roofing' }).describe('TODO describe category field for the OpenInspection MCP integration'),
    ratingBucket: RatingBucketSchema.nullable().optional().openapi({ example: 'defect' }).describe('TODO describe ratingBucket field for the OpenInspection MCP integration'),
    section: z.string().max(64).nullable().optional().openapi({ example: 'Roof' }).describe('TODO describe section field for the OpenInspection MCP integration'),
    itemLabel: z.string().max(120).optional().nullable(),
}).openapi('UpdateComment');

export const CommentResponseSchema = z.object({
    id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
    tenantId: z.string().uuid().describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    text: z.string().describe('TODO describe text field for the OpenInspection MCP integration'),
    category: z.string().nullable().describe('TODO describe category field for the OpenInspection MCP integration'),
    ratingBucket: RatingBucketSchema.nullable().describe('TODO describe ratingBucket field for the OpenInspection MCP integration'),
    section: z.string().nullable().describe('TODO describe section field for the OpenInspection MCP integration'),
    itemLabel: z.string().nullable().optional(),
    useCount: z.number().int().optional(),
    lastUsedAt: z.string().nullable().optional(),
    createdAt: z.string().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
}).openapi('CommentResponse');

export const ListCommentsQuerySchema = z.object({
    rating: RatingBucketSchema.optional().openapi({ example: 'defect' }).describe('TODO describe rating field for the OpenInspection MCP integration'),
    section: z.string().max(64).optional().openapi({ example: 'Roof' }).describe('TODO describe section field for the OpenInspection MCP integration'),
    sectionId: z.string().max(64).optional().openapi({ example: 'roof-general' }).describe('Filter by section ID (matches within the section_ids JSON array)'),
    triggerCode: z.string().max(64).optional().openapi({ example: 'NI' }).describe('Filter by trigger code'),
    search: z.string().max(200).optional().describe('TODO describe search field for the OpenInspection MCP integration'),
    // Comments Library Upgrade — new sort + filter mode + context filters.
    sort: z.enum(['relevance', 'recent', 'created', 'frequent', 'alpha']).optional().default('relevance'),
    filterMode: z.enum(['auto', 'all']).optional().default('all'),
    itemLabel: z.string().max(120).optional(),
    // List Pagination PR — replace the old single-`limit` knob with shared
    // pagination params. page is 1-indexed; pageSize ∈ {12,25,50,100}, default 50.
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int()
        .refine((n) => [12, 25, 50, 100].includes(n), { message: 'pageSize must be one of 12, 25, 50, 100' })
        .default(50),
}).openapi('ListCommentsQuery');

export const CommentTouchResponseSchema = z.object({
    success: z.literal(true),
    data:    z.object({
        commentId: z.string(),
        useCount:  z.number().int(),
    }),
}).openapi('CommentTouchResponse');

// handoff-decisions §1 — attention thresholds (in hours, 1..720 = 30 days max)
export const AttentionThresholdsSchema = z.object({
    agreement_unsigned_h: z.number().int().min(1).max(720).describe('TODO describe agreement_unsigned_h field for the OpenInspection MCP integration'),
    invoice_overdue_h:    z.number().int().min(1).max(720).describe('TODO describe invoice_overdue_h field for the OpenInspection MCP integration'),
    report_unpublished_h: z.number().int().min(1).max(720).describe('TODO describe report_unpublished_h field for the OpenInspection MCP integration'),
}).openapi('AttentionThresholds');

export const AttentionThresholdsResponseSchema = z.object({
    success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
    data: z.object({ thresholds: AttentionThresholdsSchema.describe('TODO describe thresholds field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
}).openapi('AttentionThresholdsResponse');

export const ATTENTION_THRESHOLDS_DEFAULTS = {
    agreement_unsigned_h: 72,
    invoice_overdue_h:    72,
    report_unpublished_h: 72,
} as const;

// Round-2 backlog #2 (Spectora §5.1 / §E.7) — per-tenant default for the
// inspection dashboard column visibility set. The actual id whitelist lives
// in server/lib/dashboard-columns.ts; we constrain length here so a malicious
// payload can't blow up the JSON envelope, but accept any string id and
// drop unknown ones server-side via `normalizeDashboardColumns`.
export const DashboardColumnPrefsSchema = z.object({
    columns: z.array(z.string().min(1).max(64)).max(64)
        .openapi({ example: ['propertyAddress', 'clientName', 'date', 'price'] }).describe('TODO describe columns field for the OpenInspection MCP integration'),
}).openapi('DashboardColumnPrefs');

export const DashboardColumnPrefsResponseSchema = z.object({
    success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
    data: z.object({ columns: z.array(z.string()).describe('TODO describe columns field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
}).openapi('DashboardColumnPrefsResponse');

// ── Trial Sample-Data Mode (2026-05-20 spec) ───────────────────────────────
// Portal calls POST /api/admin/seed-starter-content during step 2.5 of the
// OnboardingWorkflow to populate a newly-provisioned tenant with starter
// content. Idempotent — re-runs return all-zero counts.
export const SeedStarterContentBodySchema = z.object({
    tenantId: z.string().min(1).openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe tenantId field for the OpenInspection MCP integration'),
}).openapi('SeedStarterContentBody');

export const SeedStarterContentResponseSchema = createApiResponseSchema(z.object({
    inspectionTemplatesSeeded:  z.number().int().nonnegative().describe('TODO describe inspectionTemplatesSeeded field for the OpenInspection MCP integration'),
    agreementTemplatesSeeded:   z.number().int().nonnegative().describe('TODO describe agreementTemplatesSeeded field for the OpenInspection MCP integration'),
    cannedCommentsSeeded:       z.number().int().nonnegative().describe('TODO describe cannedCommentsSeeded field for the OpenInspection MCP integration'),
    eventTypesSeeded:           z.number().int().nonnegative().describe('TODO describe eventTypesSeeded field for the OpenInspection MCP integration'),
    tagsSeeded:                 z.number().int().nonnegative().describe('TODO describe tagsSeeded field for the OpenInspection MCP integration'),
    recommendationsSeeded:      z.number().int().nonnegative().describe('TODO describe recommendationsSeeded field for the OpenInspection MCP integration'),
    ratingSystemsSeeded:        z.number().int().nonnegative().describe('TODO describe ratingSystemsSeeded field for the OpenInspection MCP integration'),
    marketplaceLibrariesSeeded: z.number().int().nonnegative().describe('TODO describe marketplaceLibrariesSeeded field for the OpenInspection MCP integration'),
})).openapi('SeedStarterContentResponse');

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

