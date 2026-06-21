import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { logger } from '../lib/logger';
import {
    inspections, inspectionResults, automationLogs, automations, templates,
    agreements, agreementRequests, agreementSigners, services, inspectionServices, discountCodes,
    comments, contacts, users, tenantConfigs, tenants,
    availability, availabilityOverrides, inspectionAgreements,
    eventTypes, inspectionEvents, tenantDestructionRecords,
    inspectionInspectors, serviceInspectors, erasureLog, contractorTypes,
    clientUploads,
} from '../lib/db/schema';

const TENANT_TABLES = [
    // DB-8: link tables must be deleted before their parent rows.
    inspectionInspectors, serviceInspectors,
    // Track I-a: signer rows (PII) hang off agreement_requests — purge them first.
    inspectionAgreements, agreementSigners, agreementRequests, agreements, automationLogs,
    inspectionEvents, eventTypes, automations,
    inspectionServices, services, discountCodes, comments, contractorTypes, contacts,
    // client_uploads (per-inspection documents) carry R2 objects under a SEPARATE
    // `uploads/` prefix (swept below) — the rows must be purged with the tenant.
    clientUploads,
    availabilityOverrides, availability, inspectionResults, inspections, templates,
    // erasureLog holds subject_email PII scoped by tenantId — must be purged on
    // whole-tenant teardown. Per-subject erasure retains it (Art. 5(2)/30 proof).
    erasureLog,
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
        //    destruction record). The unified R2 key convention roots EVERY new asset
        //    under the bare `{tenantId}/` prefix (inspections/, branding/, messages/,
        //    inspector-photos/, etc.). Three legacy prefixes are also swept to cover
        //    objects written before the unified convention; once the pre-launch DB/R2
        //    rebuild removes all legacy objects these three entries become harmless
        //    no-ops (list returns empty, nothing is deleted).
        //
        //    Safety: the trailing `/` on `${tenantId}/` prevents any UUID from
        //    accidentally matching a different tenant whose UUID shares the same prefix
        //    — R2 list is a strict string-prefix filter, so `abc123/` never matches
        //    `abc1234/` or any other tenant's root.
        let r2Count = 0;
        let r2Bytes = 0;
        for (const prefix of [
            `${tenantId}/`,           // unified convention root (all new-convention assets)
            `tenants/${tenantId}/`,   // legacy: inspector photos / agreements (pre-migration)
            `uploads/${tenantId}/`,   // legacy: client documents (pre-migration)
            `branding/${tenantId}/`,  // legacy: company logos (pre-migration)
        ]) {
            let cursor: string | undefined;
            do {
                const list = await this.r2.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
                if (list.objects.length) {
                    await this.r2.delete(list.objects.map(o => o.key));
                    r2Count += list.objects.length;
                    r2Bytes += list.objects.reduce((sum, o) => sum + (o.size ?? 0), 0);
                }
                cursor = list.truncated ? list.cursor : undefined;
            } while (cursor);
        }

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
