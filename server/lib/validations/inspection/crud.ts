import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from '../shared.schema';
import { INSPECTION_STATUSES } from '../../status/inspection-status';

/**
 * Core Inspection Schema (Output)
 */
export const InspectionSchema = z.object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe id field for the OpenInspection MCP integration'),
    propertyAddress: z.string().openapi({ example: '123 Main St, Anytown' }).describe('TODO describe propertyAddress field for the OpenInspection MCP integration'),
    clientName: z.string().nullable().openapi({ example: 'John Doe' }).describe('TODO describe clientName field for the OpenInspection MCP integration'),
    clientEmail: z.string().email().nullable().openapi({ example: 'john@example.com' }).describe('TODO describe clientEmail field for the OpenInspection MCP integration'),
    status: z.enum(INSPECTION_STATUSES).openapi({ example: 'requested' }).describe('TODO describe status field for the OpenInspection MCP integration'),
    date: z.string().openapi({ example: '2024-03-20' }).describe('TODO describe date field for the OpenInspection MCP integration'),
    inspectorId: z.string().uuid().nullable().openapi({ example: '550e8400-e29b-41d4-a716-446655440001' }).describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    templateId: z.string().min(1).nullable().openapi({ example: '550e8400-e29b-41d4-a716-446655440002' }).describe('TODO describe templateId field for the OpenInspection MCP integration'),
    createdAt: z.string().datetime().openapi({ example: '2024-03-20T10:00:00Z' }).describe('TODO describe createdAt field for the OpenInspection MCP integration'),
}).openapi('Inspection');

/**
 * Validation schema for list filtering and pagination.
 */
export const InspectionListQuerySchema = z.object({
    limit: z.coerce.number().min(1).max(100).default(20).openapi({ example: 20 }).describe('TODO describe limit field for the OpenInspection MCP integration'),
    cursor: z.string().optional().openapi({ example: 'eyJpZCI6IjU1MGU4NDAwLWUyOWItNDFkNC1hNzE2LTQ0NjY1NTQ0MDAwMCJ9' }).describe('TODO describe cursor field for the OpenInspection MCP integration'),
    status: z.enum(INSPECTION_STATUSES).optional().openapi({ example: 'completed' }).describe('TODO describe status field for the OpenInspection MCP integration'),
    search: z.string().optional().openapi({ example: '123 Main' }).describe('TODO describe search field for the OpenInspection MCP integration'),
    inspectorId: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440001' }).describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional().openapi({ example: '2024-01-01' }).describe('TODO describe dateFrom field for the OpenInspection MCP integration'),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional().openapi({ example: '2024-12-31' }).describe('TODO describe dateTo field for the OpenInspection MCP integration'),
    tab: z.enum(['all', 'today', 'upcoming', 'past', 'unconfirmed', 'in_progress']).optional().openapi({ example: 'today' }).describe('TODO describe tab field for the OpenInspection MCP integration'),
}).openapi('InspectionListQuery');

/**
 * Validation schema for creating a new inspection.
 */
export const CreateInspectionSchema = z.object({
    propertyAddress: z.string().min(5, 'Property address is too short').openapi({ example: '123 Main St, Anytown' }).describe('TODO describe propertyAddress field for the OpenInspection MCP integration'),
    clientName: z.string().min(1, 'Client name is required').default('Private Client').openapi({ example: 'John Doe' }).describe('TODO describe clientName field for the OpenInspection MCP integration'),
    // iter-1 production bug #1 — the dashboard's New Inspection modal posts
    // `clientEmail: ""` when the inspector skips the field. The previous
    // chain `.email().optional().nullable()` rejected the empty string with
    // a raw Zod regex pattern. Accept "" as a sentinel for "missing" and
    // normalise it to null so the service layer sees one canonical shape.
    clientEmail: z.union([z.string().email('Invalid email address'), z.literal(''), z.null()])
        .optional()
        .transform((v) => (v === '' || v === undefined ? null : v))
        .openapi({ example: 'john@example.com' }).describe('TODO describe clientEmail field for the OpenInspection MCP integration'),
    clientPhone: z.string().max(30).optional().nullable().openapi({ example: '(555) 123-4567' }).describe('TODO describe clientPhone field for the OpenInspection MCP integration'),
    templateId: z.string().min(1, 'Template is required').openapi({ example: '550e8400-e29b-41d4-a716-446655440002' }).describe('TODO describe templateId field for the OpenInspection MCP integration'),
    inspectorId: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440001' }).describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    date: z.string().datetime().optional().openapi({ example: '2024-03-20T10:00:00Z' }).describe('TODO describe date field for the OpenInspection MCP integration'),
    referredByAgentId: z.string().uuid().optional().nullable().openapi({ example: '550e8400-e29b-41d4-a716-446655440003' }).describe('TODO describe referredByAgentId field for the OpenInspection MCP integration'),
    // R7-09: Buyer's Agent — separate from listing agent. Input-only DTO field;
    // mirrored into inspection_people (listing_agent role), not an inspections column (dropped, Task 13).
    sellingAgentId: z.string().uuid().optional().nullable().openapi({ example: '550e8400-e29b-41d4-a716-446655440004' }).describe('TODO describe sellingAgentId field for the OpenInspection MCP integration'),
    // Spec 5D — geocoded address fields (set when client picked from Places autocomplete).
    addressPlaceId: z.string().min(1).max(200).optional().nullable().describe('TODO describe addressPlaceId field for the OpenInspection MCP integration'),
    addressStreet:  z.string().max(200).optional().nullable().describe('TODO describe addressStreet field for the OpenInspection MCP integration'),
    addressCity:    z.string().max(100).optional().nullable().describe('TODO describe addressCity field for the OpenInspection MCP integration'),
    addressState:   z.string().max(10).optional().nullable().describe('TODO describe addressState field for the OpenInspection MCP integration'),
    addressZip:     z.string().max(20).optional().nullable().describe('TODO describe addressZip field for the OpenInspection MCP integration'),
    addressCounty:  z.string().max(100).optional().nullable().describe('TODO describe addressCounty field for the OpenInspection MCP integration'),
    addressLat:     z.number().min(-90).max(90).optional().nullable().describe('TODO describe addressLat field for the OpenInspection MCP integration'),
    addressLng:     z.number().min(-180).max(180).optional().nullable().describe('TODO describe addressLng field for the OpenInspection MCP integration'),
    serviceIds:     z.array(z.string()).optional().describe('Legacy flat service-id list. Kept for backward compat. When serviceSelections is also present, serviceSelections takes precedence for per-row price overrides; any serviceId listed here but absent from serviceSelections is linked without a priceOverride.'),
    // IA-1 People step: richer service selection with optional per-line price overrides.
    // Relationship to serviceIds: serviceSelections is the superset. Old callers that
    // only post serviceIds keep working unchanged. New wizard posts serviceSelections
    // which may carry priceOverrideCents per row. A serviceId present in serviceIds
    // but absent from serviceSelections is linked with priceOverride=null.
    serviceSelections: z.array(z.object({
        serviceId:          z.string().describe('Service catalog id to link to the inspection.'),
        priceOverrideCents: z.number().int().min(0).optional().describe('Per-line price override in cents. Omit to use the catalog price.'),
    })).optional().describe('IA-1: Richer service list that carries optional per-row price overrides. Superset of serviceIds.'),
    // IA-1 People step: client capture.
    client: z.object({
        name:  z.string().min(1).describe('Client full name.'),
        email: z.string().email().optional().describe('Client email — used to deduplicate against the contacts table.'),
        phone: z.string().optional().describe('Client phone number.'),
    }).optional().describe('IA-1: When present, upserts a contact row and links it as client_contact_id.'),
    // IA-1 People step: agent capture — exactly one of agentContactId or newAgent may be set.
    agentContactId: z.string().optional().describe('IA-1: Existing contacts.id to link as referred_by_agent_id.'),
    newAgent: z.object({
        name:  z.string().min(1).describe('Agent full name.'),
        email: z.string().email().optional().describe('Agent email — used to deduplicate against the contacts table.'),
    }).optional().describe('IA-1: When present, upserts a contact row of type=agent and links it as referred_by_agent_id.'),
    discountCodeId: z.string().nullable().optional().describe('TODO describe discountCodeId field for the OpenInspection MCP integration'),
    discountAmount: z.number().int().nullable().optional().describe('TODO describe discountAmount field for the OpenInspection MCP integration'),
    price:          z.number().int().min(0).optional().describe('TODO describe price field for the OpenInspection MCP integration'),
    // Round-2 backlog #10 — explicit override of tenant gating policy.
    // When omitted, createInspection inherits from tenant_configs.block_unpaid
    // / block_unsigned_agreement. When provided, this caller-level value wins.
    paymentRequired:   z.boolean().optional().openapi({ example: false }).describe('TODO describe paymentRequired field for the OpenInspection MCP integration'),
    agreementRequired: z.boolean().optional().openapi({ example: false }).describe('TODO describe agreementRequired field for the OpenInspection MCP integration'),
}).openapi('CreateInspection');

/**
 * Validation schema for patching inspection metadata.
 */
export const UpdateInspectionSchema = z.object({
    propertyAddress: z.string().min(5).optional().openapi({ example: '123 Main St, Anytown' }).describe('TODO describe propertyAddress field for the OpenInspection MCP integration'),
    // Task 13 — clientName/clientEmail removed. They mapped 1:1 to the now-dropped
    // inspections.client_name/client_email columns and the app never sends them
    // through this PATCH (client identity is managed via inspection_people /
    // the People card, not this metadata route). Zod strips unknown keys, so
    // any legacy caller still posting these two fields degrades to a no-op on
    // them (same "unrecognised field" no-op as templateId used to before B-22).
    date: z.string().datetime().optional().openapi({ example: '2024-03-20T10:00:00Z' }).describe('TODO describe date field for the OpenInspection MCP integration'),
    inspectorId: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440001' }).describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    price: z.number().int().min(0).optional().openapi({ example: 450 }).describe('TODO describe price field for the OpenInspection MCP integration'),
    status: z.enum(INSPECTION_STATUSES).optional().openapi({ example: 'completed' }).describe('TODO describe status field for the OpenInspection MCP integration'),
    paymentRequired:   z.boolean().optional().openapi({ example: false }).describe('TODO describe paymentRequired field for the OpenInspection MCP integration'),
    agreementRequired: z.boolean().optional().openapi({ example: false }).describe('TODO describe agreementRequired field for the OpenInspection MCP integration'),
    yearBuilt:      z.number().int().min(1800).max(2100).nullable().optional().openapi({ example: 1990 }).describe('TODO describe yearBuilt field for the OpenInspection MCP integration'),
    sqft:           z.number().int().min(0).nullable().optional().openapi({ example: 1800 }).describe('TODO describe sqft field for the OpenInspection MCP integration'),
    foundationType: z.enum(['basement', 'slab', 'crawlspace', 'other']).nullable().optional().describe('TODO describe foundationType field for the OpenInspection MCP integration'),
    bedrooms:       z.number().int().min(0).nullable().optional().openapi({ example: 3 }).describe('TODO describe bedrooms field for the OpenInspection MCP integration'),
    bathrooms:      z.number().min(0).max(20).nullable().optional().openapi({ example: 2.5 }).describe('TODO describe bathrooms field for the OpenInspection MCP integration'),
    // Round-2 backlog G1 — free-text lot size ("0.25 acres", "10,000 sqft").
    lotSize:        z.string().max(50).nullable().optional().openapi({ example: '0.25 acres' }).describe('TODO describe lotSize field for the OpenInspection MCP integration'),
    unit:           z.string().max(50).nullable().optional().describe('TODO describe unit field for the OpenInspection MCP integration'),
    county:         z.string().max(100).nullable().optional().describe('TODO describe county field for the OpenInspection MCP integration'),
    // Round-2 backlog G2 (Spectora §7.10) — when does the buyer close on
    // the property. Used for follow-up CRM signals. ISO YYYY-MM-DD.
    closingDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date (YYYY-MM-DD)').nullable().optional().openapi({ example: '2026-07-15' }).describe('TODO describe closingDate field for the OpenInspection MCP integration'),
    // Round-2 backlog G3 (Spectora §4.1) — free-text Order ID for ISN-style
    // integrations. Surfaced in PMS exports.
    referenceNumber:        z.string().max(64).nullable().optional().openapi({ example: 'REF-2026-0142' }).describe('TODO describe referenceNumber field for the OpenInspection MCP integration'),
    // Round-2 backlog G3 — referral source label. Free-text so the seed
    // list ("Realtor", "Past Client", ...) plus tenant custom values both
    // round-trip without a separate enum.
    referralSource: z.string().max(100).nullable().optional().openapi({ example: 'Realtor' }).describe('TODO describe referralSource field for the OpenInspection MCP integration'),
    profileOverride: z.string().nullable().optional().openapi({ example: 'meridian' }).describe('Per-inspection appearance profile override (built-in profile id); NULL inherits'),
    badgeLayoutOverride: z.enum(['strip', 'inline']).nullable().optional().openapi({ example: 'inline' }).describe('Per-inspection credential badge layout override; NULL inherits the profile'),
    reportPhotoColumns: z.number().int().min(1).max(4).nullable().optional().openapi({ example: 2 }).describe('Per-inspection report photo grid columns (1-4); NULL inherits the profile'),
    // DB-16 — report cover photo. References an inspection_media_pool row id
    // belonging to THIS inspection (validated in the PATCH handler via
    // isInspectionPhotoKey); null clears the cover. The value is an R2 photo
    // key (attached item photo or pool photo), not a UUID.
    coverPhotoId: z.string().min(1).nullable().optional().openapi({ example: 'tenant/insp/itemId_uuid.jpg' }).describe('Report cover photo — the R2 key of a photo belonging to this inspection (attached item photo or pool photo); null clears it.'),
    // Track H (IA-7) — per-inspection override of the tenant's
    // require_defect_fields publish-gate policy; null = inherit.
    requireDefectFieldsOverride: z.enum(['none', 'location', 'trade', 'both']).nullable().optional().describe('Per-inspection override of which defect fields the publish gate requires; null inherits the tenant default.'),
    // Per-inspection override of the tenant's auto-sign-on-publish default
    // (maps to inspections.auto_sign_on_publish). Toggled from the editor's
    // "toggle-auto-sign" action via PATCH /{id}.
    autoSignOnPublish: z.boolean().optional().openapi({ example: true }).describe('Whether the inspector signature is auto-applied when the report is published.'),
    // The settings sheet's "Template" selector reassigns the inspection's
    // template (inspections.template_id). The column is a free-text id
    // (templates.id is `text`, not a UUID — seed/imported ids like
    // 'tpl-e2e-trackA' are valid), so this is a plain string, not `.uuid()`.
    // null detaches the template; omitted leaves it unchanged.
    templateId: z.string().min(1).nullable().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440002' }).describe('Template assigned to this inspection (free-text template id).'),
}).openapi('UpdateInspection');

export const InspectionCountsSchema = z.object({
    all:         z.number().openapi({ example: 42 }).describe('TODO describe all field for the OpenInspection MCP integration'),
    today:       z.number().openapi({ example: 3 }).describe('TODO describe today field for the OpenInspection MCP integration'),
    upcoming:    z.number().openapi({ example: 12 }).describe('TODO describe upcoming field for the OpenInspection MCP integration'),
    past:        z.number().openapi({ example: 27 }).describe('TODO describe past field for the OpenInspection MCP integration'),
    unconfirmed: z.number().openapi({ example: 2 }).describe('TODO describe unconfirmed field for the OpenInspection MCP integration'),
    inProgress:  z.number().openapi({ example: 1 }).describe('TODO describe inProgress field for the OpenInspection MCP integration'),
}).openapi('InspectionCounts');

/**
 * Validation schema for bulk operations.
 */
export const BulkInspectionSchema = z.object({
    ids: z.array(z.string().uuid()).min(1).max(100).describe('TODO describe ids field for the OpenInspection MCP integration'),
    action: z.enum(['assignInspector', 'updateStatus']).describe('TODO describe action field for the OpenInspection MCP integration'),
    inspectorId: z.string().uuid().optional().describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    status: z.enum(INSPECTION_STATUSES).optional().describe('TODO describe status field for the OpenInspection MCP integration'),
}).openapi('BulkInspection');

/**
 * Response Schemas
 */
export const InspectionListResponseSchema = createApiResponseSchema(z.array(InspectionSchema)).openapi('InspectionListResponse');

const CancellationReasonSchema = z.enum([
    'client_cancelled',
    'weather',
    'inspector_unavailable',
    'property_unavailable',
    'rescheduled',
    'other',
]).openapi('CancellationReason');

export const CancelInspectionSchema = z.object({
    reason: CancellationReasonSchema.describe('TODO describe reason field for the OpenInspection MCP integration'),
    notes:  z.string().max(500).optional().describe('TODO describe notes field for the OpenInspection MCP integration'),
}).openapi('CancelInspectionRequest');

// Round-2 F1 — per-recipient delivery selection. Each recipient row chooses
// zero-or-more channels. Empty `channels` means "skip this recipient".
const PublishRecipientSchema = z.object({
  contactId: z.string().nullable().describe('TODO describe contactId field for the OpenInspection MCP integration'),
  channels:  z.array(z.enum(['email', 'text'])).default([]).describe('TODO describe channels field for the OpenInspection MCP integration'),
}).openapi('PublishRecipient');

export const PublishInspectionSchema = z.object({
  theme: z.enum(['modern', 'classic', 'minimal']).default('modern').describe('TODO describe theme field for the OpenInspection MCP integration'),
  notifyClient: z.boolean().default(true).describe('TODO describe notifyClient field for the OpenInspection MCP integration'),
  notifyAgent: z.boolean().default(true).describe('TODO describe notifyAgent field for the OpenInspection MCP integration'),
  requireSignature: z.boolean().default(false).describe('TODO describe requireSignature field for the OpenInspection MCP integration'),
  requirePayment: z.boolean().default(false).describe('TODO describe requirePayment field for the OpenInspection MCP integration'),
  // Round-2 F1 — multi-recipient publish modal payload. Optional because
  // legacy clients still post the flat shape above. When present, the
  // server uses this list to drive per-recipient delivery (email + text)
  // instead of the broad notifyClient/notifyAgent flags.
  recipients: z.array(PublishRecipientSchema).optional().describe('TODO describe recipients field for the OpenInspection MCP integration'),
  // Whether the modal sent a copy of the agreement alongside the report.
  // Stored only for audit/notification fan-out — does not change how the
  // report itself is built.
  sendAgreementCopy: z.boolean().default(false).describe('TODO describe sendAgreementCopy field for the OpenInspection MCP integration'),
  // Design System 0520 subsystem D phase 9 — Republish summary.
  // Free-text "what changed" note attached to the new report_versions row
  // created by ReportVersionService.snapshotOnPublish during this publish.
  // Optional; max 500 chars. NULL on first publish.
  summary: z.string().max(500).optional().describe('TODO describe summary field for the OpenInspection MCP integration'),
}).openapi('PublishInspection');

/**
 * Issue #119 (Re-inspections) Task 4 — body for
 * POST /api/inspections/:id/reinspect. The inspector picks which still-open
 * flagged items carry forward into a new linked inspection off a published
 * baseline report.
 */
export const CreateReinspectionSchema = z.object({
  selectedItemIds: z.array(z.string().min(1)).min(1).describe('Item ids carried forward into the re-inspection (the still-open flagged items the inspector chose).'),
  inspectorId: z.string().optional().describe('Inspector assigned to the re-inspection; defaults to the baseline inspector.'),
}).openapi('CreateReinspection');
