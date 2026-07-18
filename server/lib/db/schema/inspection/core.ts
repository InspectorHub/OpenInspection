import { sqliteTable, text, integer, real, blob, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
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
    addressGeocodedAt:   integer('address_geocoded_at', { mode: 'timestamp_ms' }),
    // IA-1 — the order finally captures WHO. Points at contacts.id (app-layer
    // integrity per the FK policy); the denormalized clientName/Email/Phone
    // below remain as a read cache and are double-written on create.
    clientContactId:     text('client_contact_id'),
    clientName:          text('client_name'),
    clientEmail:         text('client_email'),
    clientPhone:         text('client_phone'),
    templateId:          text('template_id').references(() => templates.id),
    // Calendar-semantic YYYY-MM-DD (inspection date, no time component) — intentionally
    // TEXT per the Schema Rules calendar-field exception, not an epoch timestamp.
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
    createdAt:           integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    // Phase 0 parity additions
    confirmedAt:         integer('confirmed_at', { mode: 'timestamp_ms' }),
    cancelReason:        text('cancel_reason'),
    cancelNotes:         text('cancel_notes'),  // Spec 3A
    paymentRequired:     integer('is_payment_required', { mode: 'boolean' }).notNull().default(false),
    agreementRequired:   integer('is_agreement_required', { mode: 'boolean' }).notNull().default(false),
    // Spec 5H D2 — when true, InspectionService.publish() auto-injects the
    // inspector's users.default_signature_base64 into inspection_results.data._inspector_signature.
    autoSignOnPublish:   integer('is_auto_sign_on_publish', { mode: 'boolean' }).notNull().default(false),
    discountCodeId:      text('discount_code_id').references(() => discountCodes.id),
    discountAmount:      integer('discount_amount_cents'),
    // Calendar-semantic YYYY-MM-DD (real-estate closing date, no time) — intentionally
    // TEXT per the Schema Rules calendar-field exception, not an epoch timestamp.
    closingDate:         text('closing_date'),
    referralSource:      text('referral_source'),
    referenceNumber:             text('reference_number'),
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
    // Commercial PCA Phase T — report tier. Meaningful only for commercial
    // inspections (NULL on residential/multi-unit). Drives which report
    // sections / cost tables / compliance modules / photo mode apply. A
    // commercial inspection defaults to 'light_commercial' (see report-tier.ts
    // resolveReportTier — "auto light, user elevates"); 'full_pca' is the
    // ASTM E2018 deliverable. See "Commercial PCA Phase T".
    reportTier:          text('report_tier', { enum: ['light_commercial', 'full_pca'] }),
    county:              text('county'),
    sellingAgentId:      text('selling_agent_id').references(() => contacts.id),
    disableAutomations:  integer('is_automations_disabled', { mode: 'boolean' }).notNull().default(false),
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
    //                          Superseded by the Yjs state vector under collab editing (#181);
    //                          column frozen — stop writes once the DO is the authority.
    teamMode:            integer('is_team_mode', { mode: 'boolean' }).notNull().default(false),
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
    // Commercial PCA Phase F — multi-unit inspection mode. 'tagged' (default,
    // Spectora-parity): the section/item checklist stays fixed and each defect
    // is optionally tagged with a location drawn from locationOptions — this
    // reuses DefectState.location + the finding key, so there is no location_tag
    // column. 'per_unit' (Phase U): every unit is a first-class inspection_units
    // row and a full sub-inspection. See the commercial-pca-report-foundation
    // design spec §3.3.
    unitInspectionMode:  text('unit_inspection_mode', { enum: ['tagged', 'per_unit'] }).notNull().default('tagged'),
    // Structured location picklist for the 'tagged' mode (floors / zones /
    // units). The inspector defines or bulk-generates it; DefectState.location
    // selects from it (free text still allowed). JSON array of labels.
    locationOptions:     text('location_options', { mode: 'json' }).$type<string[]>(),
    // Representative-sampling declaration (ASTM E2018 §4.3.4): what was sampled
    // and what was not. Consumed by the Phase S walk-through narrative; surfaced
    // (unrendered) in the report payload here. Quantities are approximate /
    // representative, never "exact" (§10.3.4).
    samplingDeclaration: text('sampling_declaration', { mode: 'json' }).$type<{
        samplingMethod: 'exhaustive' | 'representative';
        unitsTotal?: number;
        unitsInspected?: number;
        basis?: string;
    }>(),
    // Commercial PCA Phase S — editable report narrative blocks (8-key prose
    // shape; see server/lib/pca-narrative.ts). NULL = use seed defaults.
    pcaNarrative:        text('pca_narrative', { mode: 'json' }).$type<Record<string, string>>(),
    // Commercial PCA Phase S — structured Deviations-from-the-Guide store
    // (ASTM §11.4.3). S owns it; C/T/M append via appendDeviation(). NULL = none.
    deviations:          text('deviations', { mode: 'json' }).$type<{ id: string; area: string; baselineRequirement: string; deviation: string; reason: string }[]>(),
    // Commercial PCA Phase P — per-inspection photo-mode override. Null = derive
    // from the report tier (full_pca -> appendix, else inline); set = force a mode.
    // See server/lib/report-photos.ts derivePhotoMode.
    reportPhotoMode:     text('report_photo_mode', { enum: ['appendix', 'inline'] }),
    // A-polish 9b — precise scheduled instant (UTC epoch-ms), derived from the
    // booked slot + tenant tz at fulfillment via wallClockToEpochMs. inspections.date
    // remains the civil YYYY-MM-DD derived from this. NULL for legacy /
    // manually-created rows. Drives interval-overlap conflict detection, Google
    // push (Task 10), and the schedule.ics feed.
    scheduledStartMs:    integer('scheduled_start_ms', { mode: 'timestamp_ms' }),
    scheduledEndMs:      integer('scheduled_end_ms', { mode: 'timestamp_ms' }),
    // Booked duration in minutes (from the service / event type). NULL = legacy.
    durationMin:         integer('duration_min'),
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
    scheduledAt:      integer('scheduled_at', { mode: 'timestamp_ms' }).notNull(),
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
    // Authoritative Yjs CRDT state for collaborative results editing (#181). The
    // Durable Object persists Y.encodeStateAsUpdate here; `data` above is the
    // materialized JSON projection of this doc that all readers consume. Nullable:
    // inspections created before collab editing have no doc yet. This is the only
    // BLOB column in the schema.
    ydocState: blob('ydoc_state'),
    lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' }).notNull(),
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
