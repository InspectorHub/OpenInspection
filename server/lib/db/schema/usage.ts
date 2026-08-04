import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

/**
 * Per-tenant usage meter (Phase 1, SaaS-only — inert in standalone).
 * Flows (sms/email/sms_byo/email_byo/inspections): period_key = 'YYYY-MM',
 * except 'inspections' which uses the STOCK_PERIOD sentinel ('lifetime') since
 * it is a running lifetime total, not a monthly flow. Stock (r2_bytes):
 * period_key = 'lifetime', overwritten by the daily measurement job.
 * `sms_byo`/`email_byo` count sends made through a tenant's own credentials
 * (bring-your-own), tracked separately from platform-metered `sms`/`email`.
 * `ai_translate`/`ai_assist` carry the same split for AI work, and are two
 * metrics rather than one because their cost profiles differ by an order of
 * magnitude — roughly one translation per report against tens of assist calls
 * per inspection, so a single counter could not govern both.
 *
 * The enum is type-layer only (no DDL), so adding a metric needs no migration —
 * it must nonetheless stay in step with `UsageMetric` in `lib/usage/period.ts`,
 * which `tests/unit/usage/usage-schema.spec.ts` asserts.
 */
export const usageCounters = sqliteTable('usage_counters', {
  tenantId: text('tenant_id').notNull(),
  metric: text('metric', { enum: [
    'sms', 'email', 'r2_bytes', 'inspections', 'sms_byo', 'email_byo',
    'ai_translate', 'ai_translate_byo', 'ai_assist', 'ai_assist_byo',
  ] }).notNull(),
  periodKey: text('period_key').notNull(),
  value: integer('value').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.tenantId, t.metric, t.periodKey] }),
  byTenant: index('idx_usage_counters_tenant').on(t.tenantId),
}));
