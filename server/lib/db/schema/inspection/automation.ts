import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { tenants, users } from '../tenant';
import { inspections } from './core';

export const automations = sqliteTable('automations', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    trigger: text('trigger', {
        enum: [
            'inspection.created', 'inspection.confirmed', 'inspection.cancelled',
            'report.published', 'invoice.created', 'payment.received', 'agreement.signed',
            'agreement.signer_signed',
            'agreement.viewed', 'agreement.declined', 'agreement.expired',
            'event.created', 'event.completed',
            // Track J (D7) — the one time-relative trigger. Cron-fired by
            // AutomationService.enqueueReminders(); delayMinutes is the lead
            // time BEFORE inspections.date (not a post-event delay).
            'inspection.reminder',
        ],
    }).notNull(),
    // Recipient discriminator (replaces the fixed `recipient` enum). `role` means
    // "the role profile named by recipientRoleProfileId"; `inspector` and `all`
    // are role-independent and always carry a null profile id. Invariant:
    // recipient_role_profile_id is set iff kind='role'; when set it holds a
    // contact_role_profiles.id (app-layer link, no FK per Schema Rules).
    recipientKind: text('recipient_kind', { enum: ['role', 'inspector', 'all'] }).notNull(),
    recipientRoleProfileId: text('recipient_role_profile_id'),
    delayMinutes: integer('delay_minutes').notNull().default(0),
    // -- DEAD (2026-06-26, SP2): embedded email subject/body retired. Automations
    // now reference a message_templates row via email_template_id. Frozen: no
    // reads/writes; D1 cannot drop an FK-referenced column. Do not reuse.
    subjectTemplate: text('subject_template').notNull(),
    // -- DEAD (2026-06-26, SP2): see subject_template above.
    bodyTemplate: text('body_template').notNull(),
    // SP2 — references a message_templates(channel='email') row for the email
    // channel. Null = no email template selected (channel disabled or unmigrated).
    emailTemplateId: text('email_template_id'),
    // Track J (D2) — send-time gates, JSON: { requirePaid?: bool, requireSigned?: bool, serviceIds?: string[] }.
    // null = no gates. Evaluated in flush() at delivery, NOT at trigger time.
    conditions: text('conditions'),
    // Track L (D2) — enabled delivery channels, JSON string[] e.g. '["email","sms"]'.
    // A firing emits one automation_logs row per channel. Default email-only.
    channels: text('channels').notNull().default('["email"]'),
    // -- DEAD (2026-06-26, SP2): embedded plain-text SMS body retired. Automations
    // now reference a message_templates(channel='sms') row via sms_template_id.
    // Frozen: no reads/writes; do not reuse.
    smsBody: text('sms_body'),
    // SP2 — references a message_templates(channel='sms') row for the SMS channel.
    // Null = no SMS template selected.
    smsTemplateId: text('sms_template_id'),
    active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_automations_tenant').on(t.tenantId),
]);

export const automationLogs = sqliteTable('automation_logs', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    automationId: text('automation_id').notNull(),
    inspectionId: text('inspection_id').notNull(),
    // Track L — holds the email address for email logs, the E.164 phone for sms logs.
    recipient: text('recipient').notNull(),   // RENAMED from recipient_email (0025)
    // Spec 2 — the recipient's role-profile key (e.g. 'buyer_agent'), captured at
    // enqueue so the flush/send path can mint a role-keyed portal token per
    // recipient. Null for logs with no role context (legacy/reminder/inspector).
    recipientRoleKey: text('recipient_role_key'),
    // Track L — the log's own delivery channel (a multi-channel rule emits one log each).
    channel: text('channel', { enum: ['email', 'sms'] }).notNull().default('email'),
    sendAt: integer('send_at', { mode: 'timestamp_ms' }).notNull(),
    deliveredAt: integer('delivered_at', { mode: 'timestamp_ms' }),
    status: text('status', { enum: ['pending', 'sent', 'failed', 'skipped'] }).notNull().default('pending'),
    error: text('error'),
    eventId: text('event_id'),
}, (t) => [
    index('idx_automation_logs_pending').on(t.tenantId, t.status, t.sendAt),
    index('idx_automation_logs_insp').on(t.inspectionId),
    // DB-9 — idempotency: one log row per (automation, inspection, event, channel,
    // recipient) when event_id is set. Guards against retry double-sends — including
    // for multi-recipient/multi-channel rules, where each recipient/channel still
    // gets its own distinct row. Partial (event_id present) so legacy rows that
    // predate event-id stamping aren't forced unique on a NULL key.
    uniqueIndex('uq_automation_logs_event')
        .on(t.automationId, t.inspectionId, t.eventId, t.channel, t.recipient)
        .where(sql`event_id IS NOT NULL`),
]);

// Spec 4D — Inspection Events

export const eventTypes = sqliteTable('event_types', {
    id:                 text('id').primaryKey(),
    tenantId:           text('tenant_id').notNull().references(() => tenants.id),
    name:               text('name').notNull(),
    slug:               text('slug').notNull(),
    defaultDurationMin: integer('default_duration_min').notNull().default(30),
    defaultPriceCents:  integer('default_price_cents').notNull().default(0),
    color:              text('color').notNull().default('#6366f1'),
    sortOrder:          integer('sort_order').notNull().default(0),
    active:             integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt:          integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    uniqueIndex('uq_event_types_tenant_slug').on(t.tenantId, t.slug),
]);

// Settings + Library IA — tenant-defined inspection subtypes layered on the
// platform property subtypes (Office/Retail/...). `basedOn` is a plain-string
// soft ref to a platform subtype slug (no DB FK per Schema Rules). New table:
// app-layer tenant filtering only, no `.references()`.
export const inspectionTypes = sqliteTable('inspection_types', {
    id:          text('id').primaryKey(),
    tenantId:    text('tenant_id').notNull(),
    name:        text('name').notNull(),
    basedOn:     text('based_on'),
    description: text('description'),
    enabled:     integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
    sortOrder:   integer('sort_order').notNull().default(0),
    createdAt:   integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    uniqueIndex('idx_inspection_types_tenant_name').on(t.tenantId, t.name),
]);

export const inspectionEvents = sqliteTable('inspection_events', {
    id:                text('id').primaryKey(),
    tenantId:          text('tenant_id').notNull().references(() => tenants.id),
    inspectionId:      text('inspection_id').notNull().references(() => inspections.id, { onDelete: 'cascade' }),
    eventTypeId:       text('event_type_id').notNull().references(() => eventTypes.id),
    inspectorId:       text('inspector_id').references(() => users.id),
    scheduledAt:       integer('scheduled_at', { mode: 'timestamp_ms' }).notNull(),
    durationMin:       integer('duration_min').notNull(),
    priceCents:        integer('price_cents').notNull().default(0),
    status:            text('status', { enum: ['scheduled', 'completed', 'results_received', 'cancelled'] }).notNull().default('scheduled'),
    notes:             text('notes'),
    completedAt:       integer('completed_at', { mode: 'timestamp_ms' }),
    resultsReceivedAt: integer('results_received_at', { mode: 'timestamp_ms' }),
    cancelledAt:       integer('cancelled_at', { mode: 'timestamp_ms' }),
    gcalEventId:       text('gcal_event_id'),
    createdAt:         integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_inspection_events_scheduled').on(t.tenantId, t.scheduledAt),
    index('idx_inspection_events_inspection').on(t.inspectionId),
]);
