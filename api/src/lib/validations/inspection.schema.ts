import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

/**
 * Core Inspection Schema (Output)
 */
export const InspectionSchema = z.object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe id field for the OpenInspection MCP integration'),
    propertyAddress: z.string().openapi({ example: '123 Main St, Anytown' }).describe('TODO describe propertyAddress field for the OpenInspection MCP integration'),
    clientName: z.string().nullable().openapi({ example: 'John Doe' }).describe('TODO describe clientName field for the OpenInspection MCP integration'),
    clientEmail: z.string().email().nullable().openapi({ example: 'john@example.com' }).describe('TODO describe clientEmail field for the OpenInspection MCP integration'),
    status: z.enum(['draft', 'completed', 'delivered']).openapi({ example: 'draft' }).describe('TODO describe status field for the OpenInspection MCP integration'),
    date: z.string().openapi({ example: '2024-03-20' }).describe('TODO describe date field for the OpenInspection MCP integration'),
    inspectorId: z.string().uuid().nullable().openapi({ example: '550e8400-e29b-41d4-a716-446655440001' }).describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    templateId: z.string().uuid().nullable().openapi({ example: '550e8400-e29b-41d4-a716-446655440002' }).describe('TODO describe templateId field for the OpenInspection MCP integration'),
    createdAt: z.string().datetime().openapi({ example: '2024-03-20T10:00:00Z' }).describe('TODO describe createdAt field for the OpenInspection MCP integration'),
}).openapi('Inspection');

/**
 * Validation schema for list filtering and pagination.
 */
export const InspectionListQuerySchema = z.object({
    limit: z.coerce.number().min(1).max(100).default(20).openapi({ example: 20 }).describe('TODO describe limit field for the OpenInspection MCP integration'),
    cursor: z.string().optional().openapi({ example: 'eyJpZCI6IjU1MGU4NDAwLWUyOWItNDFkNC1hNzE2LTQ0NjY1NTQ0MDAwMCJ9' }).describe('TODO describe cursor field for the OpenInspection MCP integration'),
    status: z.enum(['draft', 'completed', 'delivered']).optional().openapi({ example: 'completed' }).describe('TODO describe status field for the OpenInspection MCP integration'),
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
    templateId: z.string().uuid('Invalid template ID').openapi({ example: '550e8400-e29b-41d4-a716-446655440002' }).describe('TODO describe templateId field for the OpenInspection MCP integration'),
    inspectorId: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440001' }).describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    date: z.string().datetime().optional().openapi({ example: '2024-03-20T10:00:00Z' }).describe('TODO describe date field for the OpenInspection MCP integration'),
    referredByAgentId: z.string().uuid().optional().nullable().openapi({ example: '550e8400-e29b-41d4-a716-446655440003' }).describe('TODO describe referredByAgentId field for the OpenInspection MCP integration'),
    // R7-09: Buyer's Agent — separate from listing agent. Maps to inspections.sellingAgentId column.
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
    serviceIds:     z.array(z.string()).optional().describe('TODO describe serviceIds field for the OpenInspection MCP integration'),
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
    clientName: z.string().min(1).optional().openapi({ example: 'John Doe' }).describe('TODO describe clientName field for the OpenInspection MCP integration'),
    clientEmail: z.string().email().optional().nullable().openapi({ example: 'john@example.com' }).describe('TODO describe clientEmail field for the OpenInspection MCP integration'),
    date: z.string().datetime().optional().openapi({ example: '2024-03-20T10:00:00Z' }).describe('TODO describe date field for the OpenInspection MCP integration'),
    inspectorId: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440001' }).describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    price: z.number().min(0).optional().openapi({ example: 450 }).describe('TODO describe price field for the OpenInspection MCP integration'),
    status: z.enum(['draft', 'completed', 'delivered']).optional().openapi({ example: 'completed' }).describe('TODO describe status field for the OpenInspection MCP integration'),
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
    orderId:        z.string().max(64).nullable().optional().openapi({ example: 'ORD-2026-0142' }).describe('TODO describe orderId field for the OpenInspection MCP integration'),
    // Round-2 backlog G3 — referral source label. Free-text so the seed
    // list ("Realtor", "Past Client", ...) plus tenant custom values both
    // round-trip without a separate enum.
    referralSource: z.string().max(100).nullable().optional().openapi({ example: 'Realtor' }).describe('TODO describe referralSource field for the OpenInspection MCP integration'),
    reportThemeOverride: z.enum(['modern', 'classic', 'minimal']).nullable().optional().openapi({ example: 'classic' }).describe('TODO describe reportThemeOverride field for the OpenInspection MCP integration'),
}).openapi('UpdateInspection');

/**
 * Round-2 backlog G1 (Spectora §E.2) — Property Facts strip payload.
 * Six structured fields. All optional so inspectors can fill them in over
 * time. `null` clears a field; omitted = leave existing value untouched.
 *
 * `yearBuilt`, `sqft`, `bedrooms`, `bathrooms` and `foundationType` map to
 * dedicated columns on `inspections`. `lotSize` maps to the new `lot_size`
 * column added in migration 0045.
 */
export const PropertyFactsSchema = z.object({
    yearBuilt:      z.number().int().min(1800).max(2100).nullable().optional().openapi({ example: 1990 }).describe('TODO describe yearBuilt field for the OpenInspection MCP integration'),
    sqft:           z.number().int().min(0).max(1_000_000).nullable().optional().openapi({ example: 1800 }).describe('TODO describe sqft field for the OpenInspection MCP integration'),
    foundationType: z.enum(['basement', 'slab', 'crawlspace', 'other']).nullable().optional().openapi({ example: 'basement' }).describe('TODO describe foundationType field for the OpenInspection MCP integration'),
    lotSize:        z.string().max(50).nullable().optional().openapi({ example: '0.25 acres' }).describe('TODO describe lotSize field for the OpenInspection MCP integration'),
    bedrooms:       z.number().int().min(0).max(50).nullable().optional().openapi({ example: 3 }).describe('TODO describe bedrooms field for the OpenInspection MCP integration'),
    bathrooms:      z.number().min(0).max(50).nullable().optional().openapi({ example: 2.5 }).describe('TODO describe bathrooms field for the OpenInspection MCP integration'),
}).openapi('PropertyFacts');

export const PropertyFactsResponseSchema = createApiResponseSchema(PropertyFactsSchema).openapi('PropertyFactsResponse');

/**
 * Sprint 3 S3-1 — POST /api/inspections/:id/property-facts/autofill
 * Body: free-text address. Server-side proxy hits Estated.io public-records
 * API and returns a normalised PropertyFacts payload (or `null` + reason
 * code when the provider can't supply data — graceful degrade pattern).
 */
export const PropertyFactsAutofillRequestSchema = z.object({
    addressString: z.string().min(5, 'Address is too short').max(200).describe('TODO describe addressString field for the OpenInspection MCP integration'),
}).openapi('PropertyFactsAutofillRequest');

export const PropertyFactsAutofillResponseSchema = z.object({
    success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
    data: z.object({
        facts:  PropertyFactsSchema.nullable().describe('TODO describe facts field for the OpenInspection MCP integration'),
        source: z.enum(['estated', 'manual_required']).describe('TODO describe source field for the OpenInspection MCP integration'),
        reason: z.enum(['NO_API_KEY', 'NOT_FOUND', 'PROVIDER_ERROR']).optional().describe('TODO describe reason field for the OpenInspection MCP integration'),
    }).describe('TODO describe data field for the OpenInspection MCP integration'),
}).openapi('PropertyFactsAutofillResponse');

export const CancellationReasonSchema = z.enum([
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

export const InspectionCountsSchema = z.object({
    all:         z.number().openapi({ example: 42 }).describe('TODO describe all field for the OpenInspection MCP integration'),
    today:       z.number().openapi({ example: 3 }).describe('TODO describe today field for the OpenInspection MCP integration'),
    upcoming:    z.number().openapi({ example: 12 }).describe('TODO describe upcoming field for the OpenInspection MCP integration'),
    past:        z.number().openapi({ example: 27 }).describe('TODO describe past field for the OpenInspection MCP integration'),
    unconfirmed: z.number().openapi({ example: 2 }).describe('TODO describe unconfirmed field for the OpenInspection MCP integration'),
    inProgress:  z.number().openapi({ example: 1 }).describe('TODO describe inProgress field for the OpenInspection MCP integration'),
}).openapi('InspectionCounts');
export type InspectionCounts = z.infer<typeof InspectionCountsSchema>;

/**
 * Stats Schema
 */
export const InspectionStatsSchema = z.object({
    total: z.number().openapi({ example: 100 }).describe('TODO describe total field for the OpenInspection MCP integration'),
    draft: z.number().openapi({ example: 20 }).describe('TODO describe draft field for the OpenInspection MCP integration'),
    completed: z.number().openapi({ example: 50 }).describe('TODO describe completed field for the OpenInspection MCP integration'),
    delivered: z.number().openapi({ example: 30 }).describe('TODO describe delivered field for the OpenInspection MCP integration'),
}).openapi('InspectionStats');

/**
 * Validation schema for inspection results patch.
 */
export const PatchResultsSchema = z.object({
    data: z.record(z.string(), z.unknown()).describe('TODO describe data field for the OpenInspection MCP integration'),
}).openapi('PatchResults');

/**
 * Validation schema for bulk operations.
 */
export const BulkInspectionSchema = z.object({
    ids: z.array(z.string().uuid()).min(1).max(100).describe('TODO describe ids field for the OpenInspection MCP integration'),
    action: z.enum(['assignInspector', 'updateStatus']).describe('TODO describe action field for the OpenInspection MCP integration'),
    inspectorId: z.string().uuid().optional().describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    status: z.enum(['draft', 'completed', 'delivered']).optional().describe('TODO describe status field for the OpenInspection MCP integration'),
}).openapi('BulkInspection');

/**
 * Response Schemas
 */
export const InspectionResponseSchema = createApiResponseSchema(InspectionSchema).openapi('InspectionResponse');
export const InspectionListResponseSchema = createApiResponseSchema(z.array(InspectionSchema)).openapi('InspectionListResponse');
export const InspectionStatsResponseSchema = createApiResponseSchema(InspectionStatsSchema).openapi('InspectionStatsResponse');

// --- Report Data ---

// Round-2 F1 — per-recipient delivery selection. Each recipient row chooses
// zero-or-more channels. Empty `channels` means "skip this recipient".
export const PublishRecipientSchema = z.object({
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

// Round-2 F1 — recipient list returned by GET /api/inspections/:id/recipients.
export const InspectionRecipientSchema = z.object({
  contactId: z.string().nullable().describe('TODO describe contactId field for the OpenInspection MCP integration'),
  name:      z.string().describe('TODO describe name field for the OpenInspection MCP integration'),
  role:      z.enum(['client', 'agent_buyer', 'agent_listing']).describe('TODO describe role field for the OpenInspection MCP integration'),
  email:     z.string().nullable().describe('TODO describe email field for the OpenInspection MCP integration'),
  phone:     z.string().nullable().describe('TODO describe phone field for the OpenInspection MCP integration'),
}).openapi('InspectionRecipient');

export const InspectionRecipientsResponseSchema = createApiResponseSchema(
  z.array(InspectionRecipientSchema)
).openapi('InspectionRecipientsResponse');

// Round-2 F3 — People card payload (Spectora §E.2).
const PeopleAgentSchema = z.object({
  id:     z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
  name:   z.string().describe('TODO describe name field for the OpenInspection MCP integration'),
  email:  z.string().nullable().describe('TODO describe email field for the OpenInspection MCP integration'),
  phone:  z.string().nullable().describe('TODO describe phone field for the OpenInspection MCP integration'),
  agency: z.string().nullable().describe('TODO describe agency field for the OpenInspection MCP integration'),
});

export const InspectionPeopleSchema = z.object({
  inspector: z.object({
    id:    z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    name:  z.string().nullable().describe('TODO describe name field for the OpenInspection MCP integration'),
    email: z.string().describe('TODO describe email field for the OpenInspection MCP integration'),
    phone: z.string().nullable().describe('TODO describe phone field for the OpenInspection MCP integration'),
  }).nullable().describe('TODO describe inspector field for the OpenInspection MCP integration'),
  client: z.object({
    name:  z.string().describe('TODO describe name field for the OpenInspection MCP integration'),
    email: z.string().nullable().describe('TODO describe email field for the OpenInspection MCP integration'),
    phone: z.string().nullable().describe('TODO describe phone field for the OpenInspection MCP integration'),
  }).nullable().describe('TODO describe client field for the OpenInspection MCP integration'),
  buyerAgents:   z.array(PeopleAgentSchema).describe('TODO describe buyerAgents field for the OpenInspection MCP integration'),
  listingAgents: z.array(PeopleAgentSchema).describe('TODO describe listingAgents field for the OpenInspection MCP integration'),
}).openapi('InspectionPeople');

export const InspectionPeopleResponseSchema = createApiResponseSchema(InspectionPeopleSchema).openapi('InspectionPeopleResponse');

export const ReportItemSchema = z.object({
  id: z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
  label: z.string().describe('TODO describe label field for the OpenInspection MCP integration'),
  rating: z.string().nullable().describe('TODO describe rating field for the OpenInspection MCP integration'),
  ratingColor: z.string().describe('TODO describe ratingColor field for the OpenInspection MCP integration'),
  ratingLabel: z.string().nullable().describe('TODO describe ratingLabel field for the OpenInspection MCP integration'),
  severityBucket: z.enum(['satisfactory', 'monitor', 'defect', 'other']).describe('TODO describe severityBucket field for the OpenInspection MCP integration'),
  notes: z.string().nullable().describe('TODO describe notes field for the OpenInspection MCP integration'),
  photos: z.array(z.object({ key: z.string().describe('TODO describe key field for the OpenInspection MCP integration'), url: z.string().describe('TODO describe url field for the OpenInspection MCP integration') })).describe('TODO describe photos field for the OpenInspection MCP integration'),
  recommendation: z.string().nullable().optional().describe('TODO describe recommendation field for the OpenInspection MCP integration'),
  estimateMin: z.number().nullable().optional().describe('TODO describe estimateMin field for the OpenInspection MCP integration'),
  estimateMax: z.number().nullable().optional().describe('TODO describe estimateMax field for the OpenInspection MCP integration'),
}).openapi('ReportItem');

export const ReportSectionSchema = z.object({
  id: z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
  title: z.string().describe('TODO describe title field for the OpenInspection MCP integration'),
  icon: z.string().nullable().optional().describe('TODO describe icon field for the OpenInspection MCP integration'),
  defectCount: z.number().describe('TODO describe defectCount field for the OpenInspection MCP integration'),
  items: z.array(ReportItemSchema).describe('TODO describe items field for the OpenInspection MCP integration'),
}).openapi('ReportSection');

export const ReportDataResponseSchema = z.object({
  inspection: z.object({
    id: z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    propertyAddress: z.string().describe('TODO describe propertyAddress field for the OpenInspection MCP integration'),
    date: z.string().describe('TODO describe date field for the OpenInspection MCP integration'),
    status: z.string().describe('TODO describe status field for the OpenInspection MCP integration'),
    inspectorName: z.string().nullable().describe('TODO describe inspectorName field for the OpenInspection MCP integration'),
  }).describe('TODO describe inspection field for the OpenInspection MCP integration'),
  theme: z.enum(['modern', 'classic', 'minimal']).describe('TODO describe theme field for the OpenInspection MCP integration'),
  stats: z.object({
    total: z.number().describe('TODO describe total field for the OpenInspection MCP integration'),
    satisfactory: z.number().describe('TODO describe satisfactory field for the OpenInspection MCP integration'),
    monitor: z.number().describe('TODO describe monitor field for the OpenInspection MCP integration'),
    defect: z.number().describe('TODO describe defect field for the OpenInspection MCP integration'),
  }).describe('TODO describe stats field for the OpenInspection MCP integration'),
  sections: z.array(ReportSectionSchema).describe('TODO describe sections field for the OpenInspection MCP integration'),
  ratingLevels: z.array(z.object({
    id: z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    label: z.string().describe('TODO describe label field for the OpenInspection MCP integration'),
    abbreviation: z.string().describe('TODO describe abbreviation field for the OpenInspection MCP integration'),
    color: z.string().describe('TODO describe color field for the OpenInspection MCP integration'),
    severity: z.string().describe('TODO describe severity field for the OpenInspection MCP integration'),
    isDefect: z.boolean().describe('TODO describe isDefect field for the OpenInspection MCP integration'),
  })).describe('TODO describe ratingLevels field for the OpenInspection MCP integration'),
}).openapi('ReportData');

export const InspectionListItemSchema = z.object({
    id:           z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    date:         z.string().nullable().describe('TODO describe date field for the OpenInspection MCP integration'),
    address:      z.string().nullable().optional().describe('TODO describe address field for the OpenInspection MCP integration'),
    clientName:   z.string().nullable().optional().describe('TODO describe clientName field for the OpenInspection MCP integration'),
    status:       z.string().describe('TODO describe status field for the OpenInspection MCP integration'),
    confirmedAt:  z.string().nullable().optional().describe('TODO describe confirmedAt field for the OpenInspection MCP integration'),
    cancelReason: z.string().nullable().optional().describe('TODO describe cancelReason field for the OpenInspection MCP integration'),
    cancelNotes:  z.string().nullable().optional().describe('TODO describe cancelNotes field for the OpenInspection MCP integration'),
    createdAt:    z.string().nullable().optional().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
}).passthrough().openapi('InspectionListItem');

// Sub-spec B Task 5 (B-4) — portfolio defectStats aggregated per top card.
const DefectAggregateBucketSchema = z.object({
    safety:         z.number().describe('TODO describe safety field for the OpenInspection MCP integration'),
    recommendation: z.number().describe('TODO describe recommendation field for the OpenInspection MCP integration'),
    maintenance:    z.number().describe('TODO describe maintenance field for the OpenInspection MCP integration'),
});

export const DashboardResponseSchema = z.object({
    needsAttention: z.array(InspectionListItemSchema).describe('TODO describe needsAttention field for the OpenInspection MCP integration'),
    today:          z.array(InspectionListItemSchema).describe('TODO describe today field for the OpenInspection MCP integration'),
    thisWeek:       z.array(InspectionListItemSchema).describe('TODO describe thisWeek field for the OpenInspection MCP integration'),
    later:          z.array(InspectionListItemSchema).describe('TODO describe later field for the OpenInspection MCP integration'),
    laterTotal:     z.number().describe('TODO describe laterTotal field for the OpenInspection MCP integration'),
    recentReports:  z.array(InspectionListItemSchema).describe('TODO describe recentReports field for the OpenInspection MCP integration'),
    cancelled:      z.array(InspectionListItemSchema).describe('TODO describe cancelled field for the OpenInspection MCP integration'),
    defectAggregate: z.object({
        later:          DefectAggregateBucketSchema.describe('TODO describe later field for the OpenInspection MCP integration'),
        thisWeek:       DefectAggregateBucketSchema.describe('TODO describe thisWeek field for the OpenInspection MCP integration'),
        needsAttention: DefectAggregateBucketSchema.describe('TODO describe needsAttention field for the OpenInspection MCP integration'),
        recentReports:  DefectAggregateBucketSchema.describe('TODO describe recentReports field for the OpenInspection MCP integration'),
    }).optional().describe('TODO describe defectAggregate field for the OpenInspection MCP integration'),
    // Agent Accounts A3 — concierge pending count for the UPCOMING substate.
    // Counts inspections where concierge_status = 'awaiting_inspector'. Optional
    // so older clients/cached responses still validate.
    conciergePending: z.number().optional().describe('TODO describe conciergePending field for the OpenInspection MCP integration'),
}).openapi('DashboardResponse');

/**
 * Round-2 backlog #9 (Spectora §E.3) — Media Center.
 *
 * Two-list payload: photos already attached to an item plus the loose pool
 * of bulk-uploaded shots awaiting placement. The drawer renders both groups
 * with the same card UI, but only attached photos carry an itemId/section.
 */
export const MediaCenterAttachedPhotoSchema = z.object({
    key:           z.string().describe('TODO describe key field for the OpenInspection MCP integration'),
    url:           z.string().describe('TODO describe url field for the OpenInspection MCP integration'),
    itemId:        z.string().describe('TODO describe itemId field for the OpenInspection MCP integration'),
    itemLabel:     z.string().describe('TODO describe itemLabel field for the OpenInspection MCP integration'),
    sectionId:     z.string().describe('TODO describe sectionId field for the OpenInspection MCP integration'),
    sectionTitle:  z.string().describe('TODO describe sectionTitle field for the OpenInspection MCP integration'),
    photoIndex:    z.number().int().nonnegative().describe('TODO describe photoIndex field for the OpenInspection MCP integration'),
    annotated:     z.boolean().describe('TODO describe annotated field for the OpenInspection MCP integration'),
}).openapi('MediaCenterAttachedPhoto');

export const MediaCenterPoolPhotoSchema = z.object({
    id:            z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    key:           z.string().describe('TODO describe key field for the OpenInspection MCP integration'),
    url:           z.string().describe('TODO describe url field for the OpenInspection MCP integration'),
    uploadedAt:    z.number().int().describe('TODO describe uploadedAt field for the OpenInspection MCP integration'),
    takenAt:       z.number().int().nullable().describe('TODO describe takenAt field for the OpenInspection MCP integration'),
}).openapi('MediaCenterPoolPhoto');

export const MediaCenterResponseSchema = z.object({
    attached:  z.array(MediaCenterAttachedPhotoSchema).describe('TODO describe attached field for the OpenInspection MCP integration'),
    pool:      z.array(MediaCenterPoolPhotoSchema).describe('TODO describe pool field for the OpenInspection MCP integration'),
}).openapi('MediaCenterResponse');

export const MediaPoolUploadResponseSchema = z.object({
    id:          z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    key:         z.string().describe('TODO describe key field for the OpenInspection MCP integration'),
    url:         z.string().describe('TODO describe url field for the OpenInspection MCP integration'),
    uploadedAt:  z.number().int().describe('TODO describe uploadedAt field for the OpenInspection MCP integration'),
    takenAt:     z.number().int().nullable().describe('TODO describe takenAt field for the OpenInspection MCP integration'),
}).openapi('MediaPoolUploadResponse');

export const MediaAttachRequestSchema = z.object({
    poolId: z.string().min(1).describe('TODO describe poolId field for the OpenInspection MCP integration'),
    itemId: z.string().min(1).describe('TODO describe itemId field for the OpenInspection MCP integration'),
    sectionId: z.string().min(1).optional().describe('Section ID for composite finding key'),
}).openapi('MediaAttachRequest');

export const MediaAttachResponseSchema = z.object({
    key:        z.string().describe('TODO describe key field for the OpenInspection MCP integration'),
    itemId:     z.string().describe('TODO describe itemId field for the OpenInspection MCP integration'),
    photoIndex: z.number().int().nonnegative().describe('TODO describe photoIndex field for the OpenInspection MCP integration'),
}).openapi('MediaAttachResponse');
