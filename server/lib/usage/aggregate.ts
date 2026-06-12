import { type usageCounters } from '../db/schema/usage';
export interface TenantUsage { tenantId: string; sms: number; email: number; r2Bytes: number; }
/** Collapse counter rows to one summary per tenant. sms/email are SUMMED across
 *  periods (cumulative); r2_bytes is a gauge (latest stored value). */
export function aggregateUsage(rows: Array<typeof usageCounters.$inferSelect>): TenantUsage[] {
  const byTenant = new Map<string, TenantUsage>();
  for (const r of rows) {
    const cur = byTenant.get(r.tenantId) ?? { tenantId: r.tenantId, sms: 0, email: 0, r2Bytes: 0 };
    if (r.metric === 'sms') cur.sms += r.value;
    else if (r.metric === 'email') cur.email += r.value;
    else if (r.metric === 'r2_bytes') cur.r2Bytes = r.value;
    byTenant.set(r.tenantId, cur);
  }
  return [...byTenant.values()];
}

/** One tenant's usage summary, zero-filled when it has no counter rows yet. */
export function summariseTenantUsage(
  rows: Array<typeof usageCounters.$inferSelect>,
  tenantId: string,
): TenantUsage {
  const mine = rows.filter((r) => r.tenantId === tenantId);
  return aggregateUsage(mine)[0] ?? { tenantId, sms: 0, email: 0, r2Bytes: 0 };
}
