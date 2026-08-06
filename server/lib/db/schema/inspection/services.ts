import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { tenants } from '../tenant';
import { templates } from './template-rating';
import { agreements } from './agreements';
import { inspections } from './core';
import type { DepositPolicy } from '../../../billing/deposit-policy';

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
    // The visits this service implies. Radon needs two — a drop-off and a
    // pickup at least 48h later — while a sewer scope needs none beyond the
    // main visit.
    //
    // Stored as event_type SLUGS, not ids, and that is the load-bearing choice:
    // slugs are stable identifiers that survive a tenant deleting and
    // re-creating a type, they do not depend on seed ordering (services and
    // event types are seeded in the same run), and an unmatched slug degrades
    // to "propose nothing" instead of dangling. A hard FK would additionally
    // block deleting an event type, which is not a trade worth making for a
    // proposal.
    // Appended at table end for D1 rebuild safety.
    defaultEventTypeSlugs: text('default_event_type_slugs', { mode: 'json' }).$type<string[]>(),
    // Tier 2 of the booking deposit — this service's own answer, overriding the
    // workspace default in `tenant_configs.deposit_policy`.
    //
    // NULL and `{ type: 'none' }` are DIFFERENT answers and the distinction is
    // the reason this column is nullable rather than defaulted: NULL inherits,
    // `none` opts out. A workspace that takes 20% on everything still has one
    // $95 add-on it never asks a deposit for, and there is no way to say that
    // without both values.
    // Appended at table end for D1 rebuild safety (`services` is FK-referenced
    // by inspection_services and service_inspectors).
    depositPolicy: text('deposit_policy', { mode: 'json' }).$type<DepositPolicy>(),
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
    // A client changing scope at the door is routine — add a sewer scope, drop
    // the pool inspection, decline the radon. That used to be a hard delete,
    // which was harmless only while nothing hung off a line.
    //
    // Once a `reports` row or a pay split points here, a delete leaves dangling
    // rows and NOTHING surfaces it: Schema Rules forbid new foreign keys, so
    // there is no constraint to catch it. The invoice disagrees too —
    // `invoices.amountCents` is authoritative over the line sum, so removing a
    // line does not change what was billed while a split keeps paying against
    // it.
    //
    // Matches `services` and `discount_codes` in this same file. Appended at
    // table end for D1 rebuild safety. EVERY reader must filter on it — the
    // money chain in effective-price.sql.ts first.
    active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
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
