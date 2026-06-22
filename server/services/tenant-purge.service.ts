import { drizzle } from 'drizzle-orm/d1';
import { eq, getTableColumns, getTableName } from 'drizzle-orm';
import { logger } from '../lib/logger';
import { tenants, tenantDestructionRecords, users } from '../lib/db/schema';
// The tenant-scoped table set is DERIVED from the schema (every table with a
// `tenant_id` column, minus the destruction-record ledger) so the purge can
// never silently drift as tables are added. The former hand-maintained list
// omitted invoices, messages, access tokens, report versions, signing keys,
// e-sign audit logs, qbo_*, repair requests, media pool, etc. — leaving PII
// behind after a destruction request. Re-exported for the drift-guard test.
import { tenantScopedTables } from '../lib/db/scoped-tables';
export { tenantScopedTables };

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
        // D1 reports row changes under `meta.changes`; better-sqlite3 (unit tests)
        // reports them as a top-level `changes`. Tolerate both.
        const countChanges = (r: unknown) => {
            const rr = r as { meta?: { changes?: number }; changes?: number };
            return rr.meta?.changes ?? rr.changes ?? 0;
        };
        let rows = 0;
        for (const tbl of tenantScopedTables()) {
            try {
                const col = getTableColumns(tbl).tenantId as never;
                rows += countChanges(await d.delete(tbl).where(eq(col, tenantId)).run());
            } catch (err) {
                logger.error('Tenant table delete failed', { tenantId, table: getTableName(tbl) }, err instanceof Error ? err : undefined);
            }
        }
        // The tenant row itself is keyed by `id`, not `tenant_id` — delete last.
        try {
            rows += countChanges(await d.delete(tenants).where(eq(tenants.id, tenantId)).run());
        } catch (err) {
            logger.error('Tenant row delete failed', { tenantId }, err instanceof Error ? err : undefined);
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
