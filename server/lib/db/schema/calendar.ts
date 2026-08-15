import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

/** Per-inspector calendar provider connection (Google now; Microsoft/Apple-ready). see #199 */
export const calendarConnections = sqliteTable('calendar_connections', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    /**
     * Which system holds the calendar. `getCalendarProvider(provider)` is the
     * only dispatch: it picks the API client that reads busy time and pushes
     * events. Half of `uq_calendar_connections_user_provider`, but that index is
     * not the real rule — the connect endpoints refuse a SECOND provider for a
     * user who already holds one (see loadOpenCalendarConnection).
     */
    provider: text('provider', { enum: ['google', 'microsoft', 'apple'] }).notNull(),
    /**
     * How credentialsEnc authenticates. Written from the provider descriptor's
     * own constant (google → 'oauth', apple → 'caldav'), never chosen by a user.
     * NOTHING branches on it — dispatch keys on `provider` — and its one reader
     * echoes it back in the calendar status response.
     */
    authType: text('auth_type', { enum: ['oauth', 'caldav'] }).notNull(),
    /** v2 envelope blob (AES-GCM under per-tenant DEK). OAuth or CalDAV JSON inside. */
    credentialsEnc: text('credentials_enc').notNull(),
    /** Wrapped DEK for credentials_enc (k1:… envelope). Paired column like tenant_configs.dek_enc. */
    credentialsDekEnc: text('credentials_dek_enc').notNull(),
    /**
     * Singular despite the name: exactly ONE of the two, picked by the inspector
     * on the connect panel and mirrored by the OAuth scopes actually granted.
     * `canPushEvents()` gates every write to the remote calendar on
     * 'events_read_write', and the sync engine forwards it to listBusy, which
     * chooses the freeBusy endpoint or the events endpoint — only the latter
     * carries enough detail to import events back.
     */
    capabilities: text('capabilities', { enum: ['availability_read', 'events_read_write'] }).notNull(),
    calendarId: text('calendar_id').notNull(),
    connectedAt: integer('connected_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    /**
     * Last successful busy pull from the provider. Distinct from updatedAt,
     * which tracks writes to the connection itself (credentials, calendar id):
     * a re-auth is not a sync. NULL until the first sync succeeds. Drives the
     * sync-freshness badge on the calendar Team chips.
     */
    lastSyncAt: integer('last_sync_at', { mode: 'timestamp_ms' }),
    /**
     * Why the most recent sync attempt failed, or NULL when the last attempt
     * succeeded. Cleared on every success, so it always describes the CURRENT
     * state rather than accumulating history.
     *
     * It exists because the freshness badge cannot tell "nothing changed" from
     * "we have not been able to reach Google for three days" — both look like
     * an old lastSyncAt. A revoked token is the common case and the inspector
     * is the only person who can fix it, so the reason has to reach them.
     */
    lastSyncError: text('last_sync_error'),
}, (t) => [
    uniqueIndex('uq_calendar_connections_user_provider').on(t.userId, t.provider),
    index('idx_calendar_connections_tenant_user').on(t.tenantId, t.userId),
]);

// A-polish 10b — multi-read / single-write. The read set of Google calendars
// whose busy time is unioned for conflict-checking. The write destination stays
// calendar_connections.calendar_id. App-layer integrity (no DB FK per Schema
// Rules); Primary is always included in the effective read set.
export const calendarConnectionReadCalendars = sqliteTable('calendar_connection_read_calendars', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    connectionId: text('connection_id').notNull(),           // calendar_connections.id (app-layer)
    externalCalendarId: text('external_calendar_id').notNull(), // Google calendar id
    summary: text('summary'),                                // cached display name
    accessRole: text('access_role'),                         // owner|writer|reader|freeBusyReader
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    uniqueIndex('uq_conn_read_cal').on(t.connectionId, t.externalCalendarId),
    index('idx_conn_read_cal_tenant').on(t.tenantId, t.connectionId),
]);

/**
 * OI entity <-> provider event id. One row answers "does this OI thing already
 * exist on that person's calendar, and under which id" — so a re-push updates
 * instead of duplicating, a cancel can delete the remote copy, and an import can
 * recognise its own events and skip them.
 *
 * `user_id` is the point of the table: an external event lives in ONE person's
 * calendar, and both the update and the delete have to be issued against that
 * person's credentials. A row that cannot name the user is worse than no row —
 * it would send a DELETE to the wrong calendar.
 *
 * `entity_type` covers inspections and calendar blocks only. Inspection EVENTS
 * are deliberately absent: `inspection_events.gcal_event_id` already held that
 * mapping, and the push that wrote it sent every tenant event to whichever user
 * pressed the button without ever recording who that was — so there is no
 * `user_id` to migrate, and inventing one would make this table lie about the
 * single fact it exists to record. The events surface earns a link row when a
 * push path that knows its target user exists, not before. Two writers of one
 * fact is how the roster column diverged.
 *
 * No `.references()` per Schema Rules; the neighbouring legacy FKs on
 * `availability_overrides` are frozen, not a pattern.
 */
export const calendarExternalLinks = sqliteTable('calendar_external_links', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    /**
     * Which system `external_id` belongs to — a fact about the ROW, not about
     * whatever connection the user holds today. `deleteLink` aims the remote
     * DELETE with it, and `findEntityLink` deliberately omits it so a user who
     * reconnected under a different provider still deletes the right event.
     */
    provider: text('provider', { enum: ['google', 'microsoft', 'apple'] }).notNull(),
    /**
     * Namespaces `entity_id`, which is otherwise just a UUID: without it an
     * inspection and a calendar block could collide on the upsert key and one
     * push would overwrite the other's remote id.
     */
    entityType: text('entity_type', { enum: ['inspection', 'calendar_block'] }).notNull(),
    entityId: text('entity_id').notNull(),
    /** Provider event id (Google `event.id`). */
    externalId: text('external_id').notNull(),
    /** Provider concurrency tag when it gives one; advisory, never required. */
    etag: text('etag'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    uniqueIndex('uq_calendar_external_links_entity')
        .on(t.tenantId, t.provider, t.entityType, t.entityId),
    index('idx_calendar_external_links_user').on(t.tenantId, t.userId, t.provider),
]);

export const calendarBlocks = sqliteTable('calendar_blocks', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    /** Calendar-semantic civil date stored as YYYY-MM-DD, without a time zone. */
    date: text('date').notNull(),
    startTime: text('start_time'),
    endTime: text('end_time'),
    allDay: integer('is_all_day', { mode: 'boolean' }).notNull().default(false),
    notes: text('notes'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_calendar_blocks_tenant_user_date').on(t.tenantId, t.userId, t.date),
]);
