import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { ROLES } from '../../../auth/roles';
import { tenants } from './core';

export const users = sqliteTable('users', {
    id: text('id').primaryKey(),
    // Agent Accounts A1 — nullable: NULL only when role='agent' (global account
    // accessing multiple tenants via agent_tenant_links). Inspector / owner /
    // admin accounts still always carry a tenant_id.
    tenantId: text('tenant_id').references(() => tenants.id),
    // UNIQUE is on (tenant_id, email) (the `users_tenant_email_unique`
    // composite index), not global on email. A portal identity that belongs
    // to multiple workspaces now has one row per workspace, each scoped
    // to that workspace's tenant_id, sharing the same email. Per-tenant
    // uniqueness is still enforced; globally a duplicate email is fine.
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name'),
    phone: text('phone'),
    licenseNumber: text('license_number'),
    // Inspector avatar shown on the public company booking page (/book/:tenant).
    photoUrl: text('photo_url'),
    // Spec 5H D2 — saved signature used for auto-sign on publish + Settings prefill.
    defaultSignatureBase64: text('default_signature_base64'),
    // 2026-06-14 — per-inspector opt-in for the business-card email footer
    // (independent of Point of Contact). Default true preserves prior behaviour.
    signatureEnabled: integer('is_signature_enabled', { mode: 'boolean' }).notNull().default(true),
    // FROZEN for inspectors (2026-06-06, DB-12/IA-26): the per-inspector
    // booking slug is retired — /book/:tenant is the canonical public entry
    // and no inspector-facing route writes this column anymore. Live READERS
    // that still resolve inspectors by slug: the ICS calendar feed
    // (ics.service.ts), audit records (lib/audit.ts), and the legacy
    // /book/:tenant/:slug profile endpoint behind the deep-link redirect —
    // check those before any reuse. Global AGENT slugs (tenant_id IS NULL,
    // role='agent') still use this column actively — do not repurpose.
    slug: text('slug'),
    // DDL default is FROZEN (D1 cannot alter column defaults without a
    // table rebuild and users is FK-referenced). Every insert path MUST pass an
    // explicit role — audited 2026-06-05; enforced by review, not DDL.
    role: text('role', { enum: ROLES }).notNull().default('manager'),
    onboardingState: text('onboarding_state', { mode: 'json' }).$type<Record<string, boolean>>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    // Spec 4A — TOTP 2FA. All fields are per-user opt-in; nullable until enabled.
    totpSecret:        text('totp_secret'),
    totpEnabled:       integer('is_totp_enabled', { mode: 'boolean' }).notNull().default(false),
    totpRecoveryCodes: text('totp_recovery_codes'),
    totpVerifiedAt:    integer('totp_verified_at', { mode: 'timestamp_ms' }),
    // Agent Accounts A2 — per-user notification preferences. Default ON for
    // referral + report (high signal); default OFF for paid (high noise — the
    // inspector forwards the receipt manually if the agent wants visibility).
    // Read by EmailService.sendNewReferral / sendReportReady / sendInvoicePaid
    // before delivery; written from /agent-settings/profile (agent-side toggles).
    notifyOnReferral: integer('is_referral_notification_enabled', { mode: 'boolean' }).notNull().default(true),
    notifyOnReport:   integer('is_report_notification_enabled',   { mode: 'boolean' }).notNull().default(true),
    notifyOnPaid:     integer('is_paid_notification_enabled',     { mode: 'boolean' }).notNull().default(false),
    // Design System 0520 subsystem B phase 1 — debounced "user last active"
    // timestamp updated by touch-last-active middleware (30s debounce window
    // per worker isolate). Powers TeamStrip "last active Nm ago" pill and the
    // soft-presence fallback when WebSocket cannot connect.
    lastActiveAt:     integer('last_active_at', { mode: 'timestamp_ms' }),
    // Design System 0520 subsystem C phase 1 — role-extension columns.
    //   mentorId            = DEAD (2026-06-13, apprentice subsystem removed).
    //                          Formerly the apprentice's mentor FK → users.id —
    //                          no reads/writes.
    //   assignedSectionIds  = DEAD (2026-06-13). Formerly: JSON array of
    //                          section ids restricting a specialist's edit
    //                          scope. Specialist scoping deferred — no reads/writes.
    //   expiresAt           = DEAD (2026-06-13, guest removal). Formerly the
    //                          guest-invite expiry epoch — no reads/writes.
    // DEAD (2026-06-13, apprentice subsystem removed) — no reads/writes
    mentorId:             text('mentor_id'),
    // DEAD (2026-06-13, guest removal / specialist deferred) — no reads/writes
    assignedSectionIds:   text('assigned_section_ids').notNull().default('[]'),
    // DEAD (2026-06-13, guest removal / specialist deferred) — no reads/writes
    expiresAt:            integer('expires_at'), // ts-lint-ok: DEAD frozen column (guest removal), no reads/writes
    // Account soft-delete marker — set by POST /api/account/delete after
    // the user retypes their email to confirm. NULL = active. Kept rather
    // than hard-deleted so audit-linked rows remain referentially intact.
    deletedAt:            integer('deleted_at', { mode: 'timestamp_ms' }),
    // Legal-links feature — set when the account was created through a public
    // form (agent signup / agent invite) while the operator had
    // TERMS_URL/PRIVACY_URL configured. JSON: {at, ip, country, termsUrl, privacyUrl}.
    // Nullable: absent for accounts created before the feature or when the
    // operator runs without configured legal docs.
    termsAccepted: text('terms_accepted', { mode: 'json' }).$type<{
        at: string; ip?: string; country?: string; termsUrl?: string; privacyUrl?: string;
    } | null>(),
    // Role permission-template overrides (2026-06-13). Nullable JSON map of the
    // four toggleable capabilities; absent/null = pure role template.
    permissionOverrides: text('permission_overrides', { mode: 'json' })
      .$type<import('../../../auth/capabilities').PermissionOverrides | null>(),
    // Per-user display-timezone override (IANA name). NULL = inherit the
    // tenant's default_timezone. Affects only this user's UI; never reports or
    // calendar events (those always anchor to the tenant tz). Appended at END.
    timezone: text('timezone'),
    // Per-user display-locale override (BCP-47). NULL = inherit the tenant's
    // default_locale. Affects only this user's UI.
    locale: text('locale'),
}, (t) => [
    index('idx_users_deleted_at').on(t.deletedAt),
    // DB-2: soft-deleted rows must not block re-inviting the same email.
    uniqueIndex('uq_users_tenant_email').on(t.tenantId, t.email).where(sql`deleted_at IS NULL`),
    index('idx_users_tenant').on(t.tenantId),
    uniqueIndex('idx_users_slug_per_tenant').on(t.tenantId, t.slug),
    index('idx_users_email').on(t.email),
]);

export const tenantInvites = sqliteTable('tenant_invites', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    email: text('email').notNull(),
    role: text('role', { enum: ROLES }).notNull().default('inspector'),
    // Schema Rules: state-machine column declares its enum (type-layer only).
    status: text('status', { enum: ['pending', 'accepted'] }).notNull().default('pending'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    // Design System 0520 subsystem C P5 — carry role-extension fields from the
    // InviteSeatDrawer into the eventual users row at accept time.
    // DEAD (2026-06-13, apprentice subsystem removed) — written on invite but
    // never replayed onto the users row; no behavior depends on it.
    mentorId:           text('mentor_id'),
    assignedSectionIds: text('assigned_section_ids').notNull().default('[]'),
    // Role permission-template overrides (2026-06-13). Mirrors
    // users.permission_overrides — carries the inviter's chosen toggle diffs
    // through accept onto the new users row. Null = pure role template.
    permissionOverrides: text('permission_overrides', { mode: 'json' })
      .$type<import('../../../auth/capabilities').PermissionOverrides | null>(),
}, (t) => [
    index('idx_invites_tenant').on(t.tenantId),
    // DB-9 — at most one OUTSTANDING invite per (tenant, email). Partial so an
    // accepted invite doesn't block re-inviting later (history is preserved).
    uniqueIndex('uq_tenant_invites_pending_email')
        .on(t.tenantId, t.email)
        .where(sql`status = 'pending'`),
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
    expiresAt:           integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    acceptedAt:          integer('accepted_at', { mode: 'timestamp_ms' }),
    createdAt:           integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_agent_invites_email').on(t.email),
    index('idx_agent_invites_tenant').on(t.tenantId),
    index('idx_agent_invites_expiration').on(t.expiresAt),
]);
