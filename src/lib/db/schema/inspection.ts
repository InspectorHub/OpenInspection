import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { tenants, users } from './tenant';

export const templates = sqliteTable('templates', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    version: integer('version').notNull().default(1),
    schema: text('schema', { mode: 'json' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const inspections = sqliteTable('inspections', {
    id:                  text('id').primaryKey(),
    tenantId:            text('tenant_id').notNull().references(() => tenants.id),
    inspectorId:         text('inspector_id').references(() => users.id),
    propertyAddress:     text('property_address').notNull(),
    clientName:          text('client_name'),
    clientEmail:         text('client_email'),
    clientPhone:         text('client_phone'),
    templateId:          text('template_id').references(() => templates.id),
    date:                text('date').notNull(),
    status:              text('status').notNull().default('draft'),
    paymentStatus:       text('payment_status').notNull().default('unpaid'),
    referredByAgentId:   text('referred_by_agent_id'),   // Buyer's Agent — unkeyed TEXT (backward compat)
    price:               integer('price').notNull().default(0),
    createdAt:           integer('created_at', { mode: 'timestamp' }).notNull(),
    // Phase 0 parity additions
    confirmedAt:         text('confirmed_at'),
    cancelReason:        text('cancel_reason'),
    paymentRequired:     integer('payment_required', { mode: 'boolean' }).notNull().default(false),
    agreementRequired:   integer('agreement_required', { mode: 'boolean' }).notNull().default(false),
    discountCodeId:      text('discount_code_id'),
    discountAmount:      integer('discount_amount'),
    closingDate:         text('closing_date'),
    referralSource:      text('referral_source'),
    orderId:             text('order_id'),
    internalNotes:       text('internal_notes'),
    yearBuilt:           integer('year_built'),
    sqft:                integer('sqft'),
    foundationType:      text('foundation_type'),
    bedrooms:            integer('bedrooms'),
    bathrooms:           real('bathrooms'),
    unit:                text('unit'),
    county:              text('county'),
    sellingAgentId:      text('selling_agent_id'),
    disableAutomations:  integer('disable_automations', { mode: 'boolean' }).notNull().default(false),
});

export const agreements = sqliteTable('agreements', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    content: text('content').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const inspectionAgreements = sqliteTable('inspection_agreements', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    inspectionId: text('inspection_id').notNull().references(() => inspections.id),
    signatureBase64: text('signature_base64').notNull(),
    signedAt: integer('signed_at', { mode: 'timestamp' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
});

export const inspectionResults = sqliteTable('inspection_results', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    inspectionId: text('inspection_id').notNull().references(() => inspections.id),
    data: text('data', { mode: 'json' }).notNull(),
    lastSyncedAt: integer('last_synced_at', { mode: 'timestamp' }).notNull(),
});

export const availability = sqliteTable('availability', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    inspectorId: text('inspector_id').notNull().references(() => users.id),
    dayOfWeek: integer('day_of_week').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const availabilityOverrides = sqliteTable('availability_overrides', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    inspectorId: text('inspector_id').notNull().references(() => users.id),
    date: text('date').notNull(),
    isAvailable: integer('is_available', { mode: 'boolean' }).notNull().default(false),
    startTime: text('start_time'),
    endTime: text('end_time'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const comments = sqliteTable('comments', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    text: text('text').notNull(),
    category: text('category'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const agreementRequests = sqliteTable('agreement_requests', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    inspectionId: text('inspection_id').references(() => inspections.id),
    agreementId: text('agreement_id').notNull().references(() => agreements.id),
    clientEmail: text('client_email').notNull(),
    clientName: text('client_name'),
    token: text('token').notNull().unique(),
    status: text('status', { enum: ['pending', 'viewed', 'signed'] }).notNull().default('pending'),
    signatureBase64: text('signature_base64'),
    signedAt: integer('signed_at', { mode: 'timestamp' }),
    viewedAt: integer('viewed_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const services = sqliteTable('services', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    description: text('description'),
    price: integer('price').notNull(), // cents
    durationMinutes: integer('duration_minutes'),
    templateId: text('template_id').references(() => templates.id),
    agreementId: text('agreement_id').references(() => agreements.id),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const inspectionServices = sqliteTable('inspection_services', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    inspectionId: text('inspection_id').notNull().references(() => inspections.id),
    serviceId: text('service_id').notNull().references(() => services.id),
    priceOverride: integer('price_override'),
    nameSnapshot: text('name_snapshot').notNull(),
    priceSnapshot: integer('price_snapshot').notNull(),
});

export const discountCodes = sqliteTable('discount_codes', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    code: text('code').notNull(),
    type: text('type', { enum: ['fixed', 'percent'] }).notNull(),
    value: integer('value').notNull(),
    maxUses: integer('max_uses'),
    usesCount: integer('uses_count').notNull().default(0),
    expiresAt: text('expires_at'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const automations = sqliteTable('automations', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    trigger: text('trigger', {
        enum: [
            'inspection.created', 'inspection.confirmed', 'inspection.cancelled',
            'report.published', 'invoice.created', 'payment.received', 'agreement.signed',
        ],
    }).notNull(),
    recipient: text('recipient', {
        enum: ['client', 'buying_agent', 'selling_agent', 'inspector', 'all'],
    }).notNull(),
    delayMinutes: integer('delay_minutes').notNull().default(0),
    subjectTemplate: text('subject_template').notNull(),
    bodyTemplate: text('body_template').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const automationLogs = sqliteTable('automation_logs', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    automationId: text('automation_id').notNull().references(() => automations.id),
    inspectionId: text('inspection_id').notNull().references(() => inspections.id),
    recipientEmail: text('recipient_email').notNull(),
    sendAt: text('send_at').notNull(),
    deliveredAt: text('delivered_at'),
    status: text('status', { enum: ['pending', 'sent', 'failed', 'skipped'] }).notNull().default('pending'),
    error: text('error'),
});
