/**
 * Import apply engine — writes one batch of one table, row by row.
 *
 * Core invariants (all enforced here, not trusted from the client):
 *  - tenant scope comes from the job, never from a forged tenant_id in a row;
 *  - apply is idempotent by source id: a row already mapped is skipped;
 *  - every reference to another package table is rewritten through the id-map;
 *  - a row whose parent was never imported is reported and NOT created (no
 *    orphan);
 *  - keep-ids keeps the source id, rewrite mode mints a fresh one;
 *  - only plain INSERTs are issued: no createInspection / automation / mail /
 *    notification path is ever constructed.
 *
 * Values are written verbatim from the package into the exact whitelisted
 * columns (timestamp_ms as integer, json columns as their stored text). The
 * shared row schema has already validated column names and scalar types.
 */
import { and, eq, sql, getTableName, getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import type { DrizzleDB } from '../../lib/db/scoped';
import { importIdMap } from '../../lib/db/schema/data-package';
import { CLASSIFICATION } from '../../lib/data-package/classification';
import { isRowTable } from '../../lib/data-package/row-schemas';
import { type ImportReportData, recordCreated, recordSkipped, recordRejected } from '../../lib/data-package/import-report';
import type { RowRejection } from '../../lib/data-package/import-report';

export interface ApplyDeps {
    now: () => number;
    genId: () => string;
    keepIds: boolean;
}

export interface ApplyResult {
    created: Record<string, number>;
    skipped: Record<string, number>;
    rejected: RowRejection[];
}

const tableObjects = new Map(
    CLASSIFICATION.map((e) => [getTableName(e.table), e.table] as const),
);

/** The package's JSON shape for a stored BLOB column. */
function isBufferShape(v: unknown): v is { data: number[] } {
    return typeof v === 'object' && v !== null
        && (v as { type?: unknown }).type === 'Buffer'
        && Array.isArray((v as { data?: unknown }).data);
}

export class DataPackageApplyService {
    constructor(
        private readonly db: DrizzleDB,
        private readonly deps: ApplyDeps,
    ) {}

    /** Foreign-key child columns, with the package table each one references. */
    private parentRefs(table: string): { column: string; parentTable: string }[] {
        const obj = tableObjects.get(table);
        if (!obj) return [];
        const fks = getTableConfig(obj).foreignKeys ?? [];
        const out: { column: string; parentTable: string }[] = [];
        for (const fk of fks) {
            const ref = fk.reference();
            const parent = ref.foreignTable ? getTableName(ref.foreignTable) : null;
            const cols = (ref.columns ?? []) as { name: string }[]; // child columns hold the parent id
            if (parent && parent !== 'tenants' && isRowTable(parent)) {
                for (const col of cols) out.push({ column: col.name, parentTable: parent });
            }
        }
        return out;
    }

    async applyBatch(
        tenantId: string,
        packageId: string,
        table: string,
        rows: readonly Record<string, unknown>[],
        report?: ImportReportData,
    ): Promise<ApplyResult> {
        if (!isRowTable(table)) throw new Error(`table is not importable: ${table}`);
        const result: ApplyResult = { created: {}, skipped: {}, rejected: [] };
        const tableObj = tableObjects.get(table)!;
        const columnTypes = new Map<string, string>(
            Object.values(getTableColumns(tableObj) as Record<string, { name: string; dataType: string }>)
                .map((c) => [c.name, c.dataType]),
        );
        const allowed = new Set(columnTypes.keys());
        const parentRefs = this.parentRefs(table);

        for (const row of rows) {
            const sourceId = String(row['id'] ?? '');
            // Idempotency: already mapped (by the source id) → skip.
            const existing = await this.db.select({ newId: importIdMap.newId }).from(importIdMap).where(and(
                eq(importIdMap.tenantId, tenantId), eq(importIdMap.packageId, packageId),
                eq(importIdMap.tableName, table), eq(importIdMap.sourceId, sourceId),
            )).limit(1).all();
            if (existing.length > 0) {
                result.skipped[table] = (result.skipped[table] ?? 0) + 1;
                if (report) recordSkipped(report, table);
                continue;
            }

            // Parent resolution: every FK to another package table must already
            // be mapped, else the row is rejected rather than left an orphan.
            let failingColumn: string | null = null;
            const rewritten: Record<string, unknown> = { ...row };
            for (const { column, parentTable } of parentRefs) {
                const foreignValue = rewritten[column];
                if (foreignValue === null || foreignValue === undefined) continue;
                // Scope the lookup to the referenced table: a newId alone is not
                // unique across tables, so an unscoped match could point at the
                // wrong parent and silently create a cross-table link.
                const mapped = await this.db.select({ newId: importIdMap.newId }).from(importIdMap).where(and(
                    eq(importIdMap.tenantId, tenantId), eq(importIdMap.packageId, packageId),
                    eq(importIdMap.tableName, parentTable),
                    eq(importIdMap.sourceId, String(foreignValue)),
                )).limit(1).all();
                if (mapped.length === 0) { failingColumn = column; break; }
                // If the parent was rewritten, the child must carry the NEW id.
                rewritten[column] = mapped[0]!.newId;
            }
            if (failingColumn) {
                const code = `missing_parent:${failingColumn}`;
                result.rejected.push({ table, sourceId, code });
                if (report) recordRejected(report, { table, sourceId, code });
                continue;
            }

            // Tenant scope + id decision.
            rewritten['tenant_id'] = tenantId;
            const newId = this.deps.keepIds ? sourceId : this.deps.genId();
            if (allowed.has('id')) rewritten['id'] = newId;

            // Build a raw INSERT over exactly the allowed, present columns.
            // BLOB columns arrive from the package as {type:'Buffer',data:[...]};
            // restore them to bytes so a keep-ids import preserves ydoc_state
            // verbatim instead of storing a JSON string.
            const entries = Object.entries(rewritten)
                .filter(([k, v]) => allowed.has(k) && v !== undefined)
                .map(([k, v]): [string, unknown] => {
                    if (columnTypes.get(k) === 'buffer' && isBufferShape(v)) {
                        return [k, Uint8Array.from(v.data)];
                    }
                    return [k, v];
                });
            const colSql = entries.map(([k]) => sql.raw(`"${k.replace(/"/g, '')}"`));
            const valSql = entries.map(([, v]) => sql`${v}`);
            try {
                await this.db.run(sql`insert into ${sql.raw(`"${table.replace(/"/g, '')}"`)} (${sql.join(colSql, sql`, `)}) values (${sql.join(valSql, sql`, `)})`);
            } catch (err) {
                // One bad row never fails the whole batch. Report it; no mapping
                // is written, so a retry will try again (idempotency preserved).
                const code = this.deps.keepIds && /UNIQUE|PRIMARY/i.test(String(err)) ? 'id_collision' : 'insert_failed';
                result.rejected.push({ table, sourceId, code });
                if (report) recordRejected(report, { table, sourceId, code });
                continue;
            }

            // Record the mapping (the idempotency/revert anchor).
            await this.db.insert(importIdMap).values([{
                id: `map:${this.deps.genId()}`, tenantId, packageId, tableName: table,
                sourceId, newId, createdAt: new Date(this.deps.now()),
            }]).run();

            result.created[table] = (result.created[table] ?? 0) + 1;
            if (report) recordCreated(report, table);
        }
        return result;
    }
}
