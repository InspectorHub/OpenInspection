import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { ReportLinkTtl } from '../../../report-link-ttl';
import type { CancellationPolicy } from '../../../billing/cancellation-policy';
import type { DepositPolicy } from '../../../billing/deposit-policy';

// `name` was here — the CONTAINER name, a second column for one fact that was
// allowed to diverge from `tenant_configs.company_name` and did: of 16
// production tenants, 11 matched, 1 had parted ways, 4 had no settings name at
// all. One name now, and it is company_name.
export const tenants = sqliteTable('tenants', {
    id: text('id').primaryKey(),
    slug: text('slug').unique().notNull(),
    // Commercial plan. Written ONLY by the portal command seam
    // (`portal.provider` handleTenantUpdate) — core has no UI for it, so a
    // standalone deploy stays 'free'. Never read alone: `isPaidPlan` pairs it
    // with `status` (a paid tier still trialling has not paid) to decide the
    // platform-funded capabilities — managed AI key, Stream video backend.
    tier: text('tier', { enum: ['free','pro','enterprise'] }).notNull().default('free'),
    stripeConnectAccountId: text('stripe_connect_account_id'),
    status: text('status', { enum: ['pending','active','suspended','trial'] }).notNull().default('pending'),
    maxUsers: integer('max_users').notNull().default(5),
    deploymentMode: text('deployment_mode').notNull().default('shared'), // shared, silo
    // A-21 — high-water mark of the portal→core command sequence applied to
    // this tenant (envelope `tenantseq`). The cmd consumer drops any command
    // with tenantseq <= this value (stale/reordered last-writer-wins guard).
    appliedCmdSeq: integer('applied_cmd_seq').notNull().default(0),
    // A-21 batch 2 — high-water mark of the CREDENTIAL stream (envelope
    // `credseq`). Admin credentials ride `cmd.tenant.update` sparsely, so the
    // shared tenantseq can't guard them; this independent sequence ensures a
    // stale credential never overwrites a newer one (closes the batch-1
    // residual). Commands without credseq (legacy in-flight) apply credentials
    // unguarded and do NOT advance this.
    appliedCredSeq: integer('applied_cred_seq').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const tenantConfigs = sqliteTable('tenant_configs', {
    tenantId: text('tenant_id').primaryKey().references(() => tenants.id),
    companyName: text('company_name'),
    // Tenant brand hex, validated as `#rrggbb` by the settings form. Never used
    // raw: `brandTokens()` derives the hover shades and a contrast-safe
    // foreground from it, and NULL emits no tokens at all (platform defaults
    // stand). Wraps every client-facing surface — report, invoice, checkout,
    // /book, client portal.
    primaryColor: text('primary_color'),
    logoUrl: text('logo_url'),
    supportEmail: text('support_email'),
    // Report PDF settings (2026-06-18) — print-layout chrome the tenant can
    // toggle. companyAddress is shown in the PDF footer/header block; the three
    // booleans gate footer / page-number / inspector-license rendering. Defaults
    // preserve the prior always-on behaviour.
    companyAddress: text('company_address'),
    pdfShowFooter: integer('is_pdf_footer_shown', { mode: 'boolean' }).notNull().default(true),
    pdfShowPageNumbers: integer('is_pdf_page_numbers_shown', { mode: 'boolean' }).notNull().default(true),
    pdfShowLicense: integer('is_pdf_license_shown', { mode: 'boolean' }).notNull().default(true),
    // C-10 ③-D (B-4 / A-7) — tenant transactional-email identity. `senderEmail`
    // is the From: address; `replyTo` is the Reply-To: header. Both null until
    // the workspace configures them in Settings → Communication.
    senderEmail: text('sender_email'),
    // Beats the inspector's own address even when pointOfContact='inspector'
    // (`resolveSenderIdentity`: configured replyTo ?? inspector email). Blank in
    // 'company' mode means the mail carries NO Reply-To at all, which is why the
    // communication PATCH refuses that combination outright.
    replyTo: text('reply_to'),
    // Phase 1 (B-4/A-7) — sender identity. `email_mode` switches between the
    // platform Resend account ('platform', default) and the tenant's own
    // ('own'). `sender_display_name` is the From: display name. Who client-facing
    // mail comes from (inspector vs company) is driven by `point_of_contact`.
    emailMode: text('email_mode', { enum: ['platform', 'own'] }).notNull().default('platform'),
    // Self-host video backend selection (mirrors emailMode). Default 'r2' (free).
    // 'stream' uses the worker's own STREAM binding + integrationConfig.streamCustomerSubdomain.
    // Ignored in SaaS (backend is plan-gated off tenants.tier/status).
    videoMode: text('video_mode', { enum: ['r2', 'stream'] }).notNull().default('r2'),
    // Track L (D3) — SMS sender mode, mirrors email_mode. 'platform' uses the
    // platform Twilio env; 'own' uses the tenant's three TWILIO_* secrets (only
    // when all three are present, else platform fallback — see resolve-twilio.ts).
    // 'managed_shared' / 'managed_dedicated' = platform-provisioned pool numbers
    // (TCR-registered subaccount, per-tenant or shared). 'platform' = legacy
    // first-party value; column default stays 'platform' for D1 safety (changing a
    // default needs a table rebuild). 'own'/managed modes are selected explicitly
    // (see #181 provider plan).
    smsMode: text('sms_mode', { enum: ['platform', 'own', 'managed_shared', 'managed_dedicated'] }).notNull().default('platform'),
    senderDisplayName: text('sender_display_name'),
    // 2026-06-14 — Point of Contact (Spectora parity). Single tenant-level
    // switch for who client-facing emails come from. Drives From display name
    // + reply-to (NOT the From address — that is emailMode).
    pointOfContact: text('point_of_contact', { enum: ['inspector', 'company'] }).notNull().default('company'),
    billingUrl: text('billing_url'),
    // Track J (#122) — per-company Google/Yelp/Facebook review link. The
    // "Review request" automation stays inert until this is set (fail-closed).
    reviewUrl: text('review_url'),
    // Track L — company contact phone shown in client SMS ({{company_phone}}).
    companyPhone: text('company_phone'),
    integrationConfig: text('integration_config'), // plaintext JSON: {appBaseUrl, turnstileSiteKey, googleClientId}
    // Settings-managed secrets — AES-256-GCM encrypted JSON holding all
    // 14 integration API keys configurable via Settings UI. Supersedes the
    // `secrets` column which held a smaller subset. Worker env vars still
    // take precedence (backwards compat); DB secrets are the fallback.
    secretsEnc: text('secrets_enc'),
    // Envelope encryption (2026-06-07) — the tenant's wrapped DEK
    // (`k1:iv:wrapped`, AES-GCM under the HKDF KEK from JWT_SECRET, AAD=tenantId).
    // NULL while the tenant still has a legacy un-prefixed blob (or no secrets).
    dekEnc: text('dek_enc'),
    // The ONLY credential on the public company calendar feed `/api/ics/:token`
    // (no auth, 90 days of inspections including addresses). Minted lazily as a
    // dashless UUID the first time an admin opens the calendar-links panel and
    // never rotated — rewriting it silently breaks every subscribed calendar.
    // Deliberately absent from the branding write allowlist.
    icsToken: text('ics_token'),
    // Cross-origin allowlist for the embeddable booking widget; an entry may
    // carry ONE `*` in the host (`https://*.acme.com`), and protocol/port must
    // match exactly. NULL or [] is FAIL-CLOSED — `isOriginAllowed` returns false
    // on an empty list, so the widget embeds nowhere until an origin is saved.
    // Written only by WidgetService, never through the branding allowlist.
    widgetAllowedOrigins: text('widget_allowed_origins', { mode: 'json' }).$type<string[]>(),
    // Report Style Presets — default appearance profile id (built-in: signature|meridian|terra).
    // Open-ended (Phase 2 adds tenant-authored profiles); resolveProfile falls back to 'signature'.
    defaultProfileId: text('default_profile_id').notNull().default('signature'),
    // handoff-decisions §1 — per-team attention thresholds in hours.
    // Default 72h applies uniformly to the three categories.
    attentionThresholds: text('attention_thresholds', { mode: 'json' })
        .$type<{ agreement_unsigned_h: number; invoice_overdue_h: number; report_unpublished_h: number }>()
        .notNull()
        .default(sql`'{"agreement_unsigned_h":72,"invoice_overdue_h":72,"report_unpublished_h":72}'`),
    // Workflow shortcuts PR — { cloneDefault, autoAdvanceDelayMs, pinnedTagIds }
    // Nullable; server applies hard-coded defaults when NULL.
    inspectionPrefs: text('inspection_prefs', { mode: 'json' })
        .$type<{ cloneDefault: 'rating' | 'rating_notes' | 'all'; autoAdvanceDelayMs: number; pinnedTagIds: string[]; agentRepairAccess?: 'off' | 'read' | 'readwrite'; reportLinkTtl?: ReportLinkTtl }>(),
    // `is_estimates_shown` was here. It gated a per-defect "Estimated cost"
    // badge on the published report, and by the time it was dropped it gated
    // nothing: `inspection-report.service.ts` pins the report payload's
    // `showEstimates` to `false` unconditionally, so no tenant's setting ever
    // reached a renderer. The writer additionally refused every enable. A flag
    // that cannot be turned on and is not read when it is on is not a setting.
    // Repair estimates remain the buyer's to state, not the platform's — see
    // `scripts/check-price-capability.mjs`, which still fails if a price-shaped
    // column reappears on a finding.
    // Track E1 (ITB §11, UC-ITB-07) — when true, the published report sub-nav
    // exposes a "Repair List" tab. Default OFF — opt-in for realtors who want
    // a separate punch-list view rather than the full narrative report.
    enableRepairList: integer('is_repair_list_enabled', { mode: 'boolean' }).notNull().default(false),
    // Sprint 3 S3-2 — when true, the public report viewer surfaces a
    // "Generate repair request" link that takes the customer to a print-
    // friendly export they can hand off to a contractor (or email back to
    // themselves). Defaults OFF so existing tenants opt in deliberately.
    enableCustomerRepairExport: integer('is_customer_repair_export_enabled', { mode: 'boolean' }).notNull().default(false),
    // Round-2 backlog #10 — when true, every NEW inspection inherits
    // paymentRequired = true at creation time. Per-inspection override
    // remains; Stripe webhook auto-flips paymentStatus to 'paid'.
    blockUnpaid: integer('is_unpaid_blocked', { mode: 'boolean' }).notNull().default(false),
    // Round-2 backlog #10 — when true, every NEW inspection inherits
    // agreementRequired = true at creation time.
    blockUnsignedAgreement: integer('is_unsigned_agreement_blocked', { mode: 'boolean' }).notNull().default(false),
    // Round-2 backlog G3 (Spectora §4.1, ITB UC-ITB-10) — tenant-defined
    // referral sources that extend the seven seeds (Realtor / Past Client /
    // Google Search / Facebook / Yelp / Walk-in / Other). NULL = no extras.
    customReferralSources: text('custom_referral_sources', { mode: 'json' }).$type<string[]>(),
    // Round-2 backlog #2 (Spectora §5.1 / §E.7) — per-tenant default for the
    // inspection dashboard column visibility set. JSON array of column ids
    // (see server/lib/dashboard-columns.ts for the registry). NULL means
    // "use the registry default-on set".
    dashboardColumnPrefs: text('dashboard_column_prefs', { mode: 'json' }).$type<string[]>(),
    // Agent Accounts A3 — concierge booking review mode toggle.
    // Default 0 (false) = HomeGauge-style auto-confirm: agent submits ->
    // magic-link goes to client immediately. 1 (true) = Spectora reviewer
    // mode: inspector must approve the draft before the client gets the link.
    conciergeReviewRequired: integer('is_concierge_review_required', { mode: 'boolean' }).notNull().default(false),
    // IA-26 — company-level booking page: when true the public /book/:tenant
    // wizard shows an inspector dropdown ("Allow choice of inspectors",
    // Spectora-style). Default OFF = pure auto-assign (first available).
    allowInspectorChoice: integer('is_inspector_choice_allowed', { mode: 'boolean' }).notNull().default(false),
    // Workers Paid PDF pipeline opt-in.
    // Default 0 (OFF) — keeps the Free-plan path cost-free (window.print()
    // fallback in the viewer is unaffected). Tenants on Workers Paid flip
    // this in Settings -> Reports to enable Browser-Rendering background
    // PDF generation at publish time + the Refresh PDFs / Download PDF
    // dropdown in the report viewer.
    enablePdfPipeline: integer('is_pdf_pipeline_enabled', { mode: 'boolean' }).notNull().default(false),
    // Design System 0520 subsystem C P10 — /team Defaults section toggles.
    teamModeDefault:          integer('is_team_mode_default',          { mode: 'boolean' }).notNull().default(false),
    // Track H (IA-7 / P-6②) — which defect fields the publish gate REQUIRES.
    // Tenant default; per-inspection override on inspections.require_defect_
    // fields_override (the blockUnpaid → paymentRequired inheritance pattern).
    // Default LOOSE: missing fields downgrade to yellow warnings, not blocks.
    requireDefectFields: text('require_defect_fields', { enum: ['none', 'location', 'trade', 'both'] }).notNull().default('none'),
    // Track I-a GDPR (D4) — signed-agreement retention window, in YEARS. Governs
    // the final destruction of the anonymized sealed agreement artifact + chain
    // (a Cron sweep destroys signature material on rows whose signedAt + this
    // window has elapsed). Default 6 = the UK Limitation Act simple-contract
    // limitation period (the standard e-sign-evidence retention basis).
    agreementRetentionYears: integer('agreement_retention_years').notNull().default(6),
    // #119 — configurable re-inspection status categories. JSON
    // [{ key, label, closed:boolean }]; null = use the built-in default
    // (Resolved/closed, Not resolved/open, Not inspected/open).
    reinspectionStatuses: text('reinspection_statuses'),
    // #181 — when true, the inspection editor routes reads/writes through the Yjs
    // collaborative document (Durable Object) instead of the per-field CAS path.
    // Per-tenant operator toggle; default ON (#181 Phase 5) — new tenants get collab
    // unless they explicitly opt out. The legacy CAS path stays available until
    // Tasks 14/15 retire it.
    collabEditing: integer('is_collab_editing_enabled', { mode: 'boolean' }).notNull().default(true),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    // SMS BYO provider choice — which carrier the tenant's own TWILIO_*/TELNYX_*
    // secrets belong to. NULL while not in own/managed mode.
    smsByoProvider: text('sms_byo_provider', { enum: ['twilio', 'telnyx'] }),
    // Email BYO provider choice (#195) — which transactional email provider the
    // tenant's own secrets belong to. Default 'resend' matches the platform
    // default and lets resolution logic fall through to env keys when NULL.
    // NULL while not in 'own' email mode.
    emailByoProvider: text('email_byo_provider', { enum: ['resend', 'sendgrid', 'postmark', 'mailgun'] }).notNull().default('resend'),
    // Managed SMS eligibility flag — set true by portal billing sync or a platform
    // admin to enable managed compliance for the tenant. Default false =
    // not eligible; provision routes fail closed until this is explicitly set.
    managedEligible: integer('is_managed_eligible', { mode: 'boolean' }).notNull().default(false),
    // Managed-compliance carrier choice — which ISV provider runs the tenant's
    // managed (managed_shared / managed_dedicated) compliance provisioning + cron
    // sweep + webhook reception. Distinct from `smsByoProvider` (the BYO SEND
    // provider for 'own' mode). Default 'twilio' for D1 safety; inert in
    // standalone / unconfigured SaaS (no ISV env → resolver fails closed).
    managedProvider: text('managed_provider', { enum: ['twilio', 'telnyx'] }).notNull().default('twilio'),
    // Commercial PCA Phase C — Capital Replacement Reserve Schedule (TABLE 2).
    // Opt-in (default off): ASTM baseline reports render TABLE 1 only.
    reserveScheduleEnabled: integer('is_reserve_schedule_enabled', { mode: 'boolean' }).notNull().default(false),
    // Projected term in years. Default 12 is INDUSTRY CONVENTION, not ASTM —
    // the term is user-defined (see roadmap terminology correction).
    reserveTermYears: integer('reserve_term_years').notNull().default(12),
    // Optional inflation factor in basis points (250 = 2.5%). NULL = no inflation.
    inflationRateBps: integer('inflation_rate_bps'),
    // Tenant display timezone (IANA name, e.g. 'America/New_York'). The anchor
    // for reports, reminders, and calendar events; UI display uses the user's
    // override when set (see users.timezone). Existing tenants default to 'UTC'
    // and are nudged to set it via the onboarding checklist. Appended at END of
    // the table per the D1 add-column-at-end rule (tenant_configs is FK-referenced).
    defaultTimezone: text('default_timezone').notNull().default('UTC'),
    // Public booking slot grid: open = clock-aligned starts within windows;
    // fixed = window-aligned starts (default; matches legacy 30-min fill).
    bookingSlotMode: text('booking_slot_mode', { enum: ['open', 'fixed'] }).notNull().default('fixed'),
    // Slot grid step in minutes for buildSlotGrid (15 / 30 / 60).
    bookingSlotIntervalMin: integer('booking_slot_interval_min').notNull().default(30),
    // Company holiday catalog region: NULL = catalog off (legacy behavior).
    // `US` = federal only; `US-{ST}` = federal + state (e.g. US-TX).
    holidayRegion: text('holiday_region'),
    // How public `/book` treats resolved closed dates when region is set.
    holidayPublicPolicy: text('holiday_public_policy', {
        enum: ['open', 'block', 'advisory'],
    }).notNull().default('open'),
    // How internal scheduling (wizard / reschedule) treats closed dates.
    holidayInternalPolicy: text('holiday_internal_policy', {
        enum: ['advisory', 'block'],
    }).notNull().default('advisory'),
    // Tenant default display locale (BCP-47, e.g. 'en-US', 'es-419'). Drives
    // date/time/number formatting and (later) UI language. Per-user override in
    // users.locale. Appended at table end for D1 rebuild safety.
    defaultLocale: text('default_locale').notNull().default('en-US'),
    // Tenant transaction/display currency (ISO 4217, e.g. 'USD'). Tenant-scoped
    // only (tied to billing); no per-user override.
    currency: text('currency').notNull().default('USD'),
    // IA-100 — when true, archiving a contact ALSO revokes every live report
    // link that contact still holds.
    //
    // Default OFF, which is the surprising-looking choice, so: archiving is a
    // list-management act ("stop offering this person in pickers"), and a
    // buyer's agent whose deal closed should not lose the report they were
    // legitimately given. Silently cutting access on archive would break that
    // for every tenant that archives as routine hygiene. Tenants who treat
    // archive as offboarding turn this on; either way the archive dialog now
    // states the live-link count, so nobody is deciding blind.
    // Appended at table end for D1 rebuild safety.
    archiveRevokesAccess: integer('is_archive_revoking_access', { mode: 'boolean' }).notNull().default(false),
    // Tenant Privacy / Terms for public footers + SMS/TFV filings.
    // `hosted` = OI pages at /legal/:slug/privacy|terms (optional body overrides).
    // `custom` = tenant's own website URLs (both required when custom).
    legalMode: text('legal_mode', { enum: ['hosted', 'custom'] }).notNull().default('hosted'),
    customPrivacyUrl: text('custom_privacy_url'),
    customTermsUrl: text('custom_terms_url'),
    // Optional full-page body for hosted mode; null = built-in template.
    privacyBody: text('privacy_body'),
    // Whitespace-only is stored as NULL. Every PATCH that mentions this column
    // also records a legal-version publish row (content-hash de-duped, non-fatal
    // if it fails), and THAT registry — not this row's updated_at — is the "Last
    // updated" the public /legal/:tenant/terms page shows.
    termsBody: text('terms_body'),
    // #270 — display SHAPE, independent of language. A US user wanting a
    // 24-hour clock has no locale that expresses it: en-US implies 12h, en-GB
    // implies 24h but also DD/MM and British spellings. NULL is not allowed
    // here — the tenant default is the bottom of the resolution chain.
    // Appended at END of the table per the D1 add-column-at-end rule.
    dateFormat: text('date_format', { enum: ['us', 'iso', 'eu'] }).notNull().default('us'),
    // Becomes `hourCycle` h23/h12 in the shared date formatter. `users.time_format`
    // overrides it for workspace CHROME only; inspection, report and appointment
    // times resolve from the tenant value alone, so an edit here changes the clock
    // every party reads off the same document.
    timeFormat: text('time_format', { enum: ['12h', '24h'] }).notNull().default('12h'),
    // How internal scheduling treats a DOUBLE-BOOKING — the same inspector
    // already busy at the proposed instant. Sibling of `holidayInternalPolicy`,
    // which answers the same question for a closed DAY; the two are independent
    // (a tenant may block holidays but tolerate overlaps, or the reverse).
    // `advisory` = warn and save (today's behavior everywhere, so it is the
    // default); `block` = refuse the write. Read by the reschedule endpoint and
    // by the dispatch board, which shows the conflict list either way.
    // Appended at END of the table per the D1 add-column-at-end rule.
    bookingConflictPolicy: text('booking_conflict_policy', {
        enum: ['advisory', 'block'],
    }).notNull().default('advisory'),
    // The tenant's cancellation ladder. NULL = no policy configured, which is
    // how every workspace ships: the platform charges nothing and cancellations
    // are free until the tenant says otherwise. There is no default policy and
    // no model clause — both are the tenant's, because the agreement is the
    // tenant's content and it is the agreement that governs.
    //
    // ⚠️ WRITE PATH IS LOAD-BEARING. The only legitimate writer of this column
    // is `BrandingService.updateBranding`, which refuses a fee-bearing policy
    // unless the attestation below is present AND still matches the agreement
    // it was made against. That gate compares DB state, so no Zod schema can
    // express it and no constraint enforces it — it lives in the writer.
    // `tenant_configs` has ~19 write sites across 11 files; a second writer of
    // THIS column would bypass the gate in silence and charge a fee the
    // contract may not support. Route new writes through that method, or move
    // the gate somewhere both writers can see it.
    // Appended at END of the table per the D1 add-column-at-end rule
    // (tenant_configs is FK-referenced).
    cancellationPolicy: text('cancellation_policy', { mode: 'json' }).$type<CancellationPolicy>(),
    // The tenant's confirmation that their OWN agreement contains a
    // cancellation clause covering those fees. Recorded as the agreement
    // template id plus the VERSION attested, never a bare timestamp:
    // `agreements` is multi-row per tenant with a per-row version, so a bare
    // timestamp lets a commercial template's edit void a residential
    // attestation — and, worse, lets an attestation outlive the very clause it
    // attested to. Storing id + version makes invalidation an equality check
    // instead of an event somebody has to remember to fire.
    cancellationClauseAgreementId: text('cancellation_clause_agreement_id'),
    cancellationClauseVersion: integer('cancellation_clause_version'),
    cancellationClauseAttestedAt: integer('cancellation_clause_attested_at', { mode: 'timestamp_ms' }),
    // Tier 1 of the booking deposit: what the workspace asks for up front on
    // any service that does not say otherwise. NULL = no deposit anywhere,
    // which is how every workspace ships — nothing changes for an existing
    // tenant until they opt in.
    //
    // Tier 2 is the same shape on `services`; tier 3 is
    // `inspections.deposit_required_cents` + `deposit_overridden`. The
    // arithmetic that combines them is `lib/billing/deposit-policy.ts`, and it
    // is pure precisely so the number a client is quoted and the number they
    // are charged come from one function.
    // Appended at END of the table per the D1 add-column-at-end rule
    // (tenant_configs is FK-referenced).
    depositPolicy: text('deposit_policy', { mode: 'json' }).$type<DepositPolicy>(),
    // How the server chooses WHICH qualified inspector gets an auto-assigned
    // booking. 'first_available' is the shipped behaviour (stable name sort)
    // and stays the default, so nothing changes until a workspace opts in.
    //
    // The other two can be INAPPLICABLE to a given request — `least_loaded`
    // when nothing in the ISO week is dated, `closest` when the property or
    // every candidate lacks coordinates. When that happens the server falls
    // back to first_available and RECORDS the substitution with a named reason
    // (see server/lib/booking/routing.ts). A strategy that silently degrades
    // into first_available is indistinguishable from one that works.
    bookingRoutingStrategy: text('booking_routing_strategy', {
        enum: ['first_available', 'least_loaded', 'closest'],
    }).notNull().default('first_available'),
    // Minimum hours between NOW and the start of a bookable slot. 0 (the
    // default) preserves the prior behaviour of accepting any future slot.
    bookingMinLeadHours: integer('booking_min_lead_hours').notNull().default(0),
    // Wall-clock `HH:MM` in the TENANT timezone after which today's remaining
    // slots stop being offered. NULL = no cutoff. Deliberately a civil time,
    // not an instant: "no same-day after 3pm" is a statement about the office
    // clock and must survive DST without anyone editing it.
    bookingSameDayCutoffTime: text('booking_same_day_cutoff_time'),
    // Coordinates of `company_address`, resolved ONCE through the Places
    // details path when an admin saves the address. They are the default
    // service origin for every inspector who has not set their own, which is
    // what makes `closest` usable for a single-office workspace with no
    // per-inspector setup at all. NULL = never geocoded (or the lookup failed);
    // `closest` treats that as "this workspace has no anchor", not as (0,0).
    companyLat: real('company_lat'),
    // Both coordinates must be `typeof number` before `closest` anchors anything
    // — a lone lat is no anchor — and 0 is a legitimate longitude, which is why
    // the routing check is a typeof and never truthiness. Written only as a pair,
    // by the company-geocode endpoint.
    companyLng: real('company_lng'),
    companyGeocodedAt: integer('company_geocoded_at', { mode: 'timestamp_ms' }),
    // What the workspace confirmed when it saved its OWN AI provider key.
    //
    // The key and the provider account belong to the tenant, but this codebase
    // ships the client that calls the provider, so the arrangement is worth
    // recording rather than assuming. The one fact that decides how the provider
    // may treat inspection content — the SERVICE TIER of the billing project
    // behind the key — is not carried on the key and is not reported by any
    // endpoint this client calls, so the tenant's confirmation is the only
    // signal that exists. `server/lib/ai/byo-attestation.ts` holds the
    // statements and the two version constants.
    //
    // `terms_version` is the load-bearing one: provider terms change, and a
    // confirmation with no revision stamped on it cannot be read back later. It
    // is separate from `policy_version` (the revision of OUR statements) because
    // either can move without the other.
    //
    // All six are NULL together — no key has been saved through this path, or
    // the key was cleared, which withdraws the attestation with it.
    // Appended at END of the table per the D1 add-column-at-end rule
    // (tenant_configs is FK-referenced).
    aiKeyAttestationProvider: text('ai_key_attestation_provider', { enum: ['gemini'] }),
    // The arrangement attested: the tenant's OWN key, not a managed one. All six
    // are written in the same statement as `secrets_enc` by the secrets save, and
    // every one must be non-null before a BYO AI call is allowed.
    aiKeyAttestationMode: text('ai_key_attestation_mode', { enum: ['tenant_key'] }),
    // Whose provider account the key bills to — and therefore whose provider
    // terms govern the content sent to it.
    aiKeyAttestationAccountOwner: text('ai_key_attestation_account_owner', { enum: ['tenant'] }),
    // Stamped from AI_PROVIDER_TERMS_VERSION at write time. A later bump of that
    // constant does NOT invalidate stored rows — the runtime check requires the
    // column non-null and ignores its value — so re-confirmation stays a
    // deliberate pass rather than an outage caused by a one-character edit.
    aiKeyAttestationTermsVersion: text('ai_key_attestation_terms_version'),
    aiKeyAttestationAttestedAt: integer('ai_key_attestation_attested_at', { mode: 'timestamp_ms' }),
    // Stamped from AI_KEY_ATTESTATION_POLICY_VERSION — the revision of OUR
    // statements, which moves independently of the provider terms above.
    aiKeyAttestationPolicyVersion: text('ai_key_attestation_policy_version'),
    // #275 — quick-insert phrases for repair-request notes, maintained by the
    // tenant. Same shape and storage idiom as `custom_referral_sources` above.
    // NULL = never configured (seeded defaults shown); [] = the tenant removed
    // them all and wants no buttons. Collapsing the two with `?? DEFAULTS` takes
    // away the only off switch, and the defaults look intentional, so nobody
    // notices. Appended at END per the D1 add-column-at-end rule.
    repairQuickPhrases: text('repair_quick_phrases', { mode: 'json' }).$type<string[]>(),
    /**
     * The registered legal entity, as it appears on the licence — distinct
     * from `companyName`, which is the trading brand / DBA.
     *
     * NULLABLE and meant to stay that way. A sole proprietor trading under
     * their own registered name has ONE name and must not be made to type it
     * twice; NULL means "same as companyName" and the fallback lives in
     * BrandingService.getBrand so no call site carries it.
     *
     * Appears ONLY on agreements, signature certificates, the invoice "from"
     * party, and the TCPA disclosure. It is NOT what `{{company_name}}`
     * resolves to. Appended at END per the D1 add-column-at-end rule
     * (tenant_configs is FK-referenced).
     */
    legalName: text('legal_name'),
    /**
     * The last invoice number handed out for this tenant. Default 1000, so the
     * first invoice is **1001** — Jobber's convention, and the category's;
     * starting at 1 tells a homebuyer they are this company's first customer.
     *
     * A COUNTER, not a `MAX(invoice_number) + 1` scan. D1 has no interactive
     * transaction, so read-then-write races two concurrent creates onto one
     * number and `uq_invoices_tenant_number` then refuses the second invoice at
     * the point of sale. Allocation is one atomic `UPDATE … RETURNING`.
     * Appended at END per the D1 add-column-at-end rule.
     */
    invoiceSeq: integer('invoice_seq').notNull().default(1000),
    /**
     * Years a rendered report PDF is kept. `0` = indefinite, which is an
     * explicit controller instruction the platform executes rather than an
     * absence of a setting.
     *
     * The default of 7 is a disclosed PLATFORM default and is never presented
     * as a statutory requirement — review struck the "longest statutory
     * period" framing this number used to carry. The wording a customer sees,
     * and the machine-readable taxonomy that keeps the distinction from resting
     * on prose, live in `lib/compliance/report-pdf-retention.ts`.
     *
     * Appended at END per the D1 add-column-at-end rule.
     */
    reportPdfRetentionYears: integer('report_pdf_retention_years').notNull().default(7),
    /**
     * Whether this workspace counts report opens. Default FALSE.
     *
     * review B4: the legitimate-interests assessment for report-view counting
     * assigned the interest to the inspection company — a company that could
     * not enable the processing, could not disable it, and could not see that
     * it was happening. A legitimate interest may not be a mask for processing
     * its supposed beneficiary cannot decline, so the assessment did not hold
     * until this column existed.
     *
     * Default false rather than true, and that is the whole point: the
     * defensible starting position is the one where nobody is counted until
     * somebody chose it. Nothing is lost by it — no production row exists.
     *
     * Read by `shouldCountReportView`, which checks it FIRST.
     * Appended at END per the D1 add-column-at-end rule.
     */
    reportViewCountingEnabled: integer('is_report_view_counting_enabled', { mode: 'boolean' })
        .notNull().default(false),
});
