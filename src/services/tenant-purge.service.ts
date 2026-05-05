import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { logger } from '../lib/logger';
import {
    inspections, inspectionResults, automationLogs, automations, templates,
    agreements, agreementRequests, services, inspectionServices, discountCodes,
    recommendations, comments, contacts, users, tenantConfigs, tenants,
    availability, availabilityOverrides, inspectionAgreements,
    eventTypes, inspectionEvents,
} from '../lib/db/schema';

const TENANT_TABLES = [
    inspectionAgreements, agreementRequests, agreements, automationLogs,
    inspectionEvents, eventTypes, automations,
    inspectionServices, services, discountCodes, recommendations, comments, contacts,
    availabilityOverrides, availability, inspectionResults, inspections, templates,
    users, tenantConfigs, tenants,
];

export interface PurgeResult {
    rows: number;
    r2:   number;
    kv:   number;
}

export class TenantPurgeService {
    constructor(private db: D1Database, private r2: R2Bucket, private kv: KVNamespace) {}

    async purge(tenantId: string): Promise<PurgeResult> {
        const d = drizzle(this.db);

        // 1. Collect KV keys before tables deleted
        const t = await d.select({ subdomain: tenants.subdomain }).from(tenants).where(eq(tenants.id, tenantId)).get();
        const userIds = (await d.select({ id: users.id }).from(users).where(eq(users.tenantId, tenantId)).all())
            .map(u => u.id as string);
        const kvKeys: string[] = [];
        if (t?.subdomain) {
            kvKeys.push(`tenant:${t.subdomain}`);
            kvKeys.push(`setup_code:${t.subdomain}`);
        }
        userIds.forEach(uid => kvKeys.push(`pwchanged:${uid}`));

        // 2. Delete tenant rows in dependency-safe order
        let rows = 0;
        for (const tbl of TENANT_TABLES) {
            try {
                const r = await d.delete(tbl).where(eq((tbl as { tenantId: { name: string } }).tenantId as never, tenantId)).run();
                rows += r.meta.changes ?? 0;
            } catch (err) {
                logger.error('Tenant table delete failed', { tenantId, table: (tbl as { _ : { name: string } })._?.name }, err instanceof Error ? err : undefined);
            }
        }

        // 3. R2 list + batch delete
        let r2Count = 0;
        let cursor: string | undefined;
        do {
            const list = await this.r2.list({ prefix: `tenants/${tenantId}/`, limit: 1000, ...(cursor ? { cursor } : {}) });
            if (list.objects.length) {
                await this.r2.delete(list.objects.map(o => o.key));
                r2Count += list.objects.length;
            }
            cursor = list.truncated ? list.cursor : undefined;
        } while (cursor);

        // 4. KV delete (best-effort)
        let kvCount = 0;
        for (const k of kvKeys) {
            try { await this.kv.delete(k); kvCount++; } catch { /* ignore */ }
        }

        logger.info('Tenant purged', { tenantId, rows, r2: r2Count, kv: kvCount });
        return { rows, r2: r2Count, kv: kvCount };
    }
}
