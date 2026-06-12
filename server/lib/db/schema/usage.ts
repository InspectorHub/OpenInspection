import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

/**
 * Per-tenant usage meter (Phase 1, SaaS-only — inert in standalone).
 * Flows (sms/email): period_key = 'YYYY-MM'. Stock (r2_bytes): period_key =
 * 'lifetime', overwritten by the daily measurement job. Inspections are counted
 * live and NOT stored here.
 */
export const usageCounters = sqliteTable('usage_counters', {
  tenantId: text('tenant_id').notNull(),
  metric: text('metric', { enum: ['sms', 'email', 'r2_bytes'] }).notNull(),
  periodKey: text('period_key').notNull(),
  value: integer('value').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.tenantId, t.metric, t.periodKey] }),
  byTenant: index('idx_usage_counters_tenant').on(t.tenantId),
}));
