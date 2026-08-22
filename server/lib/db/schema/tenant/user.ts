import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
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
    // (ics.service.ts), audit records (lib/audit.ts), and the public
    // /api/public/book/:tenant/:slug profile endpoint (still reached via the
    // company page's ?inspector=<slug> deep-link resolution) — check those
    // before any reuse. Global AGENT slugs (tenant_id IS NULL, role='agent')
    // still use this column actively — do not repurpose.
    slug: text('slug'),
    // DDL default is FROZEN (D1 cannot alter column defaults without a
    // table rebuild and users is FK-referenced). Every insert path MUST pass an
    // explicit role — audited 2026-06-05; enforced by review, not DDL.
    role: text('role', { enum: ROLES }).notNull().default('manager'),
    // Sparse map of one-time UI flags — an ABSENT key means "not done yet", so
    // a NULL column is simply a fresh account and nothing has to backfill it.
    // Written only by the three /auth profile endpoints (skip-setup → `skipped`,
    // checklist/dismiss and onboarding/flag → `checklistDismissed` /
    // `spectoraMappingSeen`, allowlisted); shipped on /auth/me and read by the
    // inspections and templates loaders to hide their prompts.
    onboardingState: text('onboarding_state', { mode: 'json' }).$type<Record<string, boolean>>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    // Spec 4A — TOTP 2FA. All fields are per-user opt-in; nullable until enabled.
    totpSecret:        text('totp_secret'),
    totpEnabled:       integer('is_totp_enabled', { mode: 'boolean' }).notNull().default(false),
    // JSON array of HASHED recovery codes — never the codes themselves, which
    // are shown once at enrollment and never recoverable. Single-use: the 2FA
    // login path rewrites the array WITHOUT the matched hash before it issues
    // the session cookie, so a failed write grants no session. Only its length
    // leaves the server, as `recoveryCodesRemaining` on /auth/me.
    totpRecoveryCodes: text('totp_recovery_codes'),
    totpVerifiedAt:    integer('totp_verified_at', { mode: 'timestamp_ms' }),
    // Agent Accounts A2 — per-user notification preferences. Default ON for
    // referral + report (high signal); default OFF for paid (high noise — the
    // inspector forwards the receipt manually if the agent wants visibility).
    // Read by EmailService.sendNewReferral / sendReportReady / sendInvoicePaid
    // before delivery; written from /agent-settings/profile (agent-side toggles).
    // Design System 0520 subsystem B phase 1 — debounced "user last active"
    // timestamp updated by touch-last-active middleware (30s debounce window
    // per worker isolate). Powers TeamStrip "last active Nm ago" pill and the
    // soft-presence fallback when WebSocket cannot connect.
    lastActiveAt:     integer('last_active_at', { mode: 'timestamp_ms' }),
    // `mentor_id`, `assigned_section_ids` and `expires_at` were here — the
    // role-extension columns of the apprentice / specialist / guest subsystems,
    // all three removed 2026-06-13. They were marked DEAD and kept, and stayed
    // dead: a grep of every production path found no reader and no writer.
    // Account soft-delete marker — set by POST /api/identities/account/delete after
    // the user retypes their email to confirm. NULL = active. Kept rather
    // than hard-deleted so audit-linked rows remain referentially intact.
    deletedAt:            integer('deleted_at', { mode: 'timestamp_ms' }),
    /**
     * The acceptance an agent gave, as evidence rather than as a link.
     *
     * `{at, version, contentHash, ip?, country?}`. The two URL fields are gone:
     * a URL records where the text WAS, not what it SAID, and the page behind it
     * can be edited so that the acceptance ends up pointing at something the
     * signer never read. Version plus content hash is the pair that survives the
     * text changing, and it is the standard every other legal artefact in this
     * repository already meets.
     *
     * Removing the URL fields costs nothing here: production holds NULL on every
     * row, so the old shape was never written. Nullable stays — a staff account
     * has no agent terms, and the null is what says so rather than an empty
     * object pretending to be an acceptance.
     */
    termsAccepted: text('terms_accepted', { mode: 'json' }).$type<{
        at: string; version: string; contentHash: string; ip?: string; country?: string;
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
    // #270 — per-user override. NULL = inherit the tenant's setting, the same
    // convention as `timezone` directly above. Governs this user's own
    // workspace chrome only; inspection/report/appointment rendering always
    // anchors to the tenant so all three parties read the same date aloud.
    dateFormat: text('date_format', { enum: ['us', 'iso', 'eu'] }),
    // Same override contract as `date_format` above, cleared by submitting an
    // empty value. `/api/session-context` ships the RAW stored value (null and
    // all) beside the tenant's; the client hook, not the server, resolves which
    // of the two wins — so nothing here is baked into a rendered document.
    timeFormat: text('time_format', { enum: ['12h', '24h'] }),
    // Where this inspector STARTS their day, for `closest` routing. NULL on
    // all three columns = inherit the company address coordinates
    // (`tenant_configs.company_lat/lng`), which is the right answer for the
    // single-office workspace and the only reason the strategy is usable
    // without per-person setup. Set = a multi-office or home-based inspector
    // whose drive does not start at the office.
    //
    // This is STAFF data, not a data subject's: it is declared in
    // ERASURE_OUT_OF_SCOPE alongside users.email / users.phone, and consumer
    // DSAR erasure never touches it (staff offboarding is a separate
    // lifecycle). Do not build a DSAR export path for it.
    //
    // Appended at END — users is FK-referenced, so a mid-table insert would
    // make drizzle rebuild the whole table.
    serviceOriginAddress: text('service_origin_address'),
    // Geocoded from the address by PUT /api/admin/booking-routing/service-origin
    // — and NULL while the address itself is set, whenever that address did not
    // geocode. That pair is deliberate: the typed address is still stored so the
    // admin can see and fix it, while `closest` treats the inspector as having
    // no origin of their own and falls back to the company coordinates.
    serviceOriginLat:     real('service_origin_lat'),
    serviceOriginLng:     real('service_origin_lng'),   // written only as a pair with _lat; a lone value is no anchor
}, (t) => [
    index('idx_users_deleted_at').on(t.deletedAt),
    // DB-2: soft-deleted rows must not block re-inviting the same email.
    uniqueIndex('uq_users_tenant_email').on(t.tenantId, t.email).where(sql`deleted_at IS NULL`),
    uniqueIndex('idx_users_slug_per_tenant').on(t.tenantId, t.slug),
    index('idx_users_email').on(t.email),
]);

export const tenantInvites = sqliteTable('tenant_invites', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    email: text('email').notNull(),
    // The role the invitee GETS: `joinTeam` copies it straight onto users.role,
    // for a brand-new row and for a reactivated soft-deleted one alike, and
    // emits it on the `user.invited` outbox event that drives portal seat sync.
    // It is the invite, not the accept form, that decides — nothing downstream
    // re-derives it. Kept identical to `users.role` by the role-enum-drift spec.
    role: text('role', { enum: ROLES }).notNull().default('inspector'),
    // Schema Rules: state-machine column declares its enum (type-layer only).
    status: text('status', { enum: ['pending', 'accepted'] }).notNull().default('pending'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    // `mentor_id` and `assigned_section_ids` were here, mirroring the columns of
    // the same name on `users` so an invite could carry them through accept.
    // They were dropped with those columns: nothing wrote them and accept never
    // replayed them.
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
