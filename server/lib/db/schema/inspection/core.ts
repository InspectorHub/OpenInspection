import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { tenants, users } from '../tenant';
import { contacts } from '../contact';
import { INSPECTION_STATUSES } from '../../../status/inspection-status';
import { REPORT_STATUSES } from '../../../status/report-status';
import { templates } from './template-rating';
import { discountCodes } from './services';

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
