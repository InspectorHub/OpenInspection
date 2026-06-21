import { STOCK_PERIOD } from '../lib/usage/period';
import { type MeteringService } from './metering.service';

/**
 * Daily SaaS-only R2 measurement. All tenant assets — inspection photos,
 * client documents, branding, inspector profile photos, agreements, exports —
 * live under the unified `${tenantId}/` prefix (R2 key convention §1).
 * A single paginated list suffices; no multi-prefix fan-out required.
 */
export class R2UsageService {
  constructor(private r2: R2Bucket, private metering: Pick<MeteringService, 'setGauge'>) {}

  async measureTenant(tenantId: string): Promise<number> {
    let bytes = 0;
    for (const prefix of [`${tenantId}/`]) {
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
