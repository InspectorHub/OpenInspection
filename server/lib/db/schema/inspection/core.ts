import { sqliteTable, text, integer, real, blob, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { tenants, users } from '../tenant';
import { INSPECTION_STATUSES } from '../../../status/inspection-status';
import { REPORT_STATUSES } from '../../../status/report-status';
import { CANCELLATION_REASONS } from '../../../cancellation-reason';
import { templates } from './template-rating';
import { discountCodes } from './services';

export const inspections = sqliteTable('inspections', {
    id:                  text('id').primaryKey(),
    tenantId:            text('tenant_id').notNull().references(() => tenants.id),
    inspectorId:         text('inspector_id').references(() => users.id),
    // The free-text address every surface actually shows: dashboard rows, the
    // command palette's LIKE search, ICS/calendar summaries, agreement envelopes,
    // notification templates, the report header. The address_* fields below only
    // enrich it — nothing falls back to them — so it stays NOT NULL.
    propertyAddress:     text('property_address').notNull(),
    // Spec 5D — geocoded address fields populated by Google Places Details
    // when the inspector picks an autocomplete result. All nullable so legacy
    // inspections (free-text address only) load without backfill.
    //
    // Written at intake from the wizard's Places pick, and by the public
    // booking's post-insert geocode stamp; copied verbatim onto a re-inspection.
    // The erasure manifest RETAINS the whole family under Art. 17(3)(e), which
    // is currently the only place that rules on them at all. The create path
    // coerces with `||`, so a blank text component stores NULL, never ''.
    addressPlaceId:      text('address_place_id'),
    addressStreet:       text('address_street'),   // street line only; the whole address stays in property_address
    addressCity:         text('address_city'),    // Places locality component
    addressState:        text('address_state'),   // Places admin-area-1 short form (e.g. TX)
    addressZip:          text('address_zip'),      // not the coverage input: booking eligibility matches the zip the booker submitted
    addressCounty:       text('address_county'),   // raw Places component; the strip-editable one is `county` below
    // No reader found for either: the wizard's map draws from the live Places
    // pick held in component state, not from the stored row.
    addressLat:          real('address_lat'),
    addressLng:          real('address_lng'),     // written with address_lat; likewise no reader
    addressGeocodedAt:   integer('address_geocoded_at', { mode: 'timestamp_ms' }),
    // IA-1 — WHO is captured via inspection_people (client/agent rows); see
    // schema/inspection/people.ts. The former denormalized clientContactId/
    // clientName/clientEmail/clientPhone columns were DROPPED (superseded by
    // inspection_people) — do not reintroduce them here.
    templateId:          text('template_id').references(() => templates.id),
    // Calendar-semantic YYYY-MM-DD (inspection date, no time component) — intentionally
    // TEXT per the Schema Rules calendar-field exception, not an epoch timestamp.
    date:                text('date').notNull(),
    status:              text('status', { enum: [...INSPECTION_STATUSES] }).notNull().default('requested'),
    // The report's lifecycle, tracked apart from `status` (the appointment). Every
    // anonymous surface — public report, share link, /verify, repair builder —
    // gates on isReportPublished() of this value, and only InspectionStatusService
    // moves it, each transition asserting the current value first.
    reportStatus:        text('report_status', { enum: [...REPORT_STATUSES] }).notNull().default('in_progress'),
    // Order-level payment state. Every reader tests `=== 'paid'` (publish
    // pre-flight, the report gate, automation conditions), so 'partial' behaves
    // exactly as 'unpaid' here — the finer states live on `invoices`. Voiding a
    // paid invoice resets it (invoice-payment-gate.ts).
    paymentStatus:       text('payment_status', { enum: ['unpaid','partial','paid'] }).notNull().default('unpaid'),
    // Buyer's Agent — see inspection_people (referredByAgentId column DROPPED, superseded).
    // P-4 authority chain: denormalized cache only — never reconcile back from invoice
    // or service-snapshot tiers. Use getEffectivePriceCents() (server/lib/effective-price.ts)
    // to read the authoritative price. Written by the inspection-create path as a
    // convenience snapshot; kept in sync when service lines change.
    price:               integer('price_cents').notNull().default(0),
    createdAt:           integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    // Phase 0 parity additions
    confirmedAt:         integer('confirmed_at', { mode: 'timestamp_ms' }),
    // The reason drives the cancellation ladder: `classifyCancellationReason`
    // (server/lib/cancellation-reason.ts) derives WHO ended the appointment and
    // WHAT happened from this one value, so no second column is needed and the
    // two can never disagree. Enum is type-layer only, no DDL.
    cancelReason:        text('cancel_reason', { enum: [...CANCELLATION_REASONS] }),
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
    // Free text, not an id: the Hub's Order-details dropdown offers the tenant's
    // configured list but keeps an off-list value the operator typed. /api/metrics
    // groups the trimmed non-empty values into the financial top-sources panel.
    referralSource:      text('referral_source'),
    // The TENANT's own order number, for cross-referencing their other systems —
    // we never generate it, parse it, or enforce uniqueness. Edited in Order
    // details, frozen into the publish snapshot, off by default as a list column.
    referenceNumber:             text('reference_number'),
    // Staff-private note. NOTHING WRITES IT: no request schema accepts it and no
    // UI edits it. The readers are the tenant CSV export and the public-report
    // projection, which deletes it (with `price`) before the payload reaches any
    // link holder — keep that delete if a writer ever appears.
    internalNotes:       text('internal_notes'),
    yearBuilt:           integer('year_built'),
    sqft:                integer('sqft'),
    // Plain text rather than an enum: getPropertyFacts coerces anything outside
    // basement/slab/crawlspace/other to 'other' on read, so an Estated autofill
    // value can land here without the write path having to reject it.
    foundationType:      text('foundation_type'),
    bedrooms:            integer('bedrooms'),
    // `real` because half-baths are normal (2.5). One of the six Property Facts
    // columns patched together by updatePropertyFacts; Estated autofill fills it
    // from `structure.baths`. NULL = the inspector has not entered it, and the
    // strip renders its "—" placeholder.
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
    // Media Studio (cover crop) — the crop transform applied to the SOURCE image
    // (cover_photo_id), in source-pixel coords. NULL = uncropped.
    //
    // Re-editable: re-opening the cropper starts from this rect rather than the
    // default frame (`coverCropFor()` in `CoverCropper.tsx` → react-easy-crop's
    // `initialCroppedAreaPixels`). Source-pixel coords are what makes that
    // possible — a {crop, zoom} pair only means something against one display
    // size, so it could not survive the round trip through here.
    //
    // ⚠️ The rect is only meaningful against `cover_photo_id`. Restoring it while
    // cropping a different photo frames a region of an image it was never
    // measured on, which looks deliberate and is not — hence the source-equality
    // guard, and its spec in `CoverCropper.test.ts`.
    coverCrop:           text('cover_crop', { mode: 'json' }).$type<{
        aspect: '3:2' | '16:9' | '1.91:1' | '4:3';
        orientation: 'landscape' | 'portrait';
        x: number; y: number; width: number; height: number;
    }>(),
    // Media Studio (cover crop) — R2 key of the baked cropped derivative
    // (JPEG, 2048px long edge). Report/OG/PDF read THIS when set; falls back
    // to cover_photo_id (uncropped source) otherwise.
    coverImageKey:       text('cover_image_key'),
    // Suite / unit designation of the ONE subject property ("Suite 200"). Not a
    // link to `inspection_units` and nothing to do with per-unit mode. Written
    // only by the Property Facts strip; read by the inspections CSV export and
    // the inspection read schema — the report's facts banner does not carry it.
    unit:                text('unit'),
    // Decides what the report becomes: resolveReportTier() reads it to tell
    // commercial from residential, section applicability filters on it, and the
    // editor's Property Info preset resolves only when it is 'commercial'.
    propertyType:        text('property_type'),
    // Plain text because org-custom subtypes live alongside the platform ids.
    // Meaningful only when property_type = 'commercial': it selects the editor's
    // metadata preset (`commercial:<id>`) and gates template sections through
    // applicableTo.commercialSubtypes (org ids match via their platform parent).
    commercialSubtype:   text('commercial_subtype'),
    // Commercial PCA Phase T — report tier. Meaningful only for commercial
    // inspections (NULL on residential/multi-unit). Drives which report
    // sections / cost tables / compliance modules / photo mode apply. A
    // commercial inspection defaults to 'light_commercial' (see report-tier.ts
    // resolveReportTier — "auto light, user elevates"); 'full_pca' is the
    // ASTM E2018 deliverable. See "Commercial PCA Phase T".
    reportTier:          text('report_tier', { enum: ['light_commercial', 'full_pca'] }),
    // The county as the Property Facts strip edits it — written ONLY by
    // updatePropertyFacts, never at intake. Distinct from `address_county` above,
    // which is the untouched Places component; the two can legitimately disagree.
    county:              text('county'),
    // Selling Agent — see inspection_people (sellingAgentId column DROPPED, superseded).
    disableAutomations:  integer('is_automations_disabled', { mode: 'boolean' }).notNull().default(false),
    templateSnapshot:    text('template_snapshot', { mode: 'json' }),
    templateSnapshotVersion: integer('template_snapshot_version').default(1),
    // Report Style Presets — per-inspection appearance profile override.
    // NULL = inherit template default, then tenant default, then 'signature'.
    profileOverride: text('profile_override'),
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
    // Design System 0520 M3 — TeamMode flag enabling the team UI (TeamBanner /
    // RosterPopover). WHO is on the team lives in `inspection_inspectors`, one
    // row per person with their role — the only place any reader may learn it.
    teamMode:            integer('is_team_mode', { mode: 'boolean' }).notNull().default(false),
    // #119 — re-inspection linkage (app-layer refs, no DB FK per Schema Rules).
    // source = the baseline this re-inspection carried from (original OR a prior
    // re-inspection). root = the original at the chain root (grouping). round =
    // creation order among re-inspections sharing root. All NULL on originals.
    sourceInspectionId: text('source_inspection_id'),
    rootInspectionId:   text('root_inspection_id'),
    // A re-inspection is its own ORDER, not a second report on the original.
    // It is created as a new `inspections` row carrying this round number, and
    // that is correct: it is a separate fee-bearing visit with its own
    // agreement and its own invoice. Folding it into the original order as an
    // ancillary report would put two of each behind one order id.
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
    // Report Style Presets — per-inspection field-level tweaks. NULL = inherit
    // the resolved profile. Appended at table end (FK-referenced, no mid-table
    // insert). badge_layout_override is Spec B's column, added here so the single
    // migration covers both; resolveProfile already reads it.
    badgeLayoutOverride: text('badge_layout_override', { enum: ['strip', 'inline'] }),
    reportPhotoColumns:  integer('report_photo_columns'),
    // Who sent us this job. Distinct from `referral_source`, which records the
    // CHANNEL (Google, Realtor, Past Client) and names nobody. Attribution used
    // to be inferred from whoever held the buyer_agent role, which credits a
    // stranger when a past client refers the job and gives a referring listing
    // agent nothing. Any contact may be the referrer, not only agent-kind ones.
    // App-layer soft reference to contacts.id; no FK per Schema Rules.
    // Appended at table end for D1 rebuild safety.
    referredByContactId: text('referred_by_contact_id'),
    // Manual release of the report gate for THIS inspection.
    //
    // The gate is order-wide by design: any required agreement left unsigned, or
    // payment outstanding, blocks every report on the inspection. That rule is
    // simple to explain and matches what a client thinks they bought — one job,
    // one set of paperwork — but it means an add-on's unsigned addendum can hold
    // back a report that is finished and that someone is waiting for.
    //
    // The release for that is a deliberate human action, not a finer-grained
    // gate: an owner or manager opens this one inspection and says why. Making
    // the gate itself per-report would put a service dimension on
    // `agreement_requests`, which is signed evidence with a retention rule, to
    // solve a problem a one-line override solves.
    //
    // NULL = still gated. The reason is required at the API, not by the column,
    // so existing rows do not need one.
    // Appended at table end for D1 rebuild safety.
    unlockedAt:          integer('unlocked_at', { mode: 'timestamp_ms' }),
    // users.id, app-layer soft ref; getReportGate resolves it to `name ?? email`
    // as unlockedByName for the Hub banner. Cleared with unlocked_at on re-lock.
    unlockedBy:          text('unlocked_by'),
    // Shown verbatim in that banner and nowhere else — no code branches on it.
    // A second unlock on an already-unlocked order is a no-op, so this holds the
    // FIRST reason given until someone re-locks.
    unlockReason:        text('unlock_reason'),
    // When the sold service lines were turned into `reports` rows.
    //
    // Generation runs ONCE, at the point the work is scheduled to begin, and
    // this column is what makes that true. Not at booking: a report that
    // materialises weeks early clutters the order and freezes a template the
    // tenant may still be editing. Not again afterwards either — re-running
    // would re-title and re-template documents somebody has already filled in.
    // NULL = the lines have not been turned into deliverables yet.
    // Appended at table end for D1 rebuild safety.
    reportsGeneratedAt:  integer('reports_generated_at', { mode: 'timestamp_ms' }),
    // What this ORDER was asked for up front, frozen at booking.
    //
    // A SNAPSHOT, not a policy reference. A percentage resolves against the
    // catalogue price on the day; if the tenant reprices the service next week,
    // the client still owes what they agreed to. NULL = no deposit was asked
    // for. On a multi-service booking this number lives on the PRIMARY
    // inspection and the siblings carry 0 — one deposit per order, because the
    // N-inspections shape is our own modelling choice and the money should not
    // inherit it.
    //
    // This is the amount OWED, never the amount PAID: what was actually
    // collected is `order_payments` rows with `kind = 'deposit'`. A declined
    // card leaves this set and the ledger empty, which is exactly the state the
    // tenant needs to see.
    // Appended at table end for D1 rebuild safety.
    depositRequiredCents: integer('deposit_required_cents'),
    // Tier 3 — a human set the number above, so nothing may recompute it.
    //
    // Without this flag one column has to mean two things, and a later
    // re-resolve silently overwrites the figure an operator agreed with a
    // client over the phone. Same marker the pay splits adopted, for the same
    // reason.
    // Appended at table end for D1 rebuild safety.
    depositOverridden:   integer('is_deposit_overridden', { mode: 'boolean' }).notNull().default(false),
}, (t) => [
    index('idx_inspections_request').on(t.requestId),
    index('idx_inspections_tenant_status').on(t.tenantId, t.status),
    index('idx_inspections_tenant_date').on(t.tenantId, t.date),
    index('idx_inspections_inspector_date').on(t.inspectorId, t.date),
    index('idx_inspections_root').on(t.rootInspectionId),
    // The dashboard list. It filters by tenant and orders by
    // `(created_at DESC, id DESC)` — which is also its cursor key — and until
    // this index existed NOTHING started with `created_at`, so every page load
    // sorted the tenant's whole partition in a temp B-tree. EXPLAIN QUERY PLAN
    // against a database built from the baseline: `USE TEMP B-TREE FOR ORDER
    // BY` before, nothing at all after. `id` is in the key because it is the
    // tie-break half of the cursor; with only `(tenant_id, created_at)` the
    // planner still needs a temp B-tree for the right part of the sort.
    index('idx_inspections_tenant_created').on(t.tenantId, t.createdAt, t.id),
]);

// Sprint 2 S2-2 — A single customer booking can spawn multiple inspections
// (e.g. Residential + Radon + Termite at the same address). All inspections
// in a request share the schedule + property metadata.
export const inspectionRequests = sqliteTable('inspection_requests', {
    id:               text('id').primaryKey(),
    tenantId:         text('tenant_id').notNull().references(() => tenants.id),
    clientName:       text('client_name').notNull(),
    clientEmail:      text('client_email'),
    // The one place a phone is a column of its own, which is why the DSAR
    // assembler widens its match to (email OR phone) here and on no other table.
    // Erasure NULLs it in place while the row survives (anonymize-pii.ts).
    clientPhone:      text('client_phone'),
    // Copied verbatim onto every inspection this request spawns, by both create
    // and addSubInspection — the children never read back through the request.
    // Retained through erasure alongside the inspection addresses.
    propertyAddress:  text('property_address').notNull(),
    // Resolved from the Places pick when a public booking is fulfilled, or
    // patched through the request API. Nothing branches on them: they ride the
    // request read projection out to the API/MCP contract and stop there.
    propertyCity:     text('property_city'),
    propertyState:    text('property_state'),   // filled with city/zip from the Places pick; nothing branches on it
    propertyZip:      text('property_zip'),   // not the coverage input — booking-admission uses the submitted zip
    scheduledAt:      integer('scheduled_at', { mode: 'timestamp_ms' }).notNull(),
    status:           text('status', {
        enum: ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled'],
    }).notNull().default('pending'),
    notes:            text('notes'),
    // `total_amount_cents` and `payment_status` were here, and money on a
    // request row is a tempting thing to re-add, so: both were WRITE-ONLY.
    //
    // The total was a booking-time sum of the sub-service prices whose only
    // reader was its own accumulator; no first-party client, no billing path
    // and no test ever consulted it, and it did not follow a reprice, an
    // override or an invoice, so it could not have been trusted if one had.
    // What an order costs is `getEffectivePriceCents()` — invoice, then the sum
    // of `inspection_services` snapshots, then the `inspections.price` cache.
    //
    // The payment status had no reader at all. Payment state anyone acts on
    // lives on the ORDER (`inspections.payment_status`) and in `order_payments`.
    //
    // Both were published in the OpenAPI/MCP contract, which is the only reason
    // they survived the first sweep; removing them is a contract change, taken
    // deliberately rather than a column drop.
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
    // Item id -> { rating, value, photos[], customComments, ... }, plus reserved
    // `_`-prefixed keys (`_inspector_signature`). The Durable Object writes
    // projectResults(doc) here on every persist; the photo, annotation and
    // offline-sync paths patch the same map directly, but only when no doc owns
    // it — with collab on they skip the write so the next persist cannot clobber.
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
    // The report this document belongs to. One order can now deliver several —
    // a standard report and a radon report — so the uniqueness that used to be
    // per INSPECTION is per REPORT. Nullable only so the backfill can run in
    // order; every row carries one afterwards.
    // Appended at table end for D1 rebuild safety.
    reportId:             text('report_id'),
}, (t) => [
    index('idx_results_tenant').on(t.tenantId),
    index('idx_results_inspection').on(t.inspectionId),
    // Was uq_results_inspection. A second report on one order is the whole
    // point of the reports entity; the old index made it impossible.
    uniqueIndex('uq_results_report').on(t.reportId),
]);
