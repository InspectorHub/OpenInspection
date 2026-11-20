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
 *  - only rows still matching the imported id are removed. An inspection whose
 *    status timestamp (confirmed_at/unlocked_at/reports_generated_at) advanced
 *    past the import moment is "owner-edited": reported as `modified_kept`, the
 *    row stays, and its mapping is marked `kept` — NOT deleted — so it keeps
 *    its J14 read-only and free-tier quota exemption. Other tables still use
 *    their `updated_at` for the same judgement.
 *  - rows with no `id` column cannot be located by new_id: reported as
 *    `unsupported`, never guessed at.
 *  - `tenants` and `users` are identity/access roots. Removing one would
 *    destroy the workspace or lock out its owner, so they are `protected` and
 *    left in place even when an import wrote them.
 *  - media objects mapped as '__media' are deleted from R2; the evidence
 *    archive is NEVER removed — the bytes stay auditable (see importArchives).
 *  - the mapping is deleted once a row is removed or defensively dropped
 *    (protected/unsupported/not_found), so a replay cannot double-delete.
 *    `kept` mappings and rows left on a real failure stay out of the scope,
 *    but differ: kept ones are finished (excluded from `done`), failed ones
 *    must be retried (so `done` stays false only while an un-kept mapping
 *    remains for this package).
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
const INSPECTIONS_TABLE = 'inspections' as const;
const DEFAULT_STEP_LIMIT = 100;

/**
 * Inspection has no updated_at (in schema OR any migration). The only legal
 * post-import change is an internal status transition, which stamps one of these
 * columns with "now". A value past the import moment (the mapping's created_at)
 * means the row changed after restore. Names are literals, never from the map.
 */
const INSPECTION_STAMP_COLUMNS = ['confirmed_at', 'unlocked_at', 'reports_generated_at'] as const;

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
        const scope = and(
            eq(importIdMap.tenantId, tenantId),
            eq(importIdMap.packageId, packageId),
            eq(importIdMap.kept, false),
        );

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

            let modified = false;
            if (table === INSPECTIONS_TABLE) {
                // inspections has no updated_at. Its only legal post-import
                // change is an internal status transition that stamps one of
                // the status columns with "now". Build the SELECT from the
                // literal const names (never from the map's table_name).
                const cols = sql.join(
                    INSPECTION_STAMP_COLUMNS.map((c) => sql.raw(`"${c}"`)), sql`, `,
                );
                // These columns exist in the baseline migration, so a missing
                // column is not expected. Any error here is transient (locked
                // row, db down): report probe_failed and leave the mapping for a
                // later step, matching the non-inspection branch — never let it
                // abort the whole batch.
                let stamps: Record<(typeof INSPECTION_STAMP_COLUMNS)[number], number | null> | undefined;
                try {
                    stamps = await this.db.get<Record<(typeof INSPECTION_STAMP_COLUMNS)[number], number | null>>(sql`
                        SELECT ${cols} FROM ${tableSql} WHERE id = ${m.newId} AND tenant_id = ${tenantId}`,
                    );
                } catch {
                    result.errors.push({ table, newId: m.newId, code: 'probe_failed' });
                    continue;
                }
                if (!stamps) {
                    result.kept.push({ table, newId: m.newId, reason: 'not_found' });
                    await this.deleteMapping(m.id, tenantId);
                    continue;
                }
                const importMs = m.createdAt.getTime();
                modified = INSPECTION_STAMP_COLUMNS.some((c) => {
                    const v = stamps[c];
                    return v != null && v > importMs;
                });
            } else {
                // Other tables: probe the LIVE schema for updated_at. If absent,
                // degrade to existence-only (no edit signal on that table).
                try {
                    const row = await this.db.get<{ updated_at: number }>(sql`
                        SELECT updated_at FROM ${tableSql} WHERE id = ${m.newId} AND tenant_id = ${tenantId}`,
                    );
                    if (!row) {
                        result.kept.push({ table, newId: m.newId, reason: 'not_found' });
                        await this.deleteMapping(m.id, tenantId);
                        continue;
                    }
                    modified = row.updated_at > m.createdAt.getTime();
                } catch (err) {
                    // Only a MISSING COLUMN may degrade to existence-only. Any
                    // other failure (transient DB error, locked row, bad plan)
                    // must NOT be treated as "no edit signal": keep the mapping
                    // and report so a later step retries. Drizzle's D1 driver
                    // wraps the real message in `cause.message`; better-sqlite3
                    // surfaces it directly — check both.
                    const causeMsg = (err as { cause?: { message?: string } })?.cause?.message ?? '';
                    if (!/no such column/i.test(String(err) + ' ' + causeMsg)) {
                        result.errors.push({ table, newId: m.newId, code: 'probe_failed' });
                        continue;
                    }
                    const exists = await this.db.get<{ x: number }>(sql`
                        SELECT 1 AS x FROM ${tableSql} WHERE id = ${m.newId} AND tenant_id = ${tenantId}`,
                    );
                    if (!exists) {
                        result.kept.push({ table, newId: m.newId, reason: 'not_found' });
                        await this.deleteMapping(m.id, tenantId);
                        continue;
                    }
                }
            }
            if (modified) {
                result.kept.push({ table, newId: m.newId, reason: 'modified_kept' });
                // Preserve the mapping so J14 read-only + quota exemption last,
                // and mark it kept so it exits the revert scope/done check.
                await this.markKept(m.id, tenantId);
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

    /** Mark a mapping as owner-kept: it leaves the revert scope but stays as the
     *  import marker, so the row remains read-only and quota-exempt. */
    private async markKept(id: string, tenantId: string): Promise<void> {
        await this.db.update(importIdMap).set({ kept: true }).where(and(
            eq(importIdMap.id, id), eq(importIdMap.tenantId, tenantId),
        )).run();
    }
}
