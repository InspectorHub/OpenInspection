import { drizzle } from 'drizzle-orm/d1';
import { sql, eq, and } from 'drizzle-orm';
import { usageCounters } from '../lib/db/schema/usage';
import { type UsageMetric } from '../lib/usage/period';

/**
 * Usage meter. Takes a raw D1Database and creates a drizzle handle per call
 * (matches admin.service so unit tests can mock `drizzle`). Runs in every mode —
 * see maybeMetering().
 */
export class MeteringService {
  constructor(private db: D1Database) {}

  /** Increment a flow counter (sms/email) for a (tenant, metric, period) bucket. */
  async record(tenantId: string, metric: UsageMetric, periodKey: string, delta = 1): Promise<void> {
    const d = drizzle(this.db);
    await d.insert(usageCounters)
      .values({ tenantId, metric, periodKey, value: delta, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [usageCounters.tenantId, usageCounters.metric, usageCounters.periodKey],
        set: { value: sql`${usageCounters.value} + ${delta}`, updatedAt: new Date() },
      });
  }

  /** Overwrite a stock gauge (r2_bytes) with a freshly measured absolute value. */
  async setGauge(tenantId: string, metric: UsageMetric, periodKey: string, value: number): Promise<void> {
    const d = drizzle(this.db);
    await d.insert(usageCounters)
      .values({ tenantId, metric, periodKey, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [usageCounters.tenantId, usageCounters.metric, usageCounters.periodKey],
        set: { value, updatedAt: new Date() },
      });
  }

  /** Read the current counter value for a (tenant, metric, period) bucket.
   *  Returns 0 when no row exists (safe default for quota comparisons). */
  async getCount(tenantId: string, metric: UsageMetric, periodKey: string): Promise<number> {
    const d = drizzle(this.db);
    const row = await d.select({ value: usageCounters.value })
      .from(usageCounters)
      .where(and(
        eq(usageCounters.tenantId, tenantId),
        eq(usageCounters.metric, metric),
        eq(usageCounters.periodKey, periodKey),
      ))
      .get();
    return row?.value ?? 0;
  }

  async getAll(): Promise<Array<typeof usageCounters.$inferSelect>> {
    return drizzle(this.db).select().from(usageCounters).all();
  }

  /** Lifetime total for a (tenant, metric) across every period bucket. */
  async lifetimeTotal(tenantId: string, metric: UsageMetric): Promise<number> {
    const d = drizzle(this.db);
    const row = await d.select({ total: sql<number>`coalesce(sum(${usageCounters.value}), 0)` })
      .from(usageCounters)
      .where(and(eq(usageCounters.tenantId, tenantId), eq(usageCounters.metric, metric)))
      .get();
    return row?.total ?? 0;
  }
}

/** Construct the usage meter. Metering runs in every mode: the usage_counters
 *  table exists in every deploy post-migration, and standalone rows all carry
 *  tenantId = SINGLE_TENANT_ID (whole-instance usage). Kept as a factory (rather
 *  than `new MeteringService` at call sites) so request + scheduled contexts share
 *  one construction point. */
export function maybeMetering(env: { APP_MODE?: string; DB: D1Database }): MeteringService {
  return new MeteringService(env.DB);
}
