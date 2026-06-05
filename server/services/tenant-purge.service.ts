import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { logger } from '../lib/logger';
import {
    inspections, inspectionResults, automationLogs, automations, templates,
    agreements, agreementRequests, services, inspectionServices, discountCodes,
    recommendations, comments, contacts, users, tenantConfigs, tenants,
    availability, availabilityOverrides, inspectionAgreements,
    eventTypes, inspectionEvents, tenantDestructionRecords,
} from '../lib/db/schema';

const TENANT_TABLES = [
    inspectionAgreements, agreementRequests, agreements, automationLogs,
    inspectionEvents, eventTypes, automations,
    inspectionServices, services, discountCodes, recommendations, comments, contacts,
    availabilityOverrides, availability, inspectionResults, inspections, templates,
    users, tenantConfigs, tenants,
];

export interface PurgeResult {
    rows:    number;
    r2:      number;
    r2Bytes: number;
    kv:      number;
}

export class TenantPurgeService {
    constructor(private db: D1Database, private r2: R2Bucket, private kv: KVNamespace) {}

    async purge(tenantId: string): Promise<PurgeResult> {
        const d = drizzle(this.db);

        // 1. Collect KV keys + tenant slug snapshot before tables are deleted.
        const t = await d.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId)).get();
        const tenantSlug = t?.slug ?? null;
        const userIds = (await d.select({ id: users.id }).from(users).where(eq(users.tenantId, tenantId)).all())
            .map(u => u.id as string);
        const kvKeys: string[] = [];
        if (t?.slug) {
            kvKeys.push(`tenant:${t.slug}`);
            kvKeys.push(`setup_code:${t.slug}`);
        }
        userIds.forEach(uid => kvKeys.push(`pwchanged:${uid}`));

        // 2. Delete tenant rows in dependency-safe order. Every table is scoped by
        //    its `tenantId` column EXCEPT `tenants` itself, whose primary key is
        //    `id` — match on the correct column so the tenant row is actually
        //    destroyed (matching on a non-existent `tenants.tenantId` produces
        //    malformed SQL and silently leaves the row behind).
        let rows = 0;
        for (const tbl of TENANT_TABLES) {
            try {
                const scope = (tbl as { tenantId?: unknown }).tenantId ?? (tbl as { id?: unknown }).id;
                const r = await d.delete(tbl).where(eq(scope as never, tenantId)).run();
                // D1 reports row changes under `meta.changes`; better-sqlite3 (unit
                // tests) reports them as a top-level `changes`. Tolerate both.
                const rr = r as unknown as { meta?: { changes?: number }; changes?: number };
                rows += rr.meta?.changes ?? rr.changes ?? 0;
            } catch (err) {
                logger.error('Tenant table delete failed', { tenantId, table: (tbl as { _ : { name: string } })._?.name }, err instanceof Error ? err : undefined);
            }
        }

        // 3. R2 list + batch delete (accumulate object count + byte totals for the
        //    destruction record).
        let r2Count = 0;
        let r2Bytes = 0;
        let cursor: string | undefined;
        do {
            const list = await this.r2.list({ prefix: `tenants/${tenantId}/`, limit: 1000, ...(cursor ? { cursor } : {}) });
            if (list.objects.length) {
                await this.r2.delete(list.objects.map(o => o.key));
                r2Count += list.objects.length;
                r2Bytes += list.objects.reduce((sum, o) => sum + (o.size ?? 0), 0);
            }
            cursor = list.truncated ? list.cursor : undefined;
        } while (cursor);

        // 4. KV delete (best-effort)
        let kvCount = 0;
        for (const k of kvKeys) {
            try { await this.kv.delete(k); kvCount++; } catch { /* ignore */ }
        }

        // 5. Durable destruction record (Privacy P3 §3.2). Written AFTER the cascade
        //    delete into a platform-level table (no tenant FK, not in TENANT_TABLES)
        //    so it survives as non-personal proof that the tenant was destroyed.
        try {
            await d.insert(tenantDestructionRecords).values({
                id:          crypto.randomUUID(),
                tenantId,
                tenantSlug,
                rowsDeleted: rows,
                r2Objects:   r2Count,
                r2Bytes,
                kvKeys:      kvCount,
                destroyedAt: new Date(),
            });
        } catch (err) {
            logger.error('Destruction record write failed', { tenantId }, err instanceof Error ? err : undefined);
        }

        logger.info('Tenant purged', { tenantId, rows, r2: r2Count, r2Bytes, kv: kvCount });
        return { rows, r2: r2Count, r2Bytes, kv: kvCount };
    }
}
