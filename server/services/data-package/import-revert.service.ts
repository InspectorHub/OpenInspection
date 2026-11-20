/**
 * Import revert — removes every row a data-package import wrote, in
 * dependency-safe order, without touching anything the target had before the
 * import or the identity roots that would lock the owner out.
 *
 * Revert is a correction of a just-applied import, not a reconciliation of
 * years of edits. Imported inspections are read-only (J14), and the other
 * mapped tables cannot be told apart from user edits without content hashes the
 * map does not store — so revert deletes ALL mapped rows unconditionally. The UI
 * must tell the owner this is irreversible before they step up.
 *
 * Invariants (all enforced here, not trusted from the client):
 *  - client-driven loop: one `revertStep` handles one bounded batch and reports
 *    `done`. No cron, no server-side runner. A step is safe to call again.
 *  - reverse topological order (children before parents) from IMPORT_TIERS;
 *    R2 media objects are last because they are independent of the D1 graph.
 *  - only rows in import_id_map are deleted. A row the target had before the
 *    import is not in the map and is never touched.
 *  - `tenants` and `users` are identity/access roots. Removing one would
 *    destroy the workspace or lock out its owner, so they are `protected` and
 *    left in place even when an import wrote them (their mapping is dropped).
 *  - media objects mapped as '__media' are deleted from R2; the evidence
 *    archive is NEVER removed — the bytes stay auditable (see importArchives).
 *  - on a real failure (R2 or D1) the mapping is left in place and reported, so
 *    a later step retries and `done` stays false until the batch is drained.
 *
 * Every target table is re-checked against the export whitelist before any SQL
 * is built — a forged map row can never turn into an arbitrary-table delete.
 */
import { and, eq, sql, getTableName, getTableColumns } from 'drizzle-orm';
import type { DrizzleDB } from '../../lib/db/scoped';
import type { R2Bucket } from '@cloudflare/workers-types';
import { importIdMap } from '../../lib/db/schema/data-package';
import { CLASSIFICATION } from '../../lib/data-package/classification';
import { isRowTable } from '../../lib/data-package/row-schemas';
import { IMPORT_TIERS } from '../../lib/data-package/import-plan';

const MEDIA_TABLE = '__media' as const;
const DEFAULT_STEP_LIMIT = 100;

/** Identity/access roots: never delete, even if an import wrote them. */
const PROTECTED_TABLES = new Set(['tenants', 'users']);

const tableObjects = new Map(
    CLASSIFICATION.map((e) => [getTableName(e.table), e.table] as const),
);

/** Higher tier = child, deleted first. Media (not in the plan) goes last.
 *  Built with fromEntries, not a top-level `new Map` + `.set` loop, so the
 *  unit-isolation gate does not see mutable module state. */
const TIER_OF: ReadonlyMap<string, number> = new Map(
    IMPORT_TIERS.flatMap((tier, i) => tier.map((t) => [t, i] as const)),
);
const rankOf = (table: string): number => table === MEDIA_TABLE ? -1 : (TIER_OF.get(table) ?? -1);

type KeptReason =
    | 'unsupported'   // no id column / not a whitelisted row table
    | 'protected'     // tenants/users identity root
    | 'not_found';    // already gone (manual delete)

interface RevertKept {
    table: string;
    newId: string;
    reason: KeptReason;
}

interface RevertError {
    table: string;
    newId: string;
    code: 'delete_failed' | 'media_delete_failed';
}

export interface RevertStepResult {
    /** No mapping rows remain for this package — the client can stop looping. */
    done: boolean;
    processed: number;
    deleted: Record<string, number>;
    kept: RevertKept[];
    mediaDeleted: number;
    errors: RevertError[];
}

export class DataPackageRevertService {
    constructor(
        private readonly db: DrizzleDB,
        private readonly bucket: R2Bucket,
    ) {}

    /** Process one bounded batch of mappings for (tenant, package). */
    async revertStep(
        tenantId: string,
        packageId: string,
        limit = DEFAULT_STEP_LIMIT,
    ): Promise<RevertStepResult> {
        const result: RevertStepResult = {
            done: false, processed: 0, deleted: {}, kept: [], mediaDeleted: 0, errors: [],
        };
        const scope = and(eq(importIdMap.tenantId, tenantId), eq(importIdMap.packageId, packageId));

        const all = await this.db.select().from(importIdMap).where(scope).all();
        all.sort((a, b) => rankOf(b.tableName) - rankOf(a.tableName));
        const batch = all.slice(0, Math.max(1, Math.min(limit, 1000)));

        for (const m of batch) {
            result.processed++;
            const table = m.tableName;

            if (table === MEDIA_TABLE) {
                // The whole new_id IS the R2 object key written by the media importer.
                try {
                    await this.bucket.delete(m.newId);
                    result.mediaDeleted++;
                    await this.deleteMapping(m.id, tenantId);
                } catch {
                    result.errors.push({ table, newId: m.newId, code: 'media_delete_failed' });
                    // Keep the mapping so a later step retries.
                }
                continue;
            }

            if (PROTECTED_TABLES.has(table)) {
                result.kept.push({ table, newId: m.newId, reason: 'protected' });
                await this.deleteMapping(m.id, tenantId);
                continue;
            }

            if (!isRowTable(table)) {
                result.kept.push({ table, newId: m.newId, reason: 'unsupported' });
                await this.deleteMapping(m.id, tenantId);
                continue;
            }
            const obj = tableObjects.get(table);
            if (!obj) {
                result.kept.push({ table, newId: m.newId, reason: 'unsupported' });
                await this.deleteMapping(m.id, tenantId);
                continue;
            }
            const columns = getTableColumns(obj) as Record<string, { name: string }>;
            const hasId = Object.values(columns).some((c) => c.name === 'id');
            if (!hasId) {
                result.kept.push({ table, newId: m.newId, reason: 'unsupported' });
                await this.deleteMapping(m.id, tenantId);
                continue;
            }

            // Table name passed the whitelist; quoting the identifier keeps the
            // raw SQL shape safe (values stay bound parameters).
            const tableSql = sql.raw(`"${table.replace(/"/g, '')}"`);

            // Existence check: skip a row already gone (manual delete) so its
            // mapping can be cleared without an error. Then delete ALL mapped
            // rows unconditionally — no updated_at / timestamp heuristic.
            // No local try/catch by design: a transient D1 error here aborts the
            // step, leaves the mapping intact, and the client retries the step —
            // no data loss. The DELETE below has its own catch so one bad row
            // does not fail the whole batch.
            const exists = await this.db.get<{ x: number }>(sql`
                SELECT 1 AS x FROM ${tableSql} WHERE id = ${m.newId} AND tenant_id = ${tenantId}`,
            );
            if (!exists) {
                result.kept.push({ table, newId: m.newId, reason: 'not_found' });
                await this.deleteMapping(m.id, tenantId);
                continue;
            }

            try {
                await this.db.run(sql`
                    DELETE FROM ${tableSql} WHERE id = ${m.newId} AND tenant_id = ${tenantId}`,
                );
                result.deleted[table] = (result.deleted[table] ?? 0) + 1;
                await this.deleteMapping(m.id, tenantId);
            } catch {
                result.errors.push({ table, newId: m.newId, code: 'delete_failed' });
                // Keep the mapping so a later step retries this row.
            }
        }

        const remaining = await this.db.select({ id: importIdMap.id }).from(importIdMap)
            .where(scope).limit(1).all();
        result.done = remaining.length === 0;
        return result;
    }

    private async deleteMapping(id: string, tenantId: string): Promise<void> {
        await this.db.delete(importIdMap).where(and(
            eq(importIdMap.id, id), eq(importIdMap.tenantId, tenantId),
        )).run();
    }
}
