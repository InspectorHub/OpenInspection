import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { tenants } from './core';
import { users } from './user';

/**
 * Outbox for core → portal sync events. Append happens
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
    // Schema Rules: state-machine column declares its enum (type-layer only).
    status:       text('status', { enum: ['pending', 'published', 'failed'] }).notNull().default('pending'),
    attempts:     integer('attempts').notNull().default(0),
    createdAt:    integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastTriedAt:  integer('last_tried_at', { mode: 'timestamp_ms' }),
    lastError:    text('last_error'),
}, (t) => [
    index('idx_sync_outbox_status_created').on(t.status, t.createdAt),
]);

// Booking #7 Sprint A — reserved/banned slug list. Seeded with the project's
// reserved route names (admin, api, book, login, etc.) so customers cannot
// register slugs that would shadow real URL paths.
// FROZEN for the inspector namespace (2026-06-06, DB-12); still consulted for agent slugs.
export const slugReservations = sqliteTable('slug_reservations', {
    slug: text('slug').primaryKey(),
    reason: text('reason').notNull(),
});

// Privacy & Compliance P3 (§3.2) — durable, non-personal proof that a tenant's
// data was physically destroyed during offboarding purge. Deliberately a
// PLATFORM-LEVEL table with NO foreign key to `tenants`: the tenant row is
// deleted in the same purge pass, so an audit_logs row (NOT NULL FK ->
// tenants.id, and tenant-scoped → cascade-deleted by the purge filter) cannot
// survive. The spec text names `audit_logs`, but the spec itself documents
// (§1.5) that audit_logs is infeasible for records that must OUTLIVE the
// tenant; this standalone table — like `slug_reservations`, never listed in
// TenantPurgeService.TENANT_TABLES — is the durable equivalent. Stores only
// non-personal aggregates (id string snapshot + counts + byte totals + ts).
export const tenantDestructionRecords = sqliteTable('tenant_destruction_records', {
    id:          text('id').primaryKey(),
    tenantId:    text('tenant_id').notNull(),   // string snapshot — intentionally NOT an FK (tenant row is gone)
    tenantSlug:  text('tenant_slug'),           // non-personal label for the destroyed tenant
    rowsDeleted: integer('rows_deleted').notNull().default(0),
    r2Objects:   integer('r2_objects').notNull().default(0),
    r2Bytes:     integer('r2_bytes').notNull().default(0),
    kvKeys:      integer('kv_keys').notNull().default(0),
    destroyedAt: integer('destroyed_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_destruction_tenant').on(t.tenantId),
    index('idx_destruction_destroyed_at').on(t.destroyedAt),
]);

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
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
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
    // Schema Rules: state-machine column declares its enum (type-layer only).
    status:              text('status', { enum: ['pending', 'active', 'revoked'] }).notNull().default('active'),
    invitedByUserId:     text('invited_by_user_id'),
    createdAt:           integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt:           integer('revoked_at', { mode: 'timestamp_ms' }),
}, (t) => [
    uniqueIndex('idx_agent_tenant_unique').on(t.agentUserId, t.tenantId),
    index('idx_agent_tenant_by_tenant').on(t.tenantId, t.status),
    index('idx_agent_tenant_by_agent').on(t.agentUserId, t.status),
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
    readAt:      integer('read_at', { mode: 'timestamp_ms' }),
    archivedAt:  integer('archived_at', { mode: 'timestamp_ms' }),
    createdAt:   integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_notifications_tenant_user_created').on(t.tenantId, t.userId, t.createdAt),
    index('idx_notifications_tenant_user_unread').on(t.tenantId, t.userId, t.readAt),
]);

/** A-21 — dedup ledger for inbound portal→core commands (mirror of portal's
 *  processed_sync_events). Insert-first: a PK conflict means already applied. */
export const processedCmdEvents = sqliteTable('processed_cmd_events', {
    eventId:     text('event_id').primaryKey(),
    cmdType:     text('cmd_type').notNull(),
    // Epoch ms — same convention as sync_outbox.created_at.
    processedAt: integer('processed_at', { mode: 'timestamp_ms' }).notNull(),
});

/** A-21 — parking lot for inbound command envelopes this build cannot apply
 *  (unknown type/dataschema = deploy skew, or parse failure). Park + ack,
 *  never 400/retry — same tolerant-reader contract as portal's
 *  parked_sync_events. */
export const parkedCmdEvents = sqliteTable('parked_cmd_events', {
    id:         text('id').primaryKey(),
    envelope:   text('envelope').notNull(),
    reason:     text('reason').notNull(),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_parked_cmd_events_received_at').on(t.receivedAt),
]);

/**
 * Settings "Test connection" history. Each on-demand provider probe (SMS,
 * email, Stripe, Gemini) appends one row so the settings panels can show the
 * LAST tested time + outcome without re-probing on every page load — and a
 * short recent history (the helper prunes to the newest N per (tenant, target)).
 *
 * `detail` carries a human-readable, NON-SENSITIVE summary (success blurb or
 * the provider's rejection message) — never a key, token, or full response.
 * No FK (Schema Rules): tenant scope is enforced by the always-present
 * `tenant_id` filter, and the row is cheap diagnostic state, not a referenced
 * parent. `tested_at` is epoch-ms per the timestamp rule.
 */
export const integrationTestResults = sqliteTable('integration_test_results', {
    id:             text('id').primaryKey(),
    tenantId:       text('tenant_id').notNull(),
    // Which integration was probed. Schema Rules: state/category column declares its enum.
    target:         text('target', { enum: ['sms', 'email', 'stripe', 'gemini'] }).notNull(),
    // Optional provider variant within a target (e.g. twilio/telnyx, resend/sendgrid/
    // postmark/mailgun). NULL for single-provider targets (stripe, gemini).
    provider:       text('provider'),
    ok:             integer('ok', { mode: 'boolean' }).notNull(),
    // Non-sensitive outcome summary (success blurb or provider error message).
    detail:         text('detail'),
    // User who ran the probe (JWT sub); NULL if unknown.
    testedByUserId: text('tested_by_user_id'),
    testedAt:       integer('tested_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_integration_test_tenant_target').on(t.tenantId, t.target, t.testedAt),
]);
