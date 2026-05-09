import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

/**
 * Core Inspection Schema (Output)
 */
export const InspectionSchema = z.object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    propertyAddress: z.string().openapi({ example: '123 Main St, Anytown' }),
    clientName: z.string().nullable().openapi({ example: 'John Doe' }),
    clientEmail: z.string().email().nullable().openapi({ example: 'john@example.com' }),
    status: z.enum(['draft', 'completed', 'delivered']).openapi({ example: 'draft' }),
    date: z.string().openapi({ example: '2024-03-20' }),
    inspectorId: z.string().uuid().nullable().openapi({ example: '550e8400-e29b-41d4-a716-446655440001' }),
    templateId: z.string().uuid().nullable().openapi({ example: '550e8400-e29b-41d4-a716-446655440002' }),
    createdAt: z.string().datetime().openapi({ example: '2024-03-20T10:00:00Z' }),
}).openapi('Inspection');

/**
 * Validation schema for list filtering and pagination.
 */
export const InspectionListQuerySchema = z.object({
    limit: z.coerce.number().min(1).max(100).default(20).openapi({ example: 20 }),
    cursor: z.string().optional().openapi({ example: 'eyJpZCI6IjU1MGU4NDAwLWUyOWItNDFkNC1hNzE2LTQ0NjY1NTQ0MDAwMCJ9' }),
    status: z.enum(['draft', 'completed', 'delivered']).optional().openapi({ example: 'completed' }),
    search: z.string().optional().openapi({ example: '123 Main' }),
    inspectorId: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440001' }),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional().openapi({ example: '2024-01-01' }),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional().openapi({ example: '2024-12-31' }),
    tab: z.enum(['all', 'today', 'upcoming', 'past', 'unconfirmed', 'in_progress']).optional().openapi({ example: 'today' }),
}).openapi('InspectionListQuery');

/**
 * Validation schema for creating a new inspection.
 */
export const CreateInspectionSchema = z.object({
    propertyAddress: z.string().min(5, 'Property address is too short').openapi({ example: '123 Main St, Anytown' }),
    clientName: z.string().min(1, 'Client name is required').default('Private Client').openapi({ example: 'John Doe' }),
    clientEmail: z.string().email('Invalid email address').optional().nullable().openapi({ example: 'john@example.com' }),
    clientPhone: z.string().max(30).optional().nullable().openapi({ example: '(555) 123-4567' }),
    templateId: z.string().uuid('Invalid template ID').openapi({ example: '550e8400-e29b-41d4-a716-446655440002' }),
    inspectorId: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440001' }),
    date: z.string().datetime().optional().openapi({ example: '2024-03-20T10:00:00Z' }),
    referredByAgentId: z.string().uuid().optional().nullable().openapi({ example: '550e8400-e29b-41d4-a716-446655440003' }),
    // R7-09: Buyer's Agent — separate from listing agent. Maps to inspections.sellingAgentId column.
    sellingAgentId: z.string().uuid().optional().nullable().openapi({ example: '550e8400-e29b-41d4-a716-446655440004' }),
    // Spec 5D — geocoded address fields (set when client picked from Places autocomplete).
    addressPlaceId: z.string().min(1).max(200).optional().nullable(),
    addressStreet:  z.string().max(200).optional().nullable(),
    addressCity:    z.string().max(100).optional().nullable(),
    addressState:   z.string().max(10).optional().nullable(),
    addressZip:     z.string().max(20).optional().nullable(),
    addressCounty:  z.string().max(100).optional().nullable(),
    addressLat:     z.number().min(-90).max(90).optional().nullable(),
    addressLng:     z.number().min(-180).max(180).optional().nullable(),
    serviceIds:     z.array(z.string()).optional(),
    discountCodeId: z.string().nullable().optional(),
    discountAmount: z.number().int().nullable().optional(),
    price:          z.number().int().min(0).optional(),
    // Round-2 backlog #10 — explicit override of tenant gating policy.
    // When omitted, createInspection inherits from tenant_configs.block_unpaid
    // / block_unsigned_agreement. When provided, this caller-level value wins.
    paymentRequired:   z.boolean().optional().openapi({ example: false }),
    agreementRequired: z.boolean().optional().openapi({ example: false }),
}).openapi('CreateInspection');

/**
 * Validation schema for patching inspection metadata.
 */
export const UpdateInspectionSchema = z.object({
    propertyAddress: z.string().min(5).optional().openapi({ example: '123 Main St, Anytown' }),
    clientName: z.string().min(1).optional().openapi({ example: 'John Doe' }),
    clientEmail: z.string().email().optional().nullable().openapi({ example: 'john@example.com' }),
    date: z.string().datetime().optional().openapi({ example: '2024-03-20T10:00:00Z' }),
    inspectorId: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440001' }),
    price: z.number().min(0).optional().openapi({ example: 450 }),
    status: z.enum(['draft', 'completed', 'delivered']).optional().openapi({ example: 'completed' }),
    paymentRequired:   z.boolean().optional().openapi({ example: false }),
    agreementRequired: z.boolean().optional().openapi({ example: false }),
    yearBuilt:      z.number().int().min(1800).max(2100).nullable().optional().openapi({ example: 1990 }),
    sqft:           z.number().int().min(0).nullable().optional().openapi({ example: 1800 }),
    foundationType: z.enum(['basement', 'slab', 'crawlspace', 'other']).nullable().optional(),
    bedrooms:       z.number().int().min(0).nullable().optional().openapi({ example: 3 }),
    bathrooms:      z.number().min(0).max(20).nullable().optional().openapi({ example: 2.5 }),
    // Round-2 backlog G1 — free-text lot size ("0.25 acres", "10,000 sqft").
    lotSize:        z.string().max(50).nullable().optional().openapi({ example: '0.25 acres' }),
    unit:           z.string().max(50).nullable().optional(),
    county:         z.string().max(100).nullable().optional(),
    // Round-2 backlog G2 (Spectora §7.10) — when does the buyer close on
    // the property. Used for follow-up CRM signals. ISO YYYY-MM-DD.
    closingDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date (YYYY-MM-DD)').nullable().optional().openapi({ example: '2026-07-15' }),
    // Round-2 backlog G3 (Spectora §4.1) — free-text Order ID for ISN-style
    // integrations. Surfaced in PMS exports.
    orderId:        z.string().max(64).nullable().optional().openapi({ example: 'ORD-2026-0142' }),
    // Round-2 backlog G3 — referral source label. Free-text so the seed
    // list ("Realtor", "Past Client", ...) plus tenant custom values both
    // round-trip without a separate enum.
    referralSource: z.string().max(100).nullable().optional().openapi({ example: 'Realtor' }),
    reportThemeOverride: z.enum(['modern', 'classic', 'minimal']).nullable().optional().openapi({ example: 'classic' }),
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
    yearBuilt:      z.number().int().min(1800).max(2100).nullable().optional().openapi({ example: 1990 }),
    sqft:           z.number().int().min(0).max(1_000_000).nullable().optional().openapi({ example: 1800 }),
    foundationType: z.enum(['basement', 'slab', 'crawlspace', 'other']).nullable().optional().openapi({ example: 'basement' }),
    lotSize:        z.string().max(50).nullable().optional().openapi({ example: '0.25 acres' }),
    bedrooms:       z.number().int().min(0).max(50).nullable().optional().openapi({ example: 3 }),
    bathrooms:      z.number().min(0).max(50).nullable().optional().openapi({ example: 2.5 }),
}).openapi('PropertyFacts');

export const PropertyFactsResponseSchema = createApiResponseSchema(PropertyFactsSchema).openapi('PropertyFactsResponse');

/**
 * Sprint 3 S3-1 — POST /api/inspections/:id/property-facts/autofill
 * Body: free-text address. Server-side proxy hits Estated.io public-records
 * API and returns a normalised PropertyFacts payload (or `null` + reason
 * code when the provider can't supply data — graceful degrade pattern).
 */
export const PropertyFactsAutofillRequestSchema = z.object({
    addressString: z.string().min(5, 'Address is too short').max(200),
}).openapi('PropertyFactsAutofillRequest');

export const PropertyFactsAutofillResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        facts:  PropertyFactsSchema.nullable(),
        source: z.enum(['estated', 'manual_required']),
        reason: z.enum(['NO_API_KEY', 'NOT_FOUND', 'PROVIDER_ERROR']).optional(),
    }),
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
    reason: CancellationReasonSchema,
    notes:  z.string().max(500).optional(),
}).openapi('CancelInspectionRequest');

export const InspectionCountsSchema = z.object({
    all:         z.number().openapi({ example: 42 }),
    today:       z.number().openapi({ example: 3 }),
    upcoming:    z.number().openapi({ example: 12 }),
    past:        z.number().openapi({ example: 27 }),
    unconfirmed: z.number().openapi({ example: 2 }),
    inProgress:  z.number().openapi({ example: 1 }),
}).openapi('InspectionCounts');
export type InspectionCounts = z.infer<typeof InspectionCountsSchema>;

/**
 * Stats Schema
 */
export const InspectionStatsSchema = z.object({
    total: z.number().openapi({ example: 100 }),
    draft: z.number().openapi({ example: 20 }),
    completed: z.number().openapi({ example: 50 }),
    delivered: z.number().openapi({ example: 30 }),
}).openapi('InspectionStats');

/**
 * Validation schema for inspection results patch.
 */
export const PatchResultsSchema = z.object({
    data: z.record(z.string(), z.unknown()),
}).openapi('PatchResults');

/**
 * Validation schema for bulk operations.
 */
export const BulkInspectionSchema = z.object({
    ids: z.array(z.string().uuid()).min(1).max(100),
    action: z.enum(['assignInspector', 'updateStatus']),
    inspectorId: z.string().uuid().optional(),
    status: z.enum(['draft', 'completed', 'delivered']).optional(),
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
  contactId: z.string().nullable(),
  channels:  z.array(z.enum(['email', 'text'])).default([]),
}).openapi('PublishRecipient');

export const PublishInspectionSchema = z.object({
  theme: z.enum(['modern', 'classic', 'minimal']).default('modern'),
  notifyClient: z.boolean().default(true),
  notifyAgent: z.boolean().default(true),
  requireSignature: z.boolean().default(false),
  requirePayment: z.boolean().default(false),
  // Round-2 F1 — multi-recipient publish modal payload. Optional because
  // legacy clients still post the flat shape above. When present, the
  // server uses this list to drive per-recipient delivery (email + text)
  // instead of the broad notifyClient/notifyAgent flags.
  recipients: z.array(PublishRecipientSchema).optional(),
  // Whether the modal sent a copy of the agreement alongside the report.
  // Stored only for audit/notification fan-out — does not change how the
  // report itself is built.
  sendAgreementCopy: z.boolean().default(false),
}).openapi('PublishInspection');

// Round-2 F1 — recipient list returned by GET /api/inspections/:id/recipients.
export const InspectionRecipientSchema = z.object({
  contactId: z.string().nullable(),
  name:      z.string(),
  role:      z.enum(['client', 'agent_buyer', 'agent_listing']),
  email:     z.string().nullable(),
  phone:     z.string().nullable(),
}).openapi('InspectionRecipient');

export const InspectionRecipientsResponseSchema = createApiResponseSchema(
  z.array(InspectionRecipientSchema)
).openapi('InspectionRecipientsResponse');

// Round-2 F3 — People card payload (Spectora §E.2).
const PeopleAgentSchema = z.object({
  id:     z.string(),
  name:   z.string(),
  email:  z.string().nullable(),
  phone:  z.string().nullable(),
  agency: z.string().nullable(),
});

export const InspectionPeopleSchema = z.object({
  inspector: z.object({
    id:    z.string(),
    name:  z.string().nullable(),
    email: z.string(),
    phone: z.string().nullable(),
  }).nullable(),
  client: z.object({
    name:  z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
  }).nullable(),
  buyerAgents:   z.array(PeopleAgentSchema),
  listingAgents: z.array(PeopleAgentSchema),
}).openapi('InspectionPeople');

export const InspectionPeopleResponseSchema = createApiResponseSchema(InspectionPeopleSchema).openapi('InspectionPeopleResponse');

export const ReportItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  rating: z.string().nullable(),
  ratingColor: z.string(),
  ratingLabel: z.string().nullable(),
  severityBucket: z.enum(['satisfactory', 'monitor', 'defect', 'other']),
  notes: z.string().nullable(),
  photos: z.array(z.object({ key: z.string(), url: z.string() })),
  recommendation: z.string().nullable().optional(),
  estimateMin: z.number().nullable().optional(),
  estimateMax: z.number().nullable().optional(),
}).openapi('ReportItem');

export const ReportSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  icon: z.string().nullable().optional(),
  defectCount: z.number(),
  items: z.array(ReportItemSchema),
}).openapi('ReportSection');

export const ReportDataResponseSchema = z.object({
  inspection: z.object({
    id: z.string(),
    propertyAddress: z.string(),
    date: z.string(),
    status: z.string(),
    inspectorName: z.string().nullable(),
  }),
  theme: z.enum(['modern', 'classic', 'minimal']),
  stats: z.object({
    total: z.number(),
    satisfactory: z.number(),
    monitor: z.number(),
    defect: z.number(),
  }),
  sections: z.array(ReportSectionSchema),
  ratingLevels: z.array(z.object({
    id: z.string(),
    label: z.string(),
    abbreviation: z.string(),
    color: z.string(),
    severity: z.string(),
    isDefect: z.boolean(),
  })),
}).openapi('ReportData');

export const InspectionListItemSchema = z.object({
    id:           z.string(),
    date:         z.string().nullable(),
    address:      z.string().nullable().optional(),
    clientName:   z.string().nullable().optional(),
    status:       z.string(),
    confirmedAt:  z.string().nullable().optional(),
    cancelReason: z.string().nullable().optional(),
    cancelNotes:  z.string().nullable().optional(),
    createdAt:    z.string().nullable().optional(),
}).passthrough().openapi('InspectionListItem');

// Sub-spec B Task 5 (B-4) — portfolio defectStats aggregated per top card.
const DefectAggregateBucketSchema = z.object({
    safety:         z.number(),
    recommendation: z.number(),
    maintenance:    z.number(),
});

export const DashboardResponseSchema = z.object({
    needsAttention: z.array(InspectionListItemSchema),
    today:          z.array(InspectionListItemSchema),
    thisWeek:       z.array(InspectionListItemSchema),
    later:          z.array(InspectionListItemSchema),
    laterTotal:     z.number(),
    recentReports:  z.array(InspectionListItemSchema),
    cancelled:      z.array(InspectionListItemSchema),
    defectAggregate: z.object({
        later:          DefectAggregateBucketSchema,
        thisWeek:       DefectAggregateBucketSchema,
        needsAttention: DefectAggregateBucketSchema,
        recentReports:  DefectAggregateBucketSchema,
    }).optional(),
}).openapi('DashboardResponse');

/**
 * Round-2 backlog #9 (Spectora §E.3) — Media Center.
 *
 * Two-list payload: photos already attached to an item plus the loose pool
 * of bulk-uploaded shots awaiting placement. The drawer renders both groups
 * with the same card UI, but only attached photos carry an itemId/section.
 */
export const MediaCenterAttachedPhotoSchema = z.object({
    key:           z.string(),
    url:           z.string(),
    itemId:        z.string(),
    itemLabel:     z.string(),
    sectionId:     z.string(),
    sectionTitle:  z.string(),
    photoIndex:    z.number().int().nonnegative(),
    annotated:     z.boolean(),
}).openapi('MediaCenterAttachedPhoto');

export const MediaCenterPoolPhotoSchema = z.object({
    id:            z.string(),
    key:           z.string(),
    url:           z.string(),
    uploadedAt:    z.number().int(),
    takenAt:       z.number().int().nullable(),
}).openapi('MediaCenterPoolPhoto');

export const MediaCenterResponseSchema = z.object({
    attached:  z.array(MediaCenterAttachedPhotoSchema),
    pool:      z.array(MediaCenterPoolPhotoSchema),
}).openapi('MediaCenterResponse');

export const MediaPoolUploadResponseSchema = z.object({
    id:          z.string(),
    key:         z.string(),
    url:         z.string(),
    uploadedAt:  z.number().int(),
    takenAt:     z.number().int().nullable(),
}).openapi('MediaPoolUploadResponse');

export const MediaAttachRequestSchema = z.object({
    poolId: z.string().min(1),
    itemId: z.string().min(1),
}).openapi('MediaAttachRequest');

export const MediaAttachResponseSchema = z.object({
    key:        z.string(),
    itemId:     z.string(),
    photoIndex: z.number().int().nonnegative(),
}).openapi('MediaAttachResponse');
