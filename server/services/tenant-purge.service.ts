import { drizzle } from 'drizzle-orm/d1';
import { eq, getTableColumns, getTableName } from 'drizzle-orm';
import { logger } from '../lib/logger';
import { tenants, tenantDestructionRecords, users } from '../lib/db/schema';
import { DESTRUCTION_STATUS } from '../lib/status/destruction-status';
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

        // 2. Open the destruction record BEFORE anything is destroyed.
        //
        //    This row is the proof the deletion happened, and evidence written
        //    after the fact is lost by precisely the failures worth recording.
        //    Written last — as it was — a crash between the cascade and the
        //    insert left a tenant permanently destroyed with nothing on file
        //    saying so, and the only trace was a `logger.error` on a platform
        //    whose logs are kept for days against an audit window kept for
        //    years.
        //
        //    Nor could that be fixed by letting the write throw: by the time it
        //    runs the data is already gone, so failing there does not undo
        //    anything. It returns an error to a caller who may then RETRY, and
        //    the retry deletes nothing and files a record reading `rowsDeleted:
        //    0` — a false certificate, which is worse than a missing one.
        //
        //    Opened first, the failure mode inverts: a purge that dies partway
        //    leaves a row that says 'started' and never completed. That is an
        //    alert, an accurate one, and it names the tenant to go verify by
        //    hand. `completed_at` is what an SCC Clause 8.5 certification is
        //    actually read off.
        //
        //    The insert is deliberately NOT in a try/catch. Here, unlike at the
        //    end, throwing is correct and costs nothing: nothing has been
        //    destroyed yet, so refusing to start a destruction we cannot
        //    evidence leaves the tenant exactly as it was.
        const recordId = crypto.randomUUID();
        await d.insert(tenantDestructionRecords).values({
            id:          recordId,
            tenantId,
            tenantSlug,
            destroyedAt: new Date(),
            status:      DESTRUCTION_STATUS.STARTED,
        });

        // 3. Delete tenant rows in dependency-safe order. Every table is scoped by
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

        // 4. R2 list + batch delete (accumulate object count + byte totals for the
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

        // 5. KV delete (best-effort)
        let kvCount = 0;
        for (const k of kvKeys) {
            try { await this.kv.delete(k); kvCount++; } catch { /* ignore */ }
        }

        // 6. Close the destruction record: the counts, and the fact that every
        //    step ran. A row left at 'started' is a purge that did not finish,
        //    and finding those is the point of writing the row up front.
        //
        //    This one IS best-effort, and for the opposite reason to the insert:
        //    everything is already destroyed, so throwing here would report
        //    failure for work that succeeded and invite a retry that files a
        //    zero-count record. A row stuck at 'started' after a successful
        //    purge understates what happened, which is the safe direction — it
        //    asks a human to look, rather than certifying something false.
        try {
            await d.update(tenantDestructionRecords)
                .set({
                    rowsDeleted: rows,
                    r2Objects:   r2Count,
                    r2Bytes,
                    kvKeys:      kvCount,
                    status:      DESTRUCTION_STATUS.COMPLETED,
                    completedAt: new Date(),
                })
                .where(eq(tenantDestructionRecords.id, recordId));
        } catch (err) {
            logger.error('Destruction record close failed', { tenantId, recordId }, err instanceof Error ? err : undefined);
        }

        logger.info('Tenant purged', { tenantId, rows, r2: r2Count, r2Bytes, kv: kvCount });
        return { rows, r2: r2Count, r2Bytes, kv: kvCount };
    }
}
