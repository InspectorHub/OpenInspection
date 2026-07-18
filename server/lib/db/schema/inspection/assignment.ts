import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { tenants, users } from '../tenant';

// DB-8 — assignment link table replacing JSON helper_inspector_ids for
// QUERYING. inspections.inspectorId/leadInspectorId/helperInspectorIds stay
// canonical for existing reads; this table is double-written on every
// assignment change and is the query face for "which inspections does user X
// work on a given day" (tenant slot aggregation, conflict detection, future
// per-inspector metrics). App-layer integrity — no DB FKs (Schema Rules).
export const inspectionInspectors = sqliteTable('inspection_inspectors', {
    inspectionId: text('inspection_id').notNull(),
    userId:       text('user_id').notNull(),
    tenantId:     text('tenant_id').notNull(),
    role:         text('role', { enum: ['lead', 'helper'] }).notNull().default('lead'),
    createdAt:    integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    primaryKey({ columns: [t.inspectionId, t.userId] }),
    index('idx_insp_inspectors_tenant_user').on(t.tenantId, t.userId),
    index('idx_insp_inspectors_user').on(t.userId),
]);

// IA-26 — inspector x service qualification (Spectora "Service Limitations"
// equivalent). ZERO rows for a service = every staff member is qualified
// (the MVP default); adding rows restricts that service to the listed users.
export const serviceInspectors = sqliteTable('service_inspectors', {
    serviceId: text('service_id').notNull(),
    userId:    text('user_id').notNull(),
    tenantId:  text('tenant_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    primaryKey({ columns: [t.serviceId, t.userId] }),
    index('idx_service_inspectors_tenant').on(t.tenantId),
]);

export const availability = sqliteTable('availability', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    inspectorId: text('inspector_id').notNull().references(() => users.id),
    dayOfWeek: integer('day_of_week').notNull(),
    // Clock time-of-day 'HH:MM' for a recurring weekly window (keyed by day_of_week) —
    // intentionally TEXT (no date, no epoch) per the Schema Rules calendar/clock exception.
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_availability_inspector').on(t.inspectorId),
    // DB-9 — duplicate weekly windows were silently accepted; dedup'd in the
    // 0016 migration before this index lands.
    uniqueIndex('idx_availability_window_unique').on(t.inspectorId, t.dayOfWeek, t.startTime),
]);

export const availabilityOverrides = sqliteTable('availability_overrides', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    inspectorId: text('inspector_id').notNull().references(() => users.id),
    date: text('date').notNull(),
    isAvailable: integer('is_available', { mode: 'boolean' }).notNull().default(false),
    startTime: text('start_time'),
    endTime: text('end_time'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    // A-polish 10 — origin of this override. NULL = manual (inspector-entered).
    // 'google' = pulled from a Google calendar sync (upserted/deleted by external_id).
    source: text('source', { enum: ['google'] }),
    // Provider event id for google-sourced rows; unique per (inspector, source).
    externalId: text('external_id'),
    // Google event transparency: 'opaque' (busy) or 'transparent' (free).
    // 'transparent' rows are kept for provenance but never mark a slot busy.
    transparency: text('transparency', { enum: ['opaque', 'transparent'] }),
}, (t) => [
    index('idx_avail_overrides_insp').on(t.inspectorId),
    // DB-9 — contradictory same-day rows policy: at most ONE blocking
    // (is_available = 0) override per inspector per date. A blocking row wins
    // over recurring windows (see BookingService slot computation); multiple
    // is_available = 1 rows remain allowed (they add extra windows).
    // A-polish 10: scoped to MANUAL rows (source IS NULL) — Google sync stores
    // many timed blocking blocks per day, keyed instead by the unique index below.
    uniqueIndex('idx_avail_overrides_block_unique').on(t.inspectorId, t.date)
        .where(sql`is_available = 0 AND source IS NULL`),
    // A-polish 10 — upsert target for the Google sync: one row per external event
    // per inspector. NULLs are distinct in SQLite, so manual rows never collide.
    uniqueIndex('uq_avail_overrides_external').on(t.inspectorId, t.source, t.externalId),
]);
