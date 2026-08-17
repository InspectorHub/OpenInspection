import { drizzle } from 'drizzle-orm/d1';
import { eq, getTableColumns, getTableName } from 'drizzle-orm';
import { logger } from '../lib/logger';
import { tenants, tenantDestructionRecords, users, reports } from '../lib/db/schema';
import { collabDocName } from '../lib/collab/doc-name';
import { DESTRUCTION_STATUS } from '../lib/status/destruction-status';
import { DESTRUCTION_RECORD_GENERATION, STORES_MEASURED } from '../lib/compliance/destruction-scope';
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
    /** How many Durable Objects were confirmed emptied — attempts are not counted. */
    durableObjects: number;
    /**
     * Stores this purge could not confirm destroyed.
     *
     * Empty is the only value that supports a certification. A non-empty list
     * is not a crash and not a retry signal — the rows are already gone — it is
     * the honest statement that one store's destruction is unverified and a
     * human has to look.
     */
    incompleteStores: string[];
}

/**
 * The Durable Object namespaces a purge can reach.
 *
 * Both optional, because `INSPECTION_DOC` genuinely may not be bound: a
 * deployment that never enabled collaborative editing has no such binding and
 * its collab routes answer 501. An absent namespace is therefore a deployment
 * with no such objects to destroy, not a failure — see the skip below, and the
 * spec that pins the distinction.
 *
 * `INSPECTION_PRESENCE` is absent from this type on purpose. It holds no
 * storage of its own, and it is addressed by inspection id with no tenant
 * component, so a tenant purge could not enumerate its objects even if it did.
 */
export interface PurgeDurableObjects {
    // `| undefined` written out because this repository runs
    // exactOptionalPropertyTypes: a caller reading straight off `env`, which is
    // where both of these actually come from, hands over the union.
    INSPECTION_DOC?:  DurableObjectNamespace | undefined;
    TENANT_PRESENCE?: DurableObjectNamespace | undefined;
}

export class TenantPurgeService {
    constructor(
        private db: D1Database,
        private r2: R2Bucket,
        private kv: KVNamespace,
        private dos: PurgeDurableObjects = {},
    ) {}

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

        //    Report ids, collected HERE and not later, because `INSPECTION_DOC`
        //    is addressed by `${tenantId}:${reportId}` — the report, not the
        //    inspection — and step 3 deletes the rows these come from. Read
        //    after the cascade this is an empty list, and the purge then
        //    reports success having destroyed none of the documents.
        const reportIds = (await d.select({ id: reports.id }).from(reports)
            .where(eq(reports.tenantId, tenantId)).all()).map(r => r.id as string);

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
            //    The measurement universe is declared UP FRONT, with the same
            //    reasoning as the row itself: a purge that dies partway leaves
            //    behind what it set out to measure, so the gap between the
            //    declared scope and the results is readable. Declared at the
            //    end it would only ever describe runs that finished.
            recordVersion:  DESTRUCTION_RECORD_GENERATION,
            storesMeasured: [...STORES_MEASURED],
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

        // 6. Durable Objects. NOT best-effort like the R2 and KV sweeps above.
        //
        //    The difference is what a failure means. A KV delete that throws
        //    leaves behind a cache entry whose backing row is already gone; a
        //    Durable Object that refuses to purge still holds the report's prose
        //    or the workspace's presence state, which is the personal data the
        //    destruction claims to have removed. So one is swallowed and the
        //    other is recorded, by name, as unverified.
        //
        //    Nothing is retried and nothing is thrown: by this point the rows
        //    are gone, so failing here would report failure for work that
        //    succeeded and invite a retry that files a zero-count record.
        const incompleteStores: string[] = [];
        let durableObjects = 0;
        const doTargets: Array<[DurableObjectNamespace | undefined, string]> = [
            ...reportIds.map(r => [this.dos.INSPECTION_DOC, collabDocName(tenantId, r)] as [DurableObjectNamespace | undefined, string]),
            [this.dos.TENANT_PRESENCE, tenantId],
        ];
        for (const [ns, name] of doTargets) {
            // An unbound namespace is a deployment without that feature, so
            // there is no object of that class to destroy. Recording it as
            // incomplete would make every standalone purge cry wolf, and an
            // alarm that always fires is read as noise by the second week.
            if (!ns) {
                logger.info('Durable Object namespace unbound, nothing to purge', { tenantId, name });
                continue;
            }
            try {
                const res = await ns.get(ns.idFromName(name)).fetch('https://do/purge', { method: 'POST' });
                if (!res.ok) throw new Error(`purge returned ${res.status}`);
                durableObjects++;
            } catch (err) {
                logger.error('Durable Object purge failed', { tenantId, name }, err instanceof Error ? err : undefined);
                if (!incompleteStores.includes('durable_objects')) incompleteStores.push('durable_objects');
            }
        }

        // 7. Close the destruction record: the counts, and the fact that every
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
            //    Per-store outcome. `status` stays a two-value axis about
            //    whether the run finished — a store that refused to purge is a
            //    finished run with one unverified measurement, which is a
            //    different fact and belongs in its own column. The three stores
            //    with no failure path of their own report complete because
            //    their sweeps ran; `durable_objects` reports what it observed.
            const storeResults: Record<string, string> = Object.fromEntries(
                STORES_MEASURED.map(s => [s, incompleteStores.includes(s) ? 'incomplete' : 'complete']),
            );
            await d.update(tenantDestructionRecords)
                .set({
                    rowsDeleted: rows,
                    r2Objects:   r2Count,
                    r2Bytes,
                    kvKeys:      kvCount,
                    storeResults,
                    status:      DESTRUCTION_STATUS.COMPLETED,
                    completedAt: new Date(),
                })
                .where(eq(tenantDestructionRecords.id, recordId));
        } catch (err) {
            logger.error('Destruction record close failed', { tenantId, recordId }, err instanceof Error ? err : undefined);
        }

        logger.info('Tenant purged', { tenantId, rows, r2: r2Count, r2Bytes, kv: kvCount, durableObjects, incompleteStores });
        return { rows, r2: r2Count, r2Bytes, kv: kvCount, durableObjects, incompleteStores };
    }
}
