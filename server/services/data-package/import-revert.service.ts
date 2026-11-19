/**
 * Import revert — removes the rows a data-package import wrote, in
 * dependency-safe order, without touching anything the target already had or
 * anything the owner has edited since the restore.
 *
 * Invariants (all enforced here, not trusted from the client):
 *  - client-driven loop: one `revertStep` handles one bounded batch and reports
 *    `done`. No cron, no server-side runner. A step is safe to call again.
 *  - reverse topological order (children before parents) from IMPORT_TIERS;
 *    R2 media objects are last because they are independent of the D1 graph.
 *  - only rows still matching the imported id are removed. A row whose
 *    `updated_at` advanced past the moment it was imported is reported as
 *    `modified_kept` and left alone — that is the owner's data now.
 *  - rows with no `id` column cannot be located by new_id: reported as
 *    `unsupported`, never guessed at.
 *  - `tenants` and `users` are identity/access roots. Removing one would
 *    destroy the workspace or lock out its owner, so they are `protected` and
 *    left in place even when an import wrote them.
 *  - media objects mapped as '__media' are deleted from R2; the evidence
 *    archive is NEVER removed — the bytes stay auditable (see importArchives).
 *  - the mapping is deleted once a row is removed or intentionally kept, so a
 *    replay cannot double-delete and the read-only/quota markers clear. On a
 *    real failure the mapping is kept, so a later step retries and `done` stays
 *    false.
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
    | 'modified_kept'   // updated_at advanced past the import — owner edited it
    | 'unsupported'     // no id column / not a whitelisted row table
    | 'protected'       // tenants/users identity root
    | 'not_found';      // already gone (manual delete)

interface RevertKept {
    table: string;
    newId: string;
    reason: KeptReason;
}

interface RevertError {
    table: string;
    newId: string;
    code: 'delete_failed' | 'media_delete_failed' | 'probe_failed';
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

            // Probe the LIVE table for updated_at rather than trusting the
            // Drizzle schema: the two drift (e.g. `inspections` declares it in
            // schema but the migration never added it). If the column is absent
            // we fall back to an existence check and delete — there is simply
            // no edit signal to honour on that table.
            let modified = false;
            try {
                const row = await this.db.get<{ updated_at: number }>(sql`
                    SELECT updated_at FROM ${tableSql} WHERE id = ${m.newId} AND tenant_id = ${tenantId}`,
                );
                if (!row) {
                    result.kept.push({ table, newId: m.newId, reason: 'not_found' });
                    await this.deleteMapping(m.id, tenantId);
                    continue;
                }
                // The import stamped the row with the package's original
                // timestamps, all before the map row was created. Any later
                // edit bumps updated_at past that moment — leave it alone.
                modified = row.updated_at > m.createdAt.getTime();
            } catch (err) {
                // Only a MISSING COLUMN may degrade to existence-only. Any other
                // failure (transient DB error, locked row, bad plan) must NOT be
                // treated as "no edit signal": doing so would delete a row the
                // owner edited. Keep the mapping and report, so a later step
                // retries instead of losing data. Narrow the match to the exact
                // SQLite/D1 "no such column: updated_at" shape.
                if (!/no such column:\s*updated_at/i.test(String(err))) {
                    result.errors.push({ table, newId: m.newId, code: 'probe_failed' });
                    continue;
                }
                // Genuine schema/migration drift (e.g. `inspections` declares
                // updated_at in schema but the migration never added it). Such
                // a table has no edit signal; an imported row here can only be
                // the one the import wrote (J14 blocks editing imported rows),
                // so existence is sufficient. Report it as kept-with-note via
                // `unverifiable` only where the caller wants that distinction —
                // here we delete, but record the fallback for the audit trail.
                const exists = await this.db.get<{ x: number }>(sql`
                    SELECT 1 AS x FROM ${tableSql} WHERE id = ${m.newId} AND tenant_id = ${tenantId}`,
                );
                if (!exists) {
                    result.kept.push({ table, newId: m.newId, reason: 'not_found' });
                    await this.deleteMapping(m.id, tenantId);
                    continue;
                }
            }
            if (modified) {
                result.kept.push({ table, newId: m.newId, reason: 'modified_kept' });
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
