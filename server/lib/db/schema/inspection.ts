import { sqliteTable, text, integer, real, uniqueIndex, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { tenants, users } from './tenant';
import { contacts } from './contact';
import { INSPECTION_STATUSES } from '../../status/inspection-status';
import { REPORT_STATUSES } from '../../status/report-status';

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
    featured: integer('featured', { mode: 'boolean' }).notNull().default(false),
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
    status:              text('status', { enum: [...INSPECTION_STATUSES] }).notNull().default('requested'),
    reportStatus:        text('report_status', { enum: [...REPORT_STATUSES] }).notNull().default('in_progress'),
    paymentStatus:       text('payment_status', { enum: ['unpaid','partial','paid'] }).notNull().default('unpaid'),
    referredByAgentId:   text('referred_by_agent_id'),   // Buyer's Agent — unkeyed TEXT (backward compat)
    // P-4 authority chain: denormalized cache only — never reconcile back from invoice
    // or service-snapshot tiers. Use getEffectivePriceCents() (app/lib/effective-price.ts)
    // to read the authoritative price. Written by the inspection-create path as a
    // convenience snapshot; kept in sync when service lines change.
    price:               integer('price_cents').notNull().default(0),
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
    discountAmount:      integer('discount_amount_cents'),
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
    // Media Studio (cover crop) — re-editable crop transform applied to the
    // SOURCE image (cover_photo_id), in source-pixel coords. NULL = uncropped.
    coverCrop:           text('cover_crop', { mode: 'json' }).$type<{
        aspect: '3:2' | '16:9' | '1.91:1' | '4:3';
        orientation: 'landscape' | 'portrait';
        x: number; y: number; width: number; height: number;
    }>(),
    // Media Studio (cover crop) — R2 key of the baked cropped derivative
    // (JPEG, 2048px long edge). Report/OG/PDF read THIS when set; falls back
    // to cover_photo_id (uncropped source) otherwise.
    coverImageKey:       text('cover_image_key'),
    unit:                text('unit'),
    propertyType:        text('property_type'),
    commercialSubtype:   text('commercial_subtype'),
    county:              text('county'),
    sellingAgentId:      text('selling_agent_id').references(() => contacts.id),
    disableAutomations:  integer('disable_automations', { mode: 'boolean' }).notNull().default(false),
    // DEAD (2026-06-17, retired with messages URL convergence — client access
    // moved to resolveClientActor; no reads/writes). Column FROZEN (D1 cannot
    // drop columns); kept only to preserve the table shape.
    messageToken:        text('message_token').unique('idx_inspections_msg_token'),
    templateSnapshot:    text('template_snapshot', { mode: 'json' }),
    templateSnapshotVersion: integer('template_snapshot_version').default(1),
    reportThemeOverride: text('report_theme_override', { enum: ['modern', 'classic', 'minimal'] }),
    // Track H (IA-7) — per-inspection override of the tenant's
    // require_defect_fields default; NULL = inherit.
    requireDefectFieldsOverride: text('require_defect_fields_override', { enum: ['none', 'location', 'trade', 'both'] }),
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
    // #119 — re-inspection linkage (app-layer refs, no DB FK per Schema Rules).
    // source = the baseline this re-inspection carried from (original OR a prior
    // re-inspection). root = the original at the chain root (grouping). round =
    // creation order among re-inspections sharing root. All NULL on originals.
    sourceInspectionId: text('source_inspection_id'),
    rootInspectionId:   text('root_inspection_id'),
    reinspectionRound:  integer('reinspection_round'),
}, (t) => [
    index('idx_inspections_tenant').on(t.tenantId),
    index('idx_inspections_request').on(t.requestId),
    index('idx_inspections_inspector').on(t.inspectorId),
    index('idx_inspections_agent').on(t.referredByAgentId),
    index('idx_inspections_tenant_status').on(t.tenantId, t.status),
    index('idx_inspections_tenant_date').on(t.tenantId, t.date),
    index('idx_inspections_tenant_client_email').on(t.tenantId, t.clientEmail),
    index('idx_inspections_inspector_date').on(t.inspectorId, t.date),
    index('idx_inspections_root').on(t.rootInspectionId),
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
    totalAmount:      integer('total_amount_cents').notNull().default(0),
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

// -- DEAD (2026-06-07, Track I-a): superseded by agreement_signers under the
// agreement_requests envelope. No reads or writes remain except tenant-purge /
// erase-client-data deletes. Do not extend.
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
    isSeed:    integer('is_seed', { mode: 'boolean' }).notNull().default(false),
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
    // Plan 7 — video walk-through. A pool row is a photo (default) or a video.
    // Video rows keep r2Key/url = '' (Cloudflare Stream owns the bytes) and set
    // streamUid; existing photo rows backfill to 'photo' via the column default.
    mediaType:     text('media_type', { enum: ['photo', 'video'] }).notNull().default('photo'),
    // Cloudflare Stream UID for video rows; NULL for photos.
    streamUid:     text('stream_uid'),
    // Poster timestamp as a fraction of duration (0..1); NULL for photos.
    posterPct:     real('poster_pct'),
    // Video duration in seconds (cached from Stream for the thumb badge); NULL for photos.
    durationSec:   integer('duration_sec'),
}, (t) => [
    index('idx_media_pool_tenant').on(t.tenantId),
    index('idx_media_pool_inspection').on(t.inspectionId),
]);

// Bookkeeping for the background orphaned-media GC (Q8). Each row records the
// first time an R2 object under an inspection prefix was observed unreferenced;
// the sweep deletes it only once that age exceeds the grace window.
export const orphanedMedia = sqliteTable('orphaned_media', {
    id:           text('id').primaryKey(),
    tenantId:     text('tenant_id').notNull(),
    inspectionId: text('inspection_id').notNull(),
    r2Key:        text('r2_key').notNull(),
    firstSeenAt:  integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_orphaned_media_key').on(t.tenantId, t.r2Key),
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

// DB-8 — assignment link table replacing JSON helper_inspector_ids for
// QUERYING. inspections.inspectorId/leadInspectorId/helperInspectorIds stay
// canonical for existing reads; this table is double-written on every
// assignment change and is the query face for "which inspections does user X
// work on a given day" (tenant slot aggregation, conflict detection, future
// per-inspector metrics). App-layer integrity — no DB FKs (Schema Rules).
export const inspectionInspectors = sqliteTable('inspection_inspectors', {
    inspectionId: text('inspection_id').notNull(),
    userId:       text('user_id').notNull(),
    tenantId:     text('tenant_id').notNull(),
    role:         text('role', { enum: ['lead', 'helper'] }).notNull().default('lead'),
    createdAt:    integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    primaryKey({ columns: [t.inspectionId, t.userId] }),
    index('idx_insp_inspectors_tenant_user').on(t.tenantId, t.userId),
    index('idx_insp_inspectors_user').on(t.userId),
]);

// IA-26 — inspector x service qualification (Spectora "Service Limitations"
// equivalent). ZERO rows for a service = every staff member is qualified
// (the MVP default); adding rows restricts that service to the listed users.
export const serviceInspectors = sqliteTable('service_inspectors', {
    serviceId: text('service_id').notNull(),
    userId:    text('user_id').notNull(),
    tenantId:  text('tenant_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    primaryKey({ columns: [t.serviceId, t.userId] }),
    index('idx_service_inspectors_tenant').on(t.tenantId),
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
    // DB-9 — duplicate weekly windows were silently accepted; dedup'd in the
    // 0016 migration before this index lands.
    uniqueIndex('idx_availability_window_unique').on(t.inspectorId, t.dayOfWeek, t.startTime),
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
    // DB-9 — contradictory same-day rows policy: at most ONE blocking
    // (is_available = 0) override per inspector per date. A blocking row wins
    // over recurring windows (see BookingService slot computation); multiple
    // is_available = 1 rows remain allowed (they add extra windows).
    uniqueIndex('idx_avail_overrides_block_unique').on(t.inspectorId, t.date)
        .where(sql`is_available = 0`),
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
    // Comments-repair fold (2026-06-12): deficiency comments carry repair fields.
    // Intended for rating_bucket='defect'; enforced in UI/validation, not DDL.
    repairSummary:     text('repair_summary'),
    estimateMinCents:  integer('estimate_min_cents'),
    estimateMaxCents:  integer('estimate_max_cents'),
    // Soft ref → contractor_types.id (no DB FK per schema rules). Stale ref acceptable.
    recommendedContractorTypeId: text('recommended_contractor_type_id'),
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
    // Track I-a (#116) — immutable content snapshot pinned at envelope creation.
    // Public sign page + checkout + verifier + signed.pdf ALL render this, never
    // the live template. NULL only on pre-feature signed envelopes (verifier
    // shows a "snapshot predates this feature" notice).
    contentSnapshot: text('content_snapshot'),
    contentHash:     text('content_hash'),                // SHA-256 hex of contentSnapshot
    completionPolicy: text('completion_policy', { enum: ['all', 'one'] }).notNull().default('all'),
    tokenHash:       text('token_hash'),                  // lazy hash upgrade of legacy plaintext `token`
    // Track I-a GDPR (spec §7) — final-destruction marker. NULL while the signed
    // evidence is within its retention window; set to the sweep timestamp when the
    // daily retention sweep destroys signature_base64 past the window. Distinct
    // from `status` (which stays the truthful 'signed' — the agreement WAS signed
    // and the esign_audit_logs chain still attests it); this is the idempotency
    // guard so a re-run skips already-purged rows. No PII.
    purgedAt:        integer('purged_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
    uniqueIndex('idx_agreement_requests_verify_token').on(t.verificationToken),
    index('idx_agreement_requests_tenant').on(t.tenantId),
    index('idx_agreement_requests_inspection').on(t.inspectionId),
    uniqueIndex('idx_agreement_requests_token_hash').on(t.tokenHash),
]);

// Track I-a (#117) — 1:N signer records under an agreement_requests envelope.
// App-layer refs only (no DB FKs per Schema Rules). Signer tokens are tier-2
// hash-at-rest: token_hash for lookup, token_enc (KEK-sealed plaintext) for
// server-side link reconstruction (gate CTA / reminders / Copy link).
export const agreementSigners = sqliteTable('agreement_signers', {
    id:                 text('id').primaryKey(),
    tenantId:           text('tenant_id').notNull(),     // → tenants.id (app-layer; FK intentionally omitted per Schema Rules)
    requestId:          text('request_id').notNull(),     // → agreement_requests.id (app-layer)
    name:               text('name').notNull(),
    email:              text('email').notNull(),
    role:               text('role', { enum: ['client', 'co_client', 'agent', 'other'] }).notNull().default('client'),
    contactId:          text('contact_id'),               // → contacts.id (app-layer, optional)
    tokenHash:          text('token_hash'),               // SHA-256 hex; NULL on backfilled rows until first link build
    tokenEnc:           text('token_enc'),                // 't1:iv:cipher' sealed plaintext (config-crypto sealToken)
    status:             text('status', { enum: ['pending', 'sent', 'viewed', 'signed', 'declined', 'expired'] }).notNull().default('pending'),
    signatureBase64:    text('signature_base64'),
    signedAt:           integer('signed_at', { mode: 'timestamp_ms' }),
    viewedAt:           integer('viewed_at', { mode: 'timestamp_ms' }),
    ipAddress:          text('ip_address'),
    userAgent:          text('user_agent'),
    channel:            text('channel', { enum: ['remote', 'in_person'] }), // set at sign time
    onBehalfOf:         text('on_behalf_of'),             // client name an authorized agent signs for
    onBehalfDisclaimer: text('on_behalf_disclaimer'),     // disclaimer text snapshot shown at sign time
    lastRemindedAt:     integer('last_reminded_at', { mode: 'timestamp_ms' }),
    createdAt:          integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_agreement_signers_tenant_request').on(t.tenantId, t.requestId),
    uniqueIndex('idx_agreement_signers_request_email').on(t.requestId, t.email),
    uniqueIndex('idx_agreement_signers_token_hash').on(t.tokenHash),
]);

export const services = sqliteTable('services', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    description: text('description'),
    price: integer('price_cents').notNull(),
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
    priceOverride: integer('price_override_cents'),
    nameSnapshot: text('name_snapshot').notNull(),
    priceSnapshot: integer('price_snapshot_cents').notNull(),
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
            'agreement.signer_signed',
            'agreement.viewed', 'agreement.declined', 'agreement.expired',
            'event.created', 'event.completed',
            // Track J (D7) — the one time-relative trigger. Cron-fired by
            // AutomationService.enqueueReminders(); delayMinutes is the lead
            // time BEFORE inspections.date (not a post-event delay).
            'inspection.reminder',
        ],
    }).notNull(),
    recipient: text('recipient', {
        enum: ['client', 'buying_agent', 'selling_agent', 'inspector', 'all'],
    }).notNull(),
    delayMinutes: integer('delay_minutes').notNull().default(0),
    subjectTemplate: text('subject_template').notNull(),
    bodyTemplate: text('body_template').notNull(),
    // Track J (D2) — send-time gates, JSON: { requirePaid?: bool, requireSigned?: bool, serviceIds?: string[] }.
    // null = no gates. Evaluated in flush() at delivery, NOT at trigger time.
    conditions: text('conditions'),
    // Track L (D2) — enabled delivery channels, JSON string[] e.g. '["email","sms"]'.
    // A firing emits one automation_logs row per channel. Default email-only.
    channels: text('channels').notNull().default('["email"]'),
    // Track L (D2) — plain-text SMS template (no HTML, no subject). Null until SMS enabled.
    smsBody: text('sms_body'),
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
    // Track L — holds the email address for email logs, the E.164 phone for sms logs.
    recipient: text('recipient').notNull(),   // RENAMED from recipient_email (0025)
    // Track L — the log's own delivery channel (a multi-channel rule emits one log each).
    channel: text('channel', { enum: ['email', 'sms'] }).notNull().default('email'),
    sendAt: text('send_at').notNull(),
    deliveredAt: text('delivered_at'),
    status: text('status', { enum: ['pending', 'sent', 'failed', 'skipped'] }).notNull().default('pending'),
    error: text('error'),
    eventId: text('event_id'),
}, (t) => [
    index('idx_automation_logs_pending').on(t.tenantId, t.status, t.sendAt),
    index('idx_automation_logs_insp').on(t.inspectionId),
    // DB-9 — idempotency: one log row per (automation, inspection, event). Guards
    // against retry double-sends. Partial (event_id present) so legacy rows that
    // predate event-id stamping aren't forced unique on a NULL key.
    uniqueIndex('uq_automation_logs_event')
        .on(t.automationId, t.inspectionId, t.eventId)
        .where(sql`event_id IS NOT NULL`),
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

// Settings + Library IA — tenant-defined inspection subtypes layered on the
// platform property subtypes (Office/Retail/...). `basedOn` is a plain-string
// soft ref to a platform subtype slug (no DB FK per Schema Rules). New table:
// app-layer tenant filtering only, no `.references()`.
export const inspectionTypes = sqliteTable('inspection_types', {
    id:          text('id').primaryKey(),
    tenantId:    text('tenant_id').notNull(),
    name:        text('name').notNull(),
    basedOn:     text('based_on'),
    description: text('description'),
    enabled:     integer('enabled', { mode: 'boolean' }).notNull().default(true),
    sortOrder:   integer('sort_order').notNull().default(0),
    createdAt:   integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    uniqueIndex('idx_inspection_types_tenant_name').on(t.tenantId, t.name),
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
    tokenHash:     text('token_hash'),
    createdAt:     integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
    index('idx_concierge_tokens_expiry').on(t.expiresAt),
    uniqueIndex('idx_concierge_confirm_token_hash').on(t.tokenHash),
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
