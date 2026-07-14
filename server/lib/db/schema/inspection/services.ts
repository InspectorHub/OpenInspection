import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { tenants } from '../tenant';
import { templates } from './template-rating';
import { agreements } from './agreements';
import { inspections } from './core';

export const services = sqliteTable('services', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    description: text('description'),
    price: integer('price_cents').notNull(),
    durationMinutes: integer('duration_minutes'),
    templateId: text('template_id').references(() => templates.id),
    agreementId: text('agreement_id').references(() => agreements.id),
    active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_services_tenant').on(t.tenantId),
]);

export const inspectionServices = sqliteTable('inspection_services', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    inspectionId: text('inspection_id').notNull().references(() => inspections.id, { onDelete: 'cascade' }),
    serviceId: text('service_id').notNull().references(() => services.id),
    // P-4 authority chain (tier 2): effective line price = priceOverride ?? priceSnapshot.
    // SUM across all lines for this inspection is authoritative over inspections.price
    // but subordinate to any invoice.amountCents. See getEffectivePriceCents().
    priceOverride: integer('price_override_cents'),
    nameSnapshot: text('name_snapshot').notNull(),
    priceSnapshot: integer('price_snapshot_cents').notNull(),
}, (t) => [
    index('idx_insp_services_tenant').on(t.tenantId),
    index('idx_insp_services_insp').on(t.inspectionId),
]);

export const discountCodes = sqliteTable('discount_codes', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    code: text('code').notNull(),
    type: text('type', { enum: ['fixed', 'percent'] }).notNull(),
    value: integer('value').notNull(),
    maxUses: integer('max_uses'),
    usesCount: integer('uses_count').notNull().default(0),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_discount_codes_tenant').on(t.tenantId),
    uniqueIndex('uq_discount_codes_code_tenant').on(sql`upper(code)`, t.tenantId),
]);
