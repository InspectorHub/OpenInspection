import { sqliteTable, text, integer, real, uniqueIndex, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { tenants, users } from './tenant';
import { contacts } from './contact';

// Sprint 2 S2-1 — tenant-scoped rating systems library. The level list
// itself is stored as JSON because it is never queried independently and
// the row count per system is tiny (≤ 10).
export const ratingSystems = sqliteTable('rating_systems', {
    id:          text('id').primaryKey(),
    tenantId:    text('tenant_id').notNull().references(() => tenants.id),
    name:        text('name').notNull(),
    slug:        text('slug').notNull(),
    description: text('description'),
    levels:      text('levels', { mode: 'json' }).notNull(),
    isDefault:   integer('is_default', { mode: 'boolean' }).notNull().default(false),
    isSeed:      integer('is_seed',    { mode: 'boolean' }).notNull().default(false),
    createdAt:   integer('created_at').notNull(),
    updatedAt:   integer('updated_at').notNull(),
}, (t) => ({
    tenantSlugUnique: uniqueIndex('idx_rating_systems_tenant_slug').on(t.tenantId, t.slug),
    tenantIdx:        index('idx_rating_systems_tenant').on(t.tenantId),
}));

export const templates = sqliteTable('templates', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    version: integer('version').notNull().default(1),
    schema: text('schema', { mode: 'json' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    // Sprint 2 S2-1 — selects the active rating system. Null = use tenant default.
    ratingSystemId: text('rating_system_id'),
    propertyType: text('property_type'),
    commercialSubtype: text('commercial_subtype'),
    description: text('description'),
    featured: integer('featured').notNull().default(0),
}, (t) => [
    index('idx_templates_tenant').on(t.tenantId),
    index('idx_templates_rating_system').on(t.ratingSystemId),
]);

export const inspections = sqliteTable('inspections', {
    id:                  text('id').primaryKey(),
    tenantId:            text('tenant_id').notNull().references(() => tenants.id),
    inspectorId:         text('inspector_id').references(() => users.id),
    propertyAddress:     text('property_address').notNull(),
    // Spec 5D — geocoded address fields populated by Google Places Details
    // when the inspector picks an autocomplete result. All nullable so legacy
    // inspections (free-text address only) load without backfill.
    addressPlaceId:      text('address_place_id'),
    addressStreet:       text('address_street'),
    addressCity:         text('address_city'),
    addressState:        text('address_state'),
    addressZip:          text('address_zip'),
    addressCounty:       text('address_county'),
    addressLat:          real('address_lat'),
    addressLng:          real('address_lng'),
    addressGeocodedAt:   integer('address_geocoded_at'),
    // IA-1 — the order finally captures WHO. Points at contacts.id (app-layer
    // integrity per the FK policy); the denormalized clientName/Email/Phone
    // below remain as a read cache and are double-written on create.
    clientContactId:     text('client_contact_id'),
    clientName:          text('client_name'),
    clientEmail:         text('client_email'),
    clientPhone:         text('client_phone'),
    templateId:          text('template_id').references(() => templates.id),
    date:                text('date').notNull(),
    status:              text('status', { enum: ['draft','scheduled','confirmed','in_progress','completed','delivered','published','cancelled'] }).notNull().default('draft'),
    paymentStatus:       text('payment_status', { enum: ['unpaid','partial','paid'] }).notNull().default('unpaid'),
    referredByAgentId:   text('referred_by_agent_id'),   // Buyer's Agent — unkeyed TEXT (backward compat)
    // P-4 authority chain: denormalized cache only — never reconcile back from invoice
    // or service-snapshot tiers. Use getEffectivePriceCents() (app/lib/effective-price.ts)
    // to read the authoritative price. Written by the inspection-create path as a
    // convenience snapshot; kept in sync when service lines change.
    price:               integer('price').notNull().default(0),
    createdAt:           integer('created_at', { mode: 'timestamp' }).notNull(),
    // Phase 0 parity additions
    confirmedAt:         text('confirmed_at'),
    cancelReason:        text('cancel_reason'),
    cancelNotes:         text('cancel_notes'),  // Spec 3A
    paymentRequired:     integer('payment_required', { mode: 'boolean' }).notNull().default(false),
    agreementRequired:   integer('agreement_required', { mode: 'boolean' }).notNull().default(false),
    // Spec 5H D2 — when true, InspectionService.publish() auto-injects the
    // inspector's users.default_signature_base64 into inspection_results.data._inspector_signature.
    autoSignOnPublish:   integer('auto_sign_on_publish', { mode: 'boolean' }).notNull().default(false),
    discountCodeId:      text('discount_code_id').references(() => discountCodes.id),
    discountAmount:      integer('discount_amount'),
    closingDate:         text('closing_date'),
    referralSource:      text('referral_source'),
    orderId:             text('order_id'),
    internalNotes:       text('internal_notes'),
    yearBuilt:           integer('year_built'),
    sqft:                integer('sqft'),
    foundationType:      text('foundation_type'),
    bedrooms:            integer('bedrooms'),
    bathrooms:           real('bathrooms'),
    // Round-2 backlog G1 (Spectora §E.2) — free-text lot size so inspectors
    // can enter "0.25 acres", "10,000 sqft", etc. without a parser.
    lotSize:             text('lot_size'),
    // Round-2 backlog G1 — JSON envelope for future property facts that
    // don't warrant their own column. Reads/writes go through
    // updatePropertyFacts() which merges with the dedicated columns.
    propertyFacts:       text('property_facts', { mode: 'json' }).$type<Record<string, unknown>>(),
    // Design System 0520 subsystem E P1 — id of the inspection_media_pool
    // row used as the report cover image. NULL until the inspector picks
    // one; the Publish pre-flight surfaces this as a gate.
    coverPhotoId:        text('cover_photo_id'),
    unit:                text('unit'),
    propertyType:        text('property_type'),
    commercialSubtype:   text('commercial_subtype'),
    county:              text('county'),
    sellingAgentId:      text('selling_agent_id').references(() => contacts.id),
    disableAutomations:  integer('disable_automations', { mode: 'boolean' }).notNull().default(false),
    messageToken:        text('message_token').unique('idx_inspections_msg_token'),
    templateSnapshot:    text('template_snapshot', { mode: 'json' }),
    templateSnapshotVersion: integer('template_snapshot_version').default(1),
    reportThemeOverride: text('report_theme_override', { enum: ['modern', 'classic', 'minimal'] }),
    // Sprint 2 S2-2 — Multi-inspection per request. NULL on legacy rows pre-backfill;
    // application requires a non-null value on all newly created inspections.
    requestId:           text('request_id').references(() => inspectionRequests.id),
    // Agent Accounts A3 — concierge booking state machine.
    //   NULL                 = not a concierge booking (or already settled into status='confirmed' / 'cancelled')
    //   'awaiting_inspector' = agent submitted; inspector must approve (Spectora reviewer mode)
    //   'awaiting_client'    = magic-link sent to client; waiting on confirmation (HomeGauge auto mode or post-inspector-approve)
    conciergeStatus:     text('concierge_status'),
    // Design System 0520 M3 — TeamMode + multi-inspector (subsystem B, phase 1).
    //   teamMode             = boolean flag enabling team UI (TeamBanner / RosterPopover).
    //   leadInspectorId      = primary inspector. NULL ⇒ falls back to inspectorId above.
    //   helperInspectorIds   = JSON array of additional inspectors with edit access.
    //   dataVersion          = monotonic counter; bumped on every successful field write
    //                          (see InspectionService.patchItem) for offline-queue staleness checks.
    teamMode:            integer('team_mode', { mode: 'boolean' }).notNull().default(false),
    leadInspectorId:     text('lead_inspector_id'),
    helperInspectorIds:  text('helper_inspector_ids').notNull().default('[]'),
    dataVersion:         integer('data_version').notNull().default(0),
}, (t) => [
    index('idx_inspections_tenant').on(t.tenantId),
    index('idx_inspections_request').on(t.requestId),
    index('idx_inspections_inspector').on(t.inspectorId),
    index('idx_inspections_agent').on(t.referredByAgentId),
    index('idx_inspections_tenant_status').on(t.tenantId, t.status),
    index('idx_inspections_tenant_date').on(t.tenantId, t.date),
    index('idx_inspections_tenant_client_email').on(t.tenantId, t.clientEmail),
    index('idx_inspections_inspector_date').on(t.inspectorId, t.date),
]);

// Sprint 2 S2-2 — A single customer booking can spawn multiple inspections
// (e.g. Residential + Radon + Termite at the same address). All inspections
// in a request share the schedule + property metadata.
export const inspectionRequests = sqliteTable('inspection_requests', {
    id:               text('id').primaryKey(),
    tenantId:         text('tenant_id').notNull().references(() => tenants.id),
    clientName:       text('client_name').notNull(),
    clientEmail:      text('client_email'),
    clientPhone:      text('client_phone'),
    propertyAddress:  text('property_address').notNull(),
    propertyCity:     text('property_city'),
    propertyState:    text('property_state'),
    propertyZip:      text('property_zip'),
    scheduledAt:      text('scheduled_at').notNull(),
    status:           text('status', {
        enum: ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled'],
    }).notNull().default('pending'),
    notes:            text('notes'),
    totalAmount:      integer('total_amount').notNull().default(0),
    paymentStatus:    text('payment_status', {
        enum: ['unpaid', 'partial', 'paid'],
    }).notNull().default('unpaid'),
    createdAt:        integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt:        integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_inspection_requests_tenant').on(t.tenantId, t.status, t.scheduledAt),
    index('idx_inspection_requests_email').on(t.tenantId, t.clientEmail),
]);

export const agreements = sqliteTable('agreements', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    content: text('content').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
    index('idx_agreements_tenant').on(t.tenantId),
]);

export const inspectionAgreements = sqliteTable('inspection_agreements', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    inspectionId: text('inspection_id').notNull().references(() => inspections.id),
    signatureBase64: text('signature_base64').notNull(),
    signedAt: integer('signed_at', { mode: 'timestamp' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
}, (t) => [
    index('idx_insp_agreements_tenant').on(t.tenantId),
    index('idx_insp_agreements_insp').on(t.inspectionId),
]);

// Sprint 3 S3-3 — T-key Tag system. Tenant-scoped tag library + a
// many-to-many link table connecting an inspection-item position to one or
// more tags. Internal-only (never rendered on customer-facing report).
//
// Design notes:
//   - `name` is unique per tenant.
//   - `is_seed` marks the five default tags planted on first /tags visit.
//   - The link table uses (inspection_id, item_id, tag_id) as a composite
//     PK so re-linking the same tag is a no-op without DELETE-then-INSERT.
export const tags = sqliteTable('tags', {
    id:        text('id').primaryKey(),
    tenantId:  text('tenant_id').notNull(),
    name:      text('name').notNull(),
    color:     text('color'),
    isSeed:    integer('is_seed').notNull().default(0),
    createdAt: integer('created_at').notNull(),
}, (t) => ({
    tenantNameUnique: uniqueIndex('idx_tags_tenant_name').on(t.tenantId, t.name),
    tenantIdx:        index('idx_tags_tenant').on(t.tenantId),
}));

export const inspectionItemTagLinks = sqliteTable('inspection_item_tag_links', {
    inspectionId: text('inspection_id').notNull(),
    itemId:       text('item_id').notNull(),
    tagId:        text('tag_id').notNull(),
    tenantId:     text('tenant_id').notNull(),
    createdAt:    integer('created_at').notNull(),
}, (t) => [
    primaryKey({ columns: [t.inspectionId, t.itemId, t.tagId] }),
    index('idx_tag_links_tenant').on(t.tenantId),
    index('idx_tag_links_tag').on(t.tagId),
    index('idx_tag_links_inspection_item').on(t.inspectionId, t.itemId),
]);

// Round-2 backlog #9 (Spectora §E.3) — Media Center pool. Photos uploaded
// ahead of item placement live here until the inspector drags one onto an
// item textarea, at which point InspectionService.attachPoolPhoto moves it
// into inspection_results.data[itemId].photos[] and deletes the pool row.
export const inspectionMediaPool = sqliteTable('inspection_media_pool', {
    id:            text('id').primaryKey(),
    inspectionId:  text('inspection_id').notNull(),
    tenantId:      text('tenant_id').notNull(),
    r2Key:         text('r2_key').notNull(),
    url:           text('url').notNull(),
    uploadedAt:    integer('uploaded_at').notNull(),
    // JSON envelope: { takenAt?: number, gps?: {lat,lng}, cameraModel?: string }
    exifData:      text('exif_data', { mode: 'json' }).$type<{
        takenAt?:     number;
        gps?:         { lat: number; lng: number };
        cameraModel?: string;
    }>(),
    // Design System 0520 M14 — PhotoStudio annotation overlay (subsystem A,
    // phase 4). `annotations` is opaque JSON-encoded shape array (≤8 KB)
    // consumed exclusively client-side. `caption` is user-supplied, ≤200 chars.
    annotations:   text('annotations'),
    caption:       text('caption'),
}, (t) => [
    index('idx_media_pool_tenant').on(t.tenantId),
    index('idx_media_pool_inspection').on(t.inspectionId),
]);

export const inspectionResults = sqliteTable('inspection_results', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    inspectionId: text('inspection_id').notNull().references(() => inspections.id),
    data: text('data', { mode: 'json' }).notNull(),
    lastSyncedAt: integer('last_synced_at', { mode: 'timestamp' }).notNull(),
    // Sprint 2 S2-1 — denormalized rating system reference and a frozen
    // snapshot of the levels array at inspection creation. Editing the
    // source rating system afterwards never mutates an existing inspection.
    ratingSystemId:       text('rating_system_id'),
    ratingSystemSnapshot: text('rating_system_snapshot', { mode: 'json' }),
}, (t) => [
    index('idx_results_tenant').on(t.tenantId),
    index('idx_results_inspection').on(t.inspectionId),
    uniqueIndex('uq_results_inspection').on(t.inspectionId),
]);

export const availability = sqliteTable('availability', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    inspectorId: text('inspector_id').notNull().references(() => users.id),
    dayOfWeek: integer('day_of_week').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
    index('idx_availability_inspector').on(t.inspectorId),
]);

export const availabilityOverrides = sqliteTable('availability_overrides', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    inspectorId: text('inspector_id').notNull().references(() => users.id),
    date: text('date').notNull(),
    isAvailable: integer('is_available', { mode: 'boolean' }).notNull().default(false),
    startTime: text('start_time'),
    endTime: text('end_time'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
    index('idx_avail_overrides_insp').on(t.inspectorId),
]);

export const comments = sqliteTable('comments', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    text: text('text').notNull(),
    category: text('category'),
    // Spec 2026-05-07 — rating bucket so user snippets stack alongside the
    // 248 seeded library entries in the inspection-edit Library drawer.
    // 'satisfactory' | 'monitor' | 'defect' | null (= uncategorized / "All")
    ratingBucket: text('rating_bucket'),
    // Section label (Roof, Electrical, ...) — same shape as canned-comments.js
    // entries. Free-text so tenants can grow their own taxonomy.
    section: text('section'),
    // Sprint 2 S2-7 — provenance for marketplace-imported comments.
    // Set when MarketplaceService.importLibrary inserts rows; null for
    // tenant-authored comments. Used by replace-mode update to delete only
    // prior-import rows, never touching the tenant's own comments.
    libraryId: text('library_id'),
    sectionIds: text('section_ids'),
    itemLabels: text('item_labels'),
    triggerCode: text('trigger_code'),
    searchKeywords: text('search_keywords'),
    // Comments Library Upgrade — canonical single item label for the sort
    // + filter UI in the inspection-edit Library drawer. Distinct from the
    // existing plural `itemLabels` which stores all matched labels.
    itemLabel: text('item_label'),
    severity: text('severity'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
    index('idx_comments_tenant').on(t.tenantId),
    index('idx_comments_rating_bucket').on(t.tenantId, t.ratingBucket),
    index('idx_comments_library_id').on(t.libraryId),
]);

// Comments Library Upgrade — per-user usage tracking. Drives the "most-used by
// you" sort option + AUTO filter mode in the Library drawer. Composite PK on
// (tenant, user, comment) gives O(1) upsert per touch.
export const commentUsage = sqliteTable('comment_usage', {
    tenantId:   text('tenant_id').notNull(),
    userId:     text('user_id').notNull(),
    commentId:  text('comment_id').notNull().references(() => comments.id, { onDelete: 'cascade' }),
    useCount:   integer('use_count').notNull().default(0),
    lastUsedAt: integer('last_used_at'),
}, (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.userId, table.commentId] }),
    userLastUsedIdx: index('idx_comment_usage_user_last_used').on(table.tenantId, table.userId, table.lastUsedAt),
}));

export const agreementRequests = sqliteTable('agreement_requests', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    inspectionId: text('inspection_id').references(() => inspections.id),
    agreementId: text('agreement_id').notNull().references(() => agreements.id),
    clientEmail: text('client_email').notNull(),
    clientName: text('client_name'),
    token: text('token').notNull().unique(),
    status: text('status', { enum: ['pending', 'sent', 'viewed', 'signed', 'declined', 'expired'] }).notNull().default('pending'),
    signatureBase64: text('signature_base64'),
    signedAt: integer('signed_at', { mode: 'timestamp' }),
    viewedAt: integer('viewed_at', { mode: 'timestamp' }),
    sentAt: integer('sent_at', { mode: 'timestamp' }),
    lastError: text('last_error'),
    // Spec 5H D1 — optional inspector pre-sign. NULL until inspector signs.
    inspectorSignatureBase64: text('inspector_signature_base64'),
    inspectorSignedAt:        integer('inspector_signed_at', { mode: 'timestamp' }),
    inspectorUserId:          text('inspector_user_id').references(() => users.id),
    // Spec 5H P2 — opaque public-verifier token. Set on the sign event.
    verificationToken: text('verification_token'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
    uniqueIndex('idx_agreement_requests_verify_token').on(t.verificationToken),
    index('idx_agreement_requests_tenant').on(t.tenantId),
    index('idx_agreement_requests_inspection').on(t.inspectionId),
]);

export const services = sqliteTable('services', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    description: text('description'),
    price: integer('price').notNull(), // cents
    durationMinutes: integer('duration_minutes'),
    templateId: text('template_id').references(() => templates.id),
    agreementId: text('agreement_id').references(() => agreements.id),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
    index('idx_services_tenant').on(t.tenantId),
]);

export const inspectionServices = sqliteTable('inspection_services', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    inspectionId: text('inspection_id').notNull().references(() => inspections.id, { onDelete: 'cascade' }),
    serviceId: text('service_id').notNull().references(() => services.id),
    // P-4 authority chain (tier 2): effective line price = priceOverride ?? priceSnapshot.
    // SUM across all lines for this inspection is authoritative over inspections.price
    // but subordinate to any invoice.amountCents. See getEffectivePriceCents().
    priceOverride: integer('price_override'),
    nameSnapshot: text('name_snapshot').notNull(),
    priceSnapshot: integer('price_snapshot').notNull(),
}, (t) => [
    index('idx_insp_services_tenant').on(t.tenantId),
    index('idx_insp_services_insp').on(t.inspectionId),
]);

export const discountCodes = sqliteTable('discount_codes', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    code: text('code').notNull(),
    type: text('type', { enum: ['fixed', 'percent'] }).notNull(),
    value: integer('value').notNull(),
    maxUses: integer('max_uses'),
    usesCount: integer('uses_count').notNull().default(0),
    expiresAt: text('expires_at'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
    index('idx_discount_codes_tenant').on(t.tenantId),
    uniqueIndex('discount_codes_code_tenant').on(sql`upper(code)`, t.tenantId),
]);

export const automations = sqliteTable('automations', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    trigger: text('trigger', {
        enum: [
            'inspection.created', 'inspection.confirmed', 'inspection.cancelled',
            'report.published', 'invoice.created', 'payment.received', 'agreement.signed',
            'agreement.viewed', 'agreement.declined', 'agreement.expired',
            'event.created', 'event.completed',
        ],
    }).notNull(),
    recipient: text('recipient', {
        enum: ['client', 'buying_agent', 'selling_agent', 'inspector', 'all'],
    }).notNull(),
    delayMinutes: integer('delay_minutes').notNull().default(0),
    subjectTemplate: text('subject_template').notNull(),
    bodyTemplate: text('body_template').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
    index('idx_automations_tenant').on(t.tenantId),
]);

export const automationLogs = sqliteTable('automation_logs', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    automationId: text('automation_id').notNull(),
    inspectionId: text('inspection_id').notNull(),
    recipientEmail: text('recipient_email').notNull(),
    sendAt: text('send_at').notNull(),
    deliveredAt: text('delivered_at'),
    status: text('status', { enum: ['pending', 'sent', 'failed', 'skipped'] }).notNull().default('pending'),
    error: text('error'),
    eventId: text('event_id'),
}, (t) => [
    index('idx_automation_logs_pending').on(t.tenantId, t.status, t.sendAt),
    index('idx_automation_logs_insp').on(t.inspectionId),
]);

// Spec 4D — Inspection Events

export const eventTypes = sqliteTable('event_types', {
    id:                 text('id').primaryKey(),
    tenantId:           text('tenant_id').notNull().references(() => tenants.id),
    name:               text('name').notNull(),
    slug:               text('slug').notNull(),
    defaultDurationMin: integer('default_duration_min').notNull().default(30),
    defaultPriceCents:  integer('default_price_cents').notNull().default(0),
    color:              text('color').notNull().default('#6366f1'),
    sortOrder:          integer('sort_order').notNull().default(0),
    active:             integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt:          integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
    uniqueIndex('event_types_tenant_slug_idx').on(t.tenantId, t.slug),
]);

// Agent Accounts A3 — Concierge magic-link tokens. Single-use, 7-day TTL.
// `confirmed_at` flips to a timestamp when the client redeems the link; the
// row is retained for audit (we don't delete tokens). The expiry index lets
// future cleanup jobs scan stale rows efficiently without a full table scan.
export const conciergeConfirmTokens = sqliteTable('concierge_confirm_tokens', {
    token:         text('token').primaryKey(),
    inspectionId:  text('inspection_id').notNull().references(() => inspections.id),
    tenantId:      text('tenant_id').notNull(),
    clientEmail:   text('client_email').notNull(),
    expiresAt:     integer('expires_at', { mode: 'timestamp' }).notNull(),
    confirmedAt:   integer('confirmed_at', { mode: 'timestamp' }),
    createdAt:     integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
    index('idx_concierge_tokens_expiry').on(t.expiresAt),
]);

export const inspectionEvents = sqliteTable('inspection_events', {
    id:                text('id').primaryKey(),
    tenantId:          text('tenant_id').notNull().references(() => tenants.id),
    inspectionId:      text('inspection_id').notNull().references(() => inspections.id, { onDelete: 'cascade' }),
    eventTypeId:       text('event_type_id').notNull().references(() => eventTypes.id),
    inspectorId:       text('inspector_id').references(() => users.id),
    scheduledAt:       integer('scheduled_at', { mode: 'timestamp' }).notNull(),
    durationMin:       integer('duration_min').notNull(),
    priceCents:        integer('price_cents').notNull().default(0),
    status:            text('status', { enum: ['scheduled', 'completed', 'results_received', 'cancelled'] }).notNull().default('scheduled'),
    notes:             text('notes'),
    completedAt:       integer('completed_at', { mode: 'timestamp' }),
    resultsReceivedAt: integer('results_received_at', { mode: 'timestamp' }),
    cancelledAt:       integer('cancelled_at', { mode: 'timestamp' }),
    gcalEventId:       text('gcal_event_id'),
    createdAt:         integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
    index('inspection_events_scheduled_idx').on(t.tenantId, t.scheduledAt),
    index('inspection_events_inspection_idx').on(t.inspectionId),
]);
