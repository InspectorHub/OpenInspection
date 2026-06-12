import { STOCK_PERIOD } from '../lib/usage/period';
import { type MeteringService } from './metering.service';

/**
 * Daily SaaS-only R2 measurement. Photo/report/message keys use `${tenantId}/...`;
 * agreements/profile/export keys use `tenants/${tenantId}/...`; branding uses
 * `branding/${tenantId}/...`. Sum all three prefixes per tenant (mutually
 * exclusive first path segments — no double counting).
 */
export class R2UsageService {
  constructor(private r2: R2Bucket, private metering: Pick<MeteringService, 'setGauge'>) {}

  async measureTenant(tenantId: string): Promise<number> {
    let bytes = 0;
    for (const prefix of [`${tenantId}/`, `tenants/${tenantId}/`, `branding/${tenantId}/`]) {
      let cursor: string | undefined;
      do {
        const list = await this.r2.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
        bytes += list.objects.reduce((s, o) => s + (o.size ?? 0), 0);
        cursor = list.truncated ? list.cursor : undefined;
      } while (cursor);
    }
    return bytes;
  }

  async measureAll(tenantIds: string[]): Promise<void> {
    for (const tenantId of tenantIds) {
      await this.metering.setGauge(tenantId, 'r2_bytes', STOCK_PERIOD, await this.measureTenant(tenantId));
    }
  }
}
