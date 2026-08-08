import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from '../shared.schema';

/**
 * Round-2 backlog G1 (Spectora §E.2) — Property Facts strip payload.
 * Six structured fields. All optional so inspectors can fill them in over
 * time. `null` clears a field; omitted = leave existing value untouched.
 *
 * `yearBuilt`, `sqft`, `bedrooms`, `bathrooms` and `foundationType` map to
 * dedicated columns on `inspections`. `lotSize` maps to the `lot_size`
 * column on `inspections`.
 */
export const PropertyFactsSchema = z.object({
    yearBuilt:      z.number().int().min(1800).max(2100).nullable().optional().openapi({ example: 1990 }).describe('TODO describe yearBuilt field for the OpenInspection MCP integration'),
    sqft:           z.number().int().min(0).max(1_000_000).nullable().optional().openapi({ example: 1800 }).describe('TODO describe sqft field for the OpenInspection MCP integration'),
    foundationType: z.enum(['basement', 'slab', 'crawlspace', 'other']).nullable().optional().openapi({ example: 'basement' }).describe('TODO describe foundationType field for the OpenInspection MCP integration'),
    lotSize:        z.string().max(50).nullable().optional().openapi({ example: '0.25 acres' }).describe('TODO describe lotSize field for the OpenInspection MCP integration'),
    bedrooms:       z.number().int().min(0).max(50).nullable().optional().openapi({ example: 3 }).describe('TODO describe bedrooms field for the OpenInspection MCP integration'),
    bathrooms:      z.number().min(0).max(50).nullable().optional().openapi({ example: 2.5 }).describe('TODO describe bathrooms field for the OpenInspection MCP integration'),
    unit:           z.string().max(120).nullable().optional().openapi({ example: 'Suite 200' }).describe('Unit / suite designation for the subject property (maps to the inspections.unit column). Null on properties with no unit.'),
    county:         z.string().max(120).nullable().optional().openapi({ example: 'Travis County' }).describe('County the subject property sits in (maps to the inspections.county column). Autofilled at intake; editable in the Property Facts strip.'),
    // Commercial PCA Phase T — tier elevation from the editor. Validated
    // against REPORT_TIERS; never accepted un-validated (CLAUDE.md Input
    // Validation Rules).
    reportTier:     z.enum(['light_commercial', 'full_pca']).nullable().optional().openapi({ example: 'light_commercial' }).describe('Commercial report tier: light_commercial or full_pca. Null falls back to the resolver default.'),
    // Commercial PCA Phase T — commercial subtype capture. Plain text, not an
    // enum: the 6 locked platform ids (office/retail/hospitality/industrial/
    // institutional/mixed-use) cover the common case, but org-custom subtypes
    // also live here (commercial_subtypes table), so this is deliberately
    // permissive rather than a hard-rejecting z.enum.
    commercialSubtype: z.string().max(64).nullable().optional().openapi({ example: 'office' }).describe('Commercial subtype id (platform id or org-custom). Only meaningful when propertyType = commercial.'),
}).openapi('PropertyFacts');

// Write-only superset of PropertyFactsSchema. The `metadata` envelope carries
// non-dedicated commercial subtype-preset fields (nra, floorCount,
// occupancyClass, sprinklered, gla, parkingSpaces, roomCount, clearHeight,
// dockCount, ...). Open-ended id set (org-custom subtypes exist — see the
// commercial_subtypes table), so a bounded record of primitives rather than a
// per-id enum. Merged into inspections.property_facts by updatePropertyFacts;
// null clears a key. The read schema stays strict (no metadata) so responses
// never leak the raw envelope shape. See design doc
// 2026-07-13-oi-property-facts-commercial-persist.
const PropertyFactValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const PropertyFactsWriteSchema = PropertyFactsSchema.extend({
    metadata: z.record(z.string(), PropertyFactValue).optional()
        .describe('Non-dedicated commercial subtype-preset fields, merged into the property_facts JSON envelope. null clears a key.'),
}).openapi('PropertyFactsWrite');

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

// Round-2 F1 — recipient list returned by GET /api/inspections/:id/recipients.
const InspectionRecipientSchema = z.object({
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

const InspectionPeopleSchema = z.object({
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

// Issue #111 — single aggregate payload for the `/inspections/:id` hub page.
// One round trip drives six blocks (People / Schedule / Services / Agreement /
// Invoice / Report status). Every field is explicit (no z.any()).
/**
 * Exported so the hub page's helpers can DERIVE their payload type from this
 * schema (`z.infer`) instead of hand-copying its fields. A hand-written mirror
 * silently rots: adding `invoice.payUrl` here left the frontend copy behind
 * until tsc happened to catch it, and an optional field would not have been
 * caught at all. One schema, one type.
 */
export const InspectionHubSchema = z.object({
  inspection: z.object({
    id:                z.string().describe('Inspection identifier'),
    propertyAddress:   z.string().describe('Subject property address'),
    clientName:        z.string().nullable().describe('Denormalized client name cache'),
    clientEmail:       z.string().nullable().describe('Denormalized client email cache'),
    clientPhone:       z.string().nullable().describe('Denormalized client phone cache'),
    clientContactId:   z.string().nullable().describe('contacts.id of the client, when linked'),
    status:            z.string().describe('Inspection lifecycle status'),
    // The service has always returned this (it drives the hub's report pill),
    // but the schema omitted it — so the published OpenAPI/MCP contract
    // under-described the payload. Deriving the frontend type from this schema
    // is what surfaced the gap.
    reportStatus:      z.string().describe('Report lifecycle status: in_progress | submitted | published'),
    date:              z.string().nullable().describe('Scheduled inspection date (YYYY-MM-DD)'),
    inspectorId:       z.string().nullable().describe('Assigned inspector users.id'),
    templateId:        z.string().nullable().describe('Selected template id'),
    price:             z.number().optional().describe('Denormalized price cache in cents (authority chain tier 3). ABSENT when the caller lacks the financial capability (IA-95).'),
    paymentStatus:     z.string().describe('Payment status: unpaid | partial | paid'),
    paymentRequired:   z.boolean().describe('Whether report is payment-gated'),
    agreementRequired: z.boolean().describe('Whether report is agreement-gated'),
    unlockedAt: z.string().nullable().describe('When the order-wide report gate was manually released; null when still gated.'),
    unlockedByName: z.string().nullable().describe('Who released the gate, resolved to a name for reading.'),
    unlockReason: z.string().nullable().describe('Why the gate was released.'),
    coverPhoto:        z.string().nullable().describe('R2 key of the photo used as the report cover image'),
    referredByAgentId: z.string().nullable().describe('Buyer agent contacts.id'),
    sellingAgentId:    z.string().nullable().describe('Listing agent contacts.id'),
    createdAt:         z.string().nullable().describe('ISO creation timestamp'),
    closingDate:       z.string().nullable().describe('Buyer closing date (YYYY-MM-DD), null when unset'),
    referenceNumber:   z.string().nullable().describe('Operator-facing order reference, null when unset'),
    referralSource:    z.string().nullable().describe('Where the order came from, null when unset'),
    referredByContactId: z.string().nullable().describe('Contact who referred this job (any contact, not only agents); null when unattributed.'),
    referredByName:      z.string().nullable().describe('Display name of the referrer, resolved for the card; null when unattributed or the contact was deleted.'),
  }).describe('Core inspection fields for the hub header'),
  tenantSlug: z.string().describe('Tenant slug, for building /report/:tenantSlug/:id links'),
  people: InspectionPeopleSchema.describe('Inspector + client + agents (reuses the people-card aggregation)'),
  services: z.array(z.object({
    id:        z.string().describe('inspection_services row id'),
    serviceId: z.string().describe('Catalog service this line came from — lets a picker mark what is already booked'),
    name:      z.string().describe('Service name snapshot'),
    priceCents: z.number().optional().describe('Effective line price (priceOverride ?? priceSnapshot). ABSENT without the financial capability.'),
    priceSnapshot: z.number().optional().describe('Catalog price in cents when the line was added. ABSENT without the financial capability.'),
    priceOverride: z.number().nullable().optional().describe('Per-inspection price override in cents, or null. ABSENT without the financial capability.'),
  })).describe('Booked service lines'),
  agreements: z.array(z.object({
    id:   z.string().describe('Agreement template id'),
    name: z.string().describe('Agreement template name'),
  })).describe("Tenant's agreement templates (for a send-agreement dropdown)"),
  agreementRequests: z.array(z.object({
    id:            z.string().describe('agreement_requests row id'),
    status:        z.string().describe('pending | sent | viewed | signed | declined | expired'),
    clientEmail:   z.string().describe('Recipient email'),
    signedAt:      z.string().nullable().describe('ISO sign timestamp, null until signed'),
    createdAt:     z.string().nullable().describe('ISO creation timestamp'),
    agreementName: z.string().nullable().describe('Name of the agreement template this envelope was sent from'),
    signersTotal:  z.number().describe('How many signers the envelope has'),
    signersSigned: z.number().describe('How many of them have signed'),
  })).describe('Agreement requests for this inspection, newest first'),
  invoice: z.object({
    id:         z.string().describe('Invoice id'),
    status:     z.string().describe('draft | sent | partial | paid'),
    amountCents: z.number().optional().describe('Invoice total in cents. ABSENT without the financial capability.'),
    // Cumulative amount RECEIVED, not a remaining balance — the remainder is
    // derived against our own authoritative total (`amountCents`), never against
    // an external system's. Null when the invoice is partial but no figure was
    // recorded, which the UI must render as "unknown" rather than as zero.
    // ABSENT (not null) without the financial capability — `redactMoney` drops
    // every `*Cents` key.
    amountPaidCents: z.number().nullable().optional().describe('Cumulative amount received in cents; null when unrecorded. ABSENT without the financial capability.'),
    currency:   z.string().optional().describe("ISO 4217 currency snapshot the invoice was created in — what its figures must be formatted in, not the viewer's default."),
    sentAt:     z.string().nullable().describe('ISO sent timestamp'),
    paidAt:     z.string().nullable().describe('ISO paid timestamp'),
    // IA-34 — the public pay page is token-gated, so a bare `/invoice/:id` is
    // refused. The inspector's "copy pay link" must hand out the SAME tokenized
    // URL the emailed link carries; null when no primary client email exists to
    // bind a token to (the UI hides the action rather than copy a dead link).
    payUrl:     z.string().nullable().describe('Tokenized public pay link, or null when unavailable'),
  }).nullable().describe('Most recent invoice for the inspection, or null'),
  publishReadiness: z.object({
    ready:         z.boolean().describe('True when every required defect field is filled'),
    blockingCount: z.number().describe('Count of defects blocking publish'),
  }).describe('Report-status gate summary (reuses computePublishReadiness)'),
  reports: z.array(z.object({
    id:     z.string().describe('reports.id'),
    kind:   z.enum(['primary', 'ancillary']).describe("'primary' is the one a client means by \"my report\"; there is exactly one."),
    title:  z.string().describe('Report title, snapshotted from the service line that produced it'),
    status: z.string().describe('in_progress | published'),
    publishedAt: z.string().nullable().describe('ISO instant THIS deliverable went out; null while unpublished'),
    versionCount: z.number().describe('Signed versions this report owns — part of what deleting it would destroy'),
    hasContent: z.boolean().describe('Whether its document has been written into ("information you already filled out")'),
    canDelete: z.boolean().describe('Decided server-side by the same function the DELETE endpoint enforces, so the UI cannot offer an action the API refuses'),
    deleteBlockedReason: z.enum(['primary', 'published']).nullable().describe('Why deletion is refused, for the disabled control reason; null when it is allowed'),
  })).describe("The order's deliverables. One order, several reports — each with its own document, signature chain and notification."),
  communication: z.object({
    delivered:      z.number().describe('Platform notices delivered (status sent, due rows only).'),
    needsAttention: z.number().describe('Platform notices skipped or failed — the count that auto-expands the block.'),
    unread:         z.number().describe('Unread counterparty-authored messages on this inspection.'),
    rulesActive:    z.number().describe("Active automation rules in the tenant — distinguishes the Outbox's three empty states."),
  }).describe('Communication section header counts, so the section summary renders without a second round trip.'),
}).openapi('InspectionHub');

export const InspectionHubResponseSchema = createApiResponseSchema(InspectionHubSchema).openapi('InspectionHubResponse');

/**
 * Task 7 (Issue #111) — body for POST /api/inspections/:id/agreement-requests.
 * Every field optional: agreementId defaults to the tenant's first agreement
 * template, and the recipient defaults to the inspection's primary client.
 *
 * IA-65 — `signers` carries the multi-party set the inspection workspace now
 * sends (name + email + role, plus a completion policy). `email` is the older
 * single-recipient shorthand and is still accepted; when both are given the
 * explicit signer list wins. Multi-signer sending used to be reachable only
 * from the tenant-wide Library page, which meant an inspector — who may send
 * agreements but is not an admin — could only ever send to one person.
 */
export const SendAgreementRequestSchema = z.object({
  // Canonical UUID: agreements.id is always crypto.randomUUID() in production
  // (the Spectora import preserves external ids only for template-internal items,
  // never as the agreements PK). Pre-launch we enforce the canonical format rather
  // than tolerate non-UUID ids — only test seeds were ever non-UUID.
  agreementId: z.string().trim().min(1).optional().describe('Agreement template id; defaults to the tenant first agreement'),
  email: z.string().email().optional().describe('Single recipient email; defaults to the inspection primary client. Ignored when `signers` is present.'),
  signers: z.array(z.object({
    name: z.string().min(1).max(200).describe('Signer display name'),
    email: z.string().email().describe('Signer email; each signer gets their own private signing link'),
    role: z.enum(['client', 'co_client', 'agent', 'other']).optional().describe('Signer role on this inspection; defaults to client'),
  })).min(1).max(10).optional().describe('Multi-party signer set. Signers already on the live envelope are left untouched; new ones are added to it.'),
  completionPolicy: z.enum(['all', 'one']).optional().describe("'all' = every signer must sign; 'one' = the first signature completes the envelope"),
}).openapi('SendAgreementRequest');

export const AgreementRequestCreatedSchema = createApiResponseSchema(
  z.object({
    id:          z.string().describe('agreement_requests row id'),
    status:      z.string().describe('Request status (sent)'),
    clientEmail: z.string().describe('First signer email (the envelope recipient)'),
    createdAt:   z.string().nullable().describe('ISO creation timestamp'),
    // IA-65 — a send against a live envelope reports what it actually changed,
    // so a caller can tell "added two co-signers" from "re-sent to the same one".
    signerCount:  z.number().describe('Total signers on the envelope after this send'),
    addedSigners: z.number().describe('How many signers this send added to an existing envelope (0 for a fresh envelope)'),
  }),
).openapi('AgreementRequestCreatedResponse');

const ReportItemSchema = z.object({
  id: z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
  label: z.string().describe('TODO describe label field for the OpenInspection MCP integration'),
  rating: z.string().nullable().describe('TODO describe rating field for the OpenInspection MCP integration'),
  ratingColor: z.string().describe('TODO describe ratingColor field for the OpenInspection MCP integration'),
  ratingLabel: z.string().nullable().describe('TODO describe ratingLabel field for the OpenInspection MCP integration'),
  severityBucket: z.enum(['satisfactory', 'monitor', 'defect', 'other']).describe('TODO describe severityBucket field for the OpenInspection MCP integration'),
  notes: z.string().nullable().describe('TODO describe notes field for the OpenInspection MCP integration'),
  photos: z.array(z.object({ key: z.string().describe('TODO describe key field for the OpenInspection MCP integration'), url: z.string().describe('TODO describe url field for the OpenInspection MCP integration') })).describe('TODO describe photos field for the OpenInspection MCP integration'),
  recommendation: z.string().nullable().optional().describe('TODO describe recommendation field for the OpenInspection MCP integration'),
  // No item-level estimateMin / estimateMax: the "Estimated cost" badge they
  // fed is gone. The `repairItems[]` pair below is a LEGACY READ — findings
  // written before repair pricing was withdrawn still hold the snapshot, and it
  // is emitted as null on every finding written since.
  repairItems: z.array(z.object({
    summary: z.string(),
    estimateMin: z.number().nullable(),
    estimateMax: z.number().nullable(),
    contractorType: z.string().nullable(),
  })).optional().describe('Attached repair items snapshotted on this finding (dollars, not cents).'),
}).openapi('ReportItem');

const ReportSectionSchema = z.object({
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
  styleProfile: z.object({
    id: z.string(),
    name: z.string(),
    schemaVersion: z.number(),
    colour: z.string().nullable(),
    badgeLayout: z.enum(['strip', 'inline']),
    photoColumns: z.number(),
    tokens: z.record(z.string(), z.string()),
  }).describe('Resolved report appearance profile (Report Style Presets)'),
  inspectorCredentials: z.array(z.object({
    label: z.string(),
    memberNumber: z.string().nullable(),
    imageUrl: z.string().nullable(),
  })).describe('Inspector self-asserted credentials snapshotted into the report (Spec B)'),
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

const InspectionListItemSchema = z.object({
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
