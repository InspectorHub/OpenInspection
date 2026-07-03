import { type usageCounters } from '../db/schema/usage';
export interface TenantUsage {
  tenantId: string;
  sms: number;
  email: number;
  smsByo: number;
  emailByo: number;
  inspections: number;
  r2Bytes: number;
}

const ZERO_USAGE = { sms: 0, email: 0, smsByo: 0, emailByo: 0, inspections: 0, r2Bytes: 0 };

/** Collapse counter rows to one summary per tenant. sms/email/sms_byo/email_byo/
 *  inspections are SUMMED across periods (cumulative); r2_bytes is a gauge
 *  (latest stored value). */
export function aggregateUsage(rows: Array<typeof usageCounters.$inferSelect>): TenantUsage[] {
  const byTenant = new Map<string, TenantUsage>();
  for (const r of rows) {
    const cur = byTenant.get(r.tenantId) ?? { tenantId: r.tenantId, ...ZERO_USAGE };
    if (r.metric === 'sms') cur.sms += r.value;
    else if (r.metric === 'email') cur.email += r.value;
    else if (r.metric === 'sms_byo') cur.smsByo += r.value;
    else if (r.metric === 'email_byo') cur.emailByo += r.value;
    else if (r.metric === 'inspections') cur.inspections += r.value;
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
  return aggregateUsage(mine)[0] ?? { tenantId, ...ZERO_USAGE };
}
