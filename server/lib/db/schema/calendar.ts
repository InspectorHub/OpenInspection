import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

/** Per-inspector calendar provider connection (Google now; Microsoft/Apple-ready). see #199 */
export const calendarConnections = sqliteTable('calendar_connections', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    provider: text('provider', { enum: ['google', 'microsoft', 'apple'] }).notNull(),
    authType: text('auth_type', { enum: ['oauth', 'caldav'] }).notNull(),
    /** v2 envelope blob (AES-GCM under per-tenant DEK). OAuth or CalDAV JSON inside. */
    credentialsEnc: text('credentials_enc').notNull(),
    /** Wrapped DEK for credentials_enc (k1:… envelope). Paired column like tenant_configs.dek_enc. */
    credentialsDekEnc: text('credentials_dek_enc').notNull(),
    capabilities: text('capabilities', { enum: ['availability_read', 'events_read_write'] }).notNull(),
    calendarId: text('calendar_id').notNull(),
    connectedAt: integer('connected_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    uniqueIndex('uq_calendar_connections_user_provider').on(t.userId, t.provider),
    index('idx_calendar_connections_tenant_user').on(t.tenantId, t.userId),
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
