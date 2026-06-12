import { drizzle } from 'drizzle-orm/d1';
import { sql } from 'drizzle-orm';
import { usageCounters } from '../lib/db/schema/usage';
import { type UsageMetric } from '../lib/usage/period';

/**
 * SaaS-only usage meter. Takes a raw D1Database and creates a drizzle handle per
 * call (matches admin.service so unit tests can mock `drizzle`). Standalone never
 * constructs this — see maybeMetering().
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

  async getAll(): Promise<Array<typeof usageCounters.$inferSelect>> {
    return drizzle(this.db).select().from(usageCounters).all();
  }
}

/** The single metering gate. Returns a service only in SaaS; undefined otherwise
 *  (standalone → callers no-op via optional chaining). Works in request AND
 *  scheduled contexts because it keys on env, not on the request profile. */
export function maybeMetering(env: { APP_MODE?: string; DB: D1Database }): MeteringService | undefined {
  return env.APP_MODE === 'saas' ? new MeteringService(env.DB) : undefined;
}
