import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const tenants = sqliteTable('tenants', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').unique().notNull(),
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
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const tenantConfigs = sqliteTable('tenant_configs', {
    tenantId: text('tenant_id').primaryKey().references(() => tenants.id),
    companyName: text('company_name'),
    primaryColor: text('primary_color'),
    logoUrl: text('logo_url'),
    supportEmail: text('support_email'),
    // Report PDF settings (2026-06-18) — print-layout chrome the tenant can
    // toggle. companyAddress is shown in the PDF footer/header block; the three
    // booleans gate footer / page-number / inspector-license rendering. Defaults
    // preserve the prior always-on behaviour.
    companyAddress: text('company_address'),
    pdfShowFooter: integer('pdf_show_footer', { mode: 'boolean' }).notNull().default(true),
    pdfShowPageNumbers: integer('pdf_show_page_numbers', { mode: 'boolean' }).notNull().default(true),
    pdfShowLicense: integer('pdf_show_license', { mode: 'boolean' }).notNull().default(true),
    // C-10 ③-D (B-4 / A-7) — tenant transactional-email identity. `senderEmail`
    // is the From: address; `replyTo` is the Reply-To: header. Both null until
    // the workspace configures them in Settings → Communication.
    senderEmail: text('sender_email'),
    replyTo: text('reply_to'),
    // Phase 1 (B-4/A-7) — sender identity. `email_mode` switches between the
    // platform Resend account ('platform', default) and the tenant's own
    // ('own'). `sender_display_name` is the From: display name; when
    // `use_inspector_from_name` is on and a send carries an inspector, that
    // inspector's name overrides the display name and their email becomes the
    // default Reply-To.
    emailMode: text('email_mode', { enum: ['platform', 'own'] }).notNull().default('platform'),
    // Self-host video backend selection (mirrors emailMode). Default 'r2' (free).
    // 'stream' uses the worker's own STREAM binding + integrationConfig.streamCustomerSubdomain.
    // Ignored in SaaS (backend is plan-gated off tenants.tier/status).
    videoMode: text('video_mode', { enum: ['r2', 'stream'] }).notNull().default('r2'),
    // Track L (D3) — SMS sender mode, mirrors email_mode. 'platform' uses the
    // platform Twilio env; 'own' uses the tenant's three TWILIO_* secrets (only
    // when all three are present, else platform fallback — see resolve-twilio.ts).
    smsMode: text('sms_mode', { enum: ['platform', 'own'] }).notNull().default('platform'),
    senderDisplayName: text('sender_display_name'),
    useInspectorFromName: integer('use_inspector_from_name', { mode: 'boolean' }).notNull().default(false),
    // 2026-06-14 — Point of Contact (Spectora parity). Single tenant-level
    // switch for who client-facing emails come from. Drives From display name
    // + reply-to (NOT the From address — that is emailMode). Replaces the
    // useInspectorFromName boolean (kept as a dead column; no longer read).
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
    icsToken: text('ics_token'),
    widgetAllowedOrigins: text('widget_allowed_origins', { mode: 'json' }).$type<string[]>(),
    reportTheme: text('report_theme', { enum: ['modern', 'classic', 'minimal'] }).notNull().default('modern'),
    // handoff-decisions §1 — per-team attention thresholds in hours.
    // Default 72h applies uniformly to the three categories.
    attentionThresholds: text('attention_thresholds', { mode: 'json' })
        .$type<{ agreement_unsigned_h: number; invoice_overdue_h: number; report_unpublished_h: number }>()
        .notNull()
        .default(sql`'{"agreement_unsigned_h":72,"invoice_overdue_h":72,"report_unpublished_h":72}'`),
    // Workflow shortcuts PR — { cloneDefault, autoAdvanceDelayMs, pinnedTagIds }
    // Nullable; server applies hard-coded defaults when NULL.
    inspectionPrefs: text('inspection_prefs', { mode: 'json' })
        .$type<{ cloneDefault: 'rating' | 'rating_notes' | 'all'; autoAdvanceDelayMs: number; pinnedTagIds: string[] }>(),
    // Sprint 2 S2-4 — when true, published reports render the per-defect
    // "Estimated cost: $X – $Y" badge.
    showEstimates: integer('show_estimates', { mode: 'boolean' }).notNull().default(false),
    // Track E1 (ITB §11, UC-ITB-07) — when true, the published report sub-nav
    // exposes a "Repair List" tab. Default OFF — opt-in for realtors who want
    // a separate punch-list view rather than the full narrative report.
    enableRepairList: integer('enable_repair_list', { mode: 'boolean' }).notNull().default(false),
    // Sprint 3 S3-2 — when true, the public report viewer surfaces a
    // "Generate repair request" link that takes the customer to a print-
    // friendly export they can hand off to a contractor (or email back to
    // themselves). Defaults OFF so existing tenants opt in deliberately.
    enableCustomerRepairExport: integer('enable_customer_repair_export', { mode: 'boolean' }).notNull().default(false),
    // Round-2 backlog #10 — when true, every NEW inspection inherits
    // paymentRequired = true at creation time. Per-inspection override
    // remains; Stripe webhook auto-flips paymentStatus to 'paid'.
    blockUnpaid: integer('block_unpaid', { mode: 'boolean' }).notNull().default(false),
    // Round-2 backlog #10 — when true, every NEW inspection inherits
    // agreementRequired = true at creation time.
    blockUnsignedAgreement: integer('block_unsigned_agreement', { mode: 'boolean' }).notNull().default(false),
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
    conciergeReviewRequired: integer('concierge_review_required', { mode: 'boolean' }).notNull().default(false),
    // IA-26 — company-level booking page: when true the public /book/:tenant
    // wizard shows an inspector dropdown ("Allow choice of inspectors",
    // Spectora-style). Default OFF = pure auto-assign (first available).
    allowInspectorChoice: integer('allow_inspector_choice', { mode: 'boolean' }).notNull().default(false),
    // Workers Paid PDF pipeline opt-in.
    // Default 0 (OFF) — keeps the Free-plan path cost-free (window.print()
    // fallback in the viewer is unaffected). Tenants on Workers Paid flip
    // this in Settings -> Reports to enable Browser-Rendering background
    // PDF generation at publish time + the Refresh PDFs / Download PDF
    // dropdown in the report viewer.
    enablePdfPipeline: integer('enable_pdf_pipeline', { mode: 'boolean' }).notNull().default(false),
    // Design System 0520 subsystem C P10 — /team Defaults section toggles.
    teamModeDefault:          integer('team_mode_default',          { mode: 'boolean' }).notNull().default(false),
    // DEAD (2026-06-13, apprentice subsystem removed) — no reads/writes
    apprenticeReviewRequired: integer('apprentice_review_required', { mode: 'boolean' }).notNull().default(false),
    // DEAD (2026-06-13, guest removal) — no reads/writes
    guestInvitesEnabled:      integer('guest_invites_enabled',      { mode: 'boolean' }).notNull().default(true),
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
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Email-template Phase 3 — sparse per-tenant overrides for transactional
 * email templates. One row per (tenant, trigger) the tenant has customized;
 * absence = pure registry default. `subject`/`blocks` null = use default for
 * that field; `blocks` is a partial { blockKey: value } map (only overridden
 * keys). `enabled=false` stops that email being sent (ignored for `required`
 * templates, which the API refuses to disable).
 */
export const emailTemplates = sqliteTable('email_templates', {
    tenantId:  text('tenant_id').notNull().references(() => tenants.id),
    trigger:   text('trigger').notNull(),
    subject:   text('subject'),
    blocks:    text('blocks', { mode: 'json' }).$type<Record<string, string>>(),
    enabled:   integer('enabled', { mode: 'boolean' }).notNull().default(true),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.trigger] }),
}));
