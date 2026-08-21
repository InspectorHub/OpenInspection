import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { tenants } from './core';
import { users } from './user';
import { SYNC_OUTBOX_STATUS, SYNC_OUTBOX_STATUSES } from '../../../status/sync-outbox-status';
import { DESTRUCTION_STATUS, DESTRUCTION_STATUSES } from '../../../status/destruction-status';

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
    // Short event name (`user.invited`). `toCloudEvent` expands it to the
    // envelope's `io.inspectorhub.<type>` and picks the `dataschema` from it.
    // Core never branches on the value; portal routes on it.
    eventType:    text('event_type').notNull(),
    // The event's `data`, stringified ONCE at append and JSON.parsed straight
    // back into the envelope at publish — never re-serialized from a re-read
    // row, so the bytes portal receives are the ones the producing write made.
    payload:      text('payload').notNull(),
    // Schema Rules: state-machine column declares its enum (type-layer only).
    status:       text('status', { enum: [...SYNC_OUTBOX_STATUSES] }).notNull().default(SYNC_OUTBOX_STATUS.PENDING),
    attempts:     integer('attempts').notNull().default(0),
    createdAt:    integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastTriedAt:  integer('last_tried_at', { mode: 'timestamp_ms' }),
    // Written only by the DLQ writeback (`markFailedFromDlq`, capped at 1000
    // chars) and cleared again on publish and on redrive. NULL never means
    // "never failed" — it means "not failed now"; `attempts` is the durable count.
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
    // NO READER FOUND. Both lookups (`UserService.checkSlug`, `api/public-slug.ts`)
    // only test that a row EXISTS and return their own 'reserved' literal; the
    // latter selects `slug` alone. Operator-facing note on a hand-seeded row.
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
    // When destruction was INITIATED. The row is written before the cascade, not
    // after — see `status`.
    destroyedAt: integer('destroyed_at', { mode: 'timestamp_ms' }).notNull(),
    // Written BEFORE the D1/R2/KV cascade as 'started', updated to 'completed'
    // with the real counts once every step has run.
    //
    // The evidence has to be able to survive the thing it is evidence of. Written
    // last, it was lost by exactly the failures worth recording: a row could be
    // destroyed with no proof it ever happened, and the only trace was a
    // `logger.error` on a platform whose logs are measured in days against an
    // audit window measured in years. Written first, a crash mid-purge leaves
    // 'started' — which is the auditable fact, and an alert rather than silence.
    //
    // Defaults to 'completed' so rows written before this column existed keep
    // meaning what they meant: they were only ever inserted after the cascade.
    status: text('status', { enum: DESTRUCTION_STATUSES }).notNull().default(DESTRUCTION_STATUS.COMPLETED),
    // Null while 'started'. The gap between this and `destroyed_at` is how long
    // the purge took; its absence is how you find one that never finished.
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    // ── Measurement universe (appended at table end for D1 rebuild safety) ──
    //
    // `status` answers "did the purge finish?". Nothing here answered "finish
    // WHAT?" — and a certification that cites a record without knowing its
    // scope claims more than the record supports. A row written before
    // non-database stores were reachable is generation 1, is never rewritten,
    // and legitimately fails today's scope check: it did not fail, it measured
    // less. See `lib/compliance/destruction-scope.ts`.
    recordVersion: integer('record_version').notNull().default(1),
    /** JSON array of the stores this destruction attempted. Null on generation 1. */
    storesMeasured: text('stores_measured', { mode: 'json' }).$type<string[]>(),
    /**
     * JSON object of per-store outcome — `{"durable_objects":"incomplete"}`.
     *
     * This is where a store that refused to purge is recorded, rather than in
     * `status`. That axis has two values on purpose (see the comment above it),
     * and a run that finished with one unverified measurement is not the same
     * fact as a run that never finished.
     */
    storeResults: text('store_results', { mode: 'json' }).$type<Record<string, string>>(),
    /**
     * When the controller was told this destruction did not finish. Null when
     * it finished, and null when the notice could not be sent.
     *
     * Deliberately a timestamp and NOT the address. This row outlives the
     * tenant by three years, and the retention manifest sets that window on the
     * stated ground that it is non-personal — tenant id, slug and counts.
     * Storing the owner's email here would make the record certifying an
     * erasure hold an identifier of the party erased, and would falsify the
     * reason the window rests on. Who they were is answerable from the slug and
     * the account record on the portal side, where the customer relationship
     * lives; what this table has to evidence is that they were told.
     *
     * Null after a send failure is an alert, on the same principle as `status`
     * stuck at 'started': writing the timestamp regardless would produce a
     * record asserting a notification nobody received.
     */
    incompleteNotifiedAt: integer('incomplete_notified_at', { mode: 'timestamp_ms' }),
}, (t) => [
    index('idx_destruction_tenant').on(t.tenantId),
    index('idx_destruction_destroyed_at').on(t.destroyedAt),
]);

export const auditLogs = sqliteTable('audit_logs', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    userId: text('user_id'),
    action: text('action').notNull(),       // e.g. 'inspection.create'
    // The entity family the action touched ('inspection', 'widget', 'agent', …),
    // exposed as the `?entityType=` filter on the admin audit list. Survives the
    // retention anonymize, which clears the actor columns and keeps the event.
    // The COLUMN is free-form text, but the writers are not: the audit helpers
    // type it as `AuditFamily` (`server/lib/audit-families.ts`), which is the
    // closed list of spellings. Historical rows may still hold anything, and
    // one direct writer outside those helpers still does — see DIRECT_WRITERS in
    // `scripts/check-audit-registry.mjs`.
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    metadata: text('metadata', { mode: 'json' }),
    // `CF-Connecting-IP`, and only on the `auditFromContext` path — a direct
    // `writeAuditLog` caller passes its own or nothing, so NULL means "no request
    // context", not "no IP". Out of scope for a consumer erasure (staff actor),
    // but cleared by the retention sweep, whose idempotency guard reads it.
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


export const notifications = sqliteTable('notifications', {
    id:          text('id').primaryKey().notNull(),
    tenantId:    text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    userId:      text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    // The automation trigger event that produced the notice (`ctx.triggerEvent`),
    // or 'manual.send' for an operator press. No enum, because it is read as a
    // hint: `noticeTitle()` (app/lib/notice-view.ts) switches on the ones it knows
    // to give the recipient a sentence about their own inspection, and falls back
    // to the stored staff-worded `title` for anything else.
    type:        text('type').notNull(),
    title:       text('title').notNull(),
    body:        text('body'),
    // Qualifies `entity_id`. Notice headers always write 'inspection', and both
    // inboxes build the inspection link only when this reads exactly that — any
    // other value renders an unlinked row.
    entityType:  text('entity_type'),
    entityId:    text('entity_id'),
    metadata:    text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    readAt:      integer('read_at', { mode: 'timestamp_ms' }),
    archivedAt:  integer('archived_at', { mode: 'timestamp_ms' }),
    createdAt:   integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    // Communication C1 (design §3.13) — this table is the NOTICE HEADER: one
    // row per recipient x notice. The recipient is user_id XOR contact_id
    // (exactly one set — asserted in NotificationService, the DB cannot).
    // SEMANTICS NOTE: rows created before C1 all carry user_id and mean the
    // OLD thing — "tell the staff a rule fired" (one row per admin per
    // firing). They are legible as staff notices and are NOT silently
    // reinterpreted; Track B migrates that write path onto automations.
    // App-layer soft reference to contacts.id; no .references() per Schema
    // Rules. Appended at table end for D1 rebuild safety.
    contactId:    text('contact_id'),
    // The inspection a notice concerns, when it concerns one. Soft reference.
    inspectionId: text('inspection_id'),
}, (t) => [
    index('idx_notifications_tenant_user_created').on(t.tenantId, t.userId, t.createdAt),
    index('idx_notifications_tenant_user_unread').on(t.tenantId, t.userId, t.readAt),
    // C3 — the contact-recipient inbox read (agent/client Notices).
    //
    // NOT tenant-prefixed in practice, and that is the point: an agent's inbox
    // spans every workspace that has them as a contact, so it reads
    // `contact_id IN (...)` with no tenant filter at all (notice-inbox.ts).
    // The leading tenant_id costs nothing for the client read, which always
    // knows its tenant, and the contact ids are themselves tenant-scoped rows,
    // so the cross-tenant read stays correct without one.
    //
    // B2 decision, recorded because the queue asked: an AGENT is never
    // addressed on the `user_id` side, even though a global agent has a `users`
    // row. Agents are contacts in each workspace (IA-104 put the account
    // binding on `contacts.agent_user_id`), so the `(tenant_id, user_id)`
    // indexes above never have to answer for a row whose user carries no
    // tenant. The user side is staff only: owners, managers, inspectors — all
    // of whom have a tenant_id by construction.
    index('idx_notifications_tenant_contact_created').on(t.tenantId, t.contactId, t.createdAt),
]);

/** A-21 — dedup ledger for inbound portal→core commands (mirror of portal's
 *  processed_sync_events). Insert-first: a PK conflict means already applied. */
export const processedCmdEvents = sqliteTable('processed_cmd_events', {
    eventId:     text('event_id').primaryKey(),
    // The applied command's CloudEvent type, for the human reading the ledger:
    // dedup keys on `event_id` alone, and every branch (`isSubjectCmd`,
    // `replyTypeFor`) reads the live envelope rather than this column.
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
    // A FINGERPRINT, never the message: `parkedFingerprint()` allow-lists the
    // routing fields plus size + sha256 and marks the format `v:1`.
    // `cmd.tenant.update` sparsely carries an admin credential, and nothing
    // prunes this table.
    envelope:   text('envelope').notNull(),
    // Which park path wrote the row — 'parse-failed' or 'unknown-type-or-version'.
    // Either way core and portal disagree about a command shape. No production
    // reader: the row is for a human (and the cmd-* workers specs).
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
    ok:             integer('is_ok', { mode: 'boolean' }).notNull(),
    // Non-sensitive outcome summary (success blurb or provider error message).
    detail:         text('detail'),
    // User who ran the probe (JWT sub); NULL if unknown.
    testedByUserId: text('tested_by_user_id'),
    testedAt:       integer('tested_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_integration_test_tenant_target').on(t.tenantId, t.target, t.testedAt),
]);
