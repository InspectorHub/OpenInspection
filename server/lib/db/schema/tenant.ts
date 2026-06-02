import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const tenants = sqliteTable('tenants', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    subdomain: text('subdomain').unique().notNull(),
    tier: text('tier').notNull().default('free'),
    stripeConnectAccountId: text('stripe_connect_account_id'),
    status: text('status').notNull().default('pending'),
    maxUsers: integer('max_users').notNull().default(5),
    deploymentMode: text('deployment_mode').notNull().default('shared'), // shared, silo
    // Design System 0520 subsystem E P8 — optional InterNACHI inspector
    // certification number, rendered in the TeamCredit report footer.
    nachiNumber: text('nachi_number'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const users = sqliteTable('users', {
    id: text('id').primaryKey(),
    // Agent Accounts A1 — nullable: NULL only when role='agent' (global account
    // accessing multiple tenants via agent_tenant_links). Inspector / owner /
    // admin accounts still always carry a tenant_id.
    tenantId: text('tenant_id').references(() => tenants.id),
    // After migration 0072, UNIQUE moved to (tenant_id, email) via the
    // `users_tenant_email_unique` index. A portal identity that belongs
    // to multiple workspaces now has one row per workspace, each scoped
    // to that workspace's tenant_id, sharing the same email. Per-tenant
    // uniqueness is still enforced; globally a duplicate email is fine.
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name'),
    phone: text('phone'),
    licenseNumber: text('license_number'),
    // Booking #7 Sprint C-1 — public inspector profile fields, all nullable so
    // the editorial profile page can render gracefully when an inspector hasn't
    // completed their profile yet. `serviceAreas` stores a JSON array of
    // {city, state, zip} objects; parsed/validated in UserService.getProfileBySlug.
    photoUrl: text('photo_url'),
    // Spec 5H D2 — saved signature used for auto-sign on publish + Settings prefill.
    defaultSignatureBase64: text('default_signature_base64'),
    bio: text('bio'),
    serviceAreas: text('service_areas'),
    // Booking #7 Sprint A — per-tenant unique inspector slug used for /book/<slug>.
    // Nullable until the inspector picks one. Per-tenant uniqueness enforced via
    // partial index `idx_users_slug_per_tenant` (migrations/0052_inspector_slug.sql).
    slug: text('slug'),
    role: text('role').notNull().default('admin'),
    googleRefreshToken: text('google_refresh_token'),
    googleCalendarId: text('google_calendar_id'),
    googleAccessToken: text('google_access_token'),
    googleTokenExpiry: integer('google_token_expiry'),
    locale: text('locale'),
    onboardingState: text('onboarding_state', { mode: 'json' }).$type<Record<string, boolean>>(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    // Spec 4A — TOTP 2FA. All fields are per-user opt-in; nullable until enabled.
    totpSecret:        text('totp_secret'),
    totpEnabled:       integer('totp_enabled', { mode: 'boolean' }).notNull().default(false),
    totpRecoveryCodes: text('totp_recovery_codes'),
    totpVerifiedAt:    integer('totp_verified_at', { mode: 'timestamp' }),
    // Agent Accounts A2 — per-user notification preferences. Default ON for
    // referral + report (high signal); default OFF for paid (high noise — the
    // inspector forwards the receipt manually if the agent wants visibility).
    // Read by EmailService.sendNewReferral / sendReportReady / sendInvoicePaid
    // before delivery; written from /agent-settings/profile (agent-side toggles).
    notifyOnReferral: integer('notify_on_referral', { mode: 'boolean' }).notNull().default(true),
    notifyOnReport:   integer('notify_on_report',   { mode: 'boolean' }).notNull().default(true),
    notifyOnPaid:     integer('notify_on_paid',     { mode: 'boolean' }).notNull().default(false),
    // Design System 0520 subsystem B phase 1 — debounced "user last active"
    // timestamp updated by touch-last-active middleware (30s debounce window
    // per worker isolate). Powers TeamStrip "last active Nm ago" pill and the
    // soft-presence fallback when WebSocket cannot connect.
    lastActiveAt:     integer('last_active_at'),
    // Design System 0520 subsystem C phase 1 — apprentice + specialist roles.
    //   mentorId            = nullable FK → users.id; required for apprentices
    //                          (apprentice writes route to mentor's review queue)
    //   assignedSectionIds  = JSON array of section ids; non-empty restricts
    //                          a specialist's edit scope. Empty = full access
    //                          (lead / office) per canEdit() matrix.
    //   expiresAt           = guest-invite expiry; non-null means the user
    //                          was created via a guest token + auto-revokes
    //                          past this epoch.
    mentorId:             text('mentor_id'),
    assignedSectionIds:   text('assigned_section_ids').notNull().default('[]'),
    expiresAt:            integer('expires_at'),
    // Trial Sample-Data Mode spec (2026-05-20) — ICP signal captured at
    // magic-link signup. Nullable: NULL for pre-migration users and for
    // teammates who join via team invite (only the tenant owner answers
    // the role survey at signup).
    signupRole:           text('signup_role'),
    // Account soft-delete marker — set by POST /api/account/delete after
    // the user retypes their email to confirm. NULL = active. Kept rather
    // than hard-deleted so audit-linked rows remain referentially intact.
    deletedAt:            integer('deleted_at', { mode: 'timestamp' }),
}, (t) => [
    index('idx_users_deleted_at').on(t.deletedAt),
    uniqueIndex('users_tenant_email_unique').on(t.tenantId, t.email),
    index('idx_users_tenant').on(t.tenantId),
    uniqueIndex('idx_users_slug_per_tenant').on(t.tenantId, t.slug),
    index('idx_users_email').on(t.email),
]);

/**
 * Outbox for core → portal sync events (migration 0073). Append happens
 * inside the same DB write that produced the user-side mutation so the
 * event row is atomic with the change; a scheduled worker drains pending
 * rows by posting them to portal's /api/integration/from-core endpoint.
 *
 * Event payload shape is determined by `event_type`:
 *   'user.invited'           → { tenantId, email, role, name? }
 *   'user.password_changed'  → { tenantId, email, passwordHash }
 *   'user.deleted'           → { tenantId, email }
 * Portal upserts into `identities` + `memberships` and uses `id` as the
 * dedup key so retries are idempotent on the receiving side.
 */
export const syncOutbox = sqliteTable('sync_outbox', {
    id:           text('id').primaryKey(),
    eventType:    text('event_type').notNull(),
    payload:      text('payload').notNull(),
    status:       text('status').notNull().default('pending'),
    attempts:     integer('attempts').notNull().default(0),
    createdAt:    integer('created_at').notNull(),
    lastTriedAt:  integer('last_tried_at'),
    lastError:    text('last_error'),
}, (t) => [
    index('idx_sync_outbox_status_created').on(t.status, t.createdAt),
]);

// Booking #7 Sprint A — reserved/banned slug list. Seeded via migration 0052
// with the project's reserved route names (admin, api, book, login, etc.) so
// customers cannot register slugs that would shadow real URL paths.
export const slugReservations = sqliteTable('slug_reservations', {
    slug: text('slug').primaryKey(),
    reason: text('reason').notNull(),
    blockedAt: integer('blocked_at').notNull(),
});

export const tenantInvites = sqliteTable('tenant_invites', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    email: text('email').notNull(),
    role: text('role').notNull().default('inspector'),
    status: text('status').notNull().default('pending'),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    // Design System 0520 subsystem C P5 — carry apprentice mentor +
    // specialist section assignment from the InviteSeatModal into the
    // eventual users row at accept time. NULL/empty for lead/office.
    mentorId:           text('mentor_id'),
    assignedSectionIds: text('assigned_section_ids').notNull().default('[]'),
}, (t) => [
    index('idx_invites_tenant').on(t.tenantId),
]);

export const tenantConfigs = sqliteTable('tenant_configs', {
    tenantId: text('tenant_id').primaryKey().references(() => tenants.id),
    siteName: text('site_name'),
    primaryColor: text('primary_color'),
    logoUrl: text('logo_url'),
    supportEmail: text('support_email'),
    // C-10 ③-D (B-4 / A-7) — tenant transactional-email identity. `senderEmail`
    // is the From: address; `replyTo` is the Reply-To: header. Both null until
    // the workspace configures them in Settings → Communication.
    senderEmail: text('sender_email'),
    replyTo: text('reply_to'),
    billingUrl: text('billing_url'),
    gaMeasurementId: text('ga_measurement_id'),
    integrationConfig: text('integration_config'), // plaintext JSON: {appBaseUrl, turnstileSiteKey, googleClientId}
    secrets: text('secrets'),                      // AES-GCM encrypted JSON: {resendApiKey, turnstileSecretKey, geminiApiKey, googleClientSecret}
    // Secret UI化 (migration 0079) — AES-256-GCM encrypted JSON holding all
    // 14 integration API keys configurable via Settings UI. Supersedes the
    // `secrets` column which held a smaller subset. Worker env vars still
    // take precedence (backwards compat); DB secrets are the fallback.
    encryptedSecrets: text('encrypted_secrets'),
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
    // Migration 0059 — Workers Paid PDF pipeline opt-in.
    // Default 0 (OFF) — keeps the Free-plan path cost-free (window.print()
    // fallback in the viewer is unaffected). Tenants on Workers Paid flip
    // this in Settings -> Reports to enable Browser-Rendering background
    // PDF generation at publish time + the Refresh PDFs / Download PDF
    // dropdown in the report viewer.
    enablePdfPipeline: integer('enable_pdf_pipeline', { mode: 'boolean' }).notNull().default(false),
    // Spec 5H D2 — tenant-default for newly-created inspections'
    // auto_sign_on_publish flag. False by default.
    autoSignOnPublishDefault: integer('auto_sign_on_publish_default', { mode: 'boolean' }).notNull().default(false),
    // Design System 0520 subsystem C P10 — /team Defaults section toggles.
    teamModeDefault:          integer('team_mode_default',          { mode: 'boolean' }).notNull().default(false),
    apprenticeReviewRequired: integer('apprentice_review_required', { mode: 'boolean' }).notNull().default(false),
    guestInvitesEnabled:      integer('guest_invites_enabled',      { mode: 'boolean' }).notNull().default(true),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const auditLogs = sqliteTable('audit_logs', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    userId: text('user_id'),
    action: text('action').notNull(),       // e.g. 'inspection.create'
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    metadata: text('metadata', { mode: 'json' }),
    ipAddress: text('ip_address'),
    // Sprint B-3 — populated on inspector-facing events (writeAuditLogWithSlug
    // helper); NULL otherwise so the column stays signal-rich for the audit
    // dashboard's per-inspector grouping.
    inspectorSlug: text('inspector_slug'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
    index('idx_audit_tenant_created').on(t.tenantId, t.createdAt),
    index('idx_audit_entity').on(t.entityType, t.entityId),
]);

// Agent Accounts A1 — multi-to-multi link between global agent users and the
// tenants they have access to. One row per (agent_user_id, tenant_id). Created
// either by an explicit invite (POST /api/agents/invite -> accept) or by the
// same-email auto-link routine that converges contact rows with matching email.
export const agentTenantLinks = sqliteTable('agent_tenant_links', {
    id:                  text('id').primaryKey(),
    agentUserId:         text('agent_user_id').notNull().references(() => users.id),
    tenantId:            text('tenant_id').notNull().references(() => tenants.id),
    // Optional pointer to the contacts row this link was promoted from. NULL
    // when the agent self-signed-up before the inspector added them as a contact.
    inspectorContactId:  text('inspector_contact_id'),
    status:              text('status').notNull().default('active'), // pending | active | revoked
    invitedByUserId:     text('invited_by_user_id'),
    createdAt:           integer('created_at', { mode: 'timestamp' }).notNull(),
    revokedAt:           integer('revoked_at', { mode: 'timestamp' }),
}, (t) => [
    uniqueIndex('idx_agent_tenant_unique').on(t.agentUserId, t.tenantId),
    index('idx_agent_tenant_by_tenant').on(t.tenantId, t.status),
    index('idx_agent_tenant_by_agent').on(t.agentUserId, t.status),
]);

// Agent Accounts A1 — invite tokens minted by inspectors via POST /api/agents/invite.
// 7-day TTL. accepted_at flips to a timestamp once the recipient claims the invite;
// expired/used tokens are kept for audit (we don't delete them).
export const agentInvites = sqliteTable('agent_invites', {
    token:               text('token').primaryKey(),
    tenantId:            text('tenant_id').notNull().references(() => tenants.id),
    inspectorContactId:  text('inspector_contact_id'),
    email:               text('email').notNull(),
    invitedByUserId:     text('invited_by_user_id').notNull().references(() => users.id),
    expiresAt:           integer('expires_at', { mode: 'timestamp' }).notNull(),
    acceptedAt:          integer('accepted_at', { mode: 'timestamp' }),
    createdAt:           integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
    index('idx_agent_invites_email').on(t.email),
    index('idx_agent_invites_tenant').on(t.tenantId),
    index('idx_agent_invites_expiration').on(t.expiresAt),
]);

export const notifications = sqliteTable('notifications', {
    id:          text('id').primaryKey().notNull(),
    tenantId:    text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    userId:      text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    type:        text('type').notNull(),
    title:       text('title').notNull(),
    body:        text('body'),
    entityType:  text('entity_type'),
    entityId:    text('entity_id'),
    metadata:    text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    readAt:      integer('read_at', { mode: 'timestamp' }),
    archivedAt:  integer('archived_at', { mode: 'timestamp' }),
    createdAt:   integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
    index('idx_notifications_tenant_user_created').on(t.tenantId, t.userId, t.createdAt),
    index('idx_notifications_tenant_user_unread').on(t.tenantId, t.userId, t.readAt),
]);
