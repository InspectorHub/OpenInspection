/**
 * Import id-map service for the data-package import API.
 *
 * Every row an import creates or maps gets one (package, table, source id) ->
 * new id entry. The map is the anchor for apply idempotency (a mapped row is
 * skipped on replay), revert (the delete list), the free-tier quota exclusion
 * and the read-only marker on imported inspections. The marker is never
 * removed.
 *
 * Writes are idempotent via the DB unique index on
 * (tenant_id, package_id, table_name, source_id): replaying a key writes nothing
 * and never overwrites an existing mapping. Every read and write is scoped by
 * the tenant id the caller passes from the verified session — never by a value
 * from the package.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { DrizzleDB } from '../../lib/db/scoped';
import { importIdMap, type ImportIdMapRow } from '../../lib/db/schema/data-package';

export interface IdMapEntry {
    table: string;
    sourceId: string;
    newId: string;
}

export interface ImportIdMapDeps {
    now: () => number;
    genId: () => string;
}

/** D1 caps bound parameters per statement at 100; leave headroom for the fixed predicates. */
const MAX_LOOKUP_IDS = 90;
/** import_id_map has 7 columns, so at most floor(100 / 7) rows fit one INSERT. */
const MAX_INSERT_ROWS = 14;

export class ImportIdMapService {
    constructor(
        private readonly db: DrizzleDB,
        private readonly deps: ImportIdMapDeps,
    ) {}

    /** Look up one mapping. */
    async get(
        tenantId: string, packageId: string, table: string, sourceId: string,
    ): Promise<ImportIdMapRow | null> {
        const rows = await this.db.select().from(importIdMap).where(and(
            eq(importIdMap.tenantId, tenantId),
            eq(importIdMap.packageId, packageId),
            eq(importIdMap.tableName, table),
            eq(importIdMap.sourceId, sourceId),
        )).limit(1).all();
        return rows[0] ?? null;
    }

    /** Look up many mappings by source id in one tenant/package/table. */
    async getMany(
        tenantId: string, packageId: string, table: string, sourceIds: readonly string[],
    ): Promise<Map<string, string>> {
        const out = new Map<string, string>();
        if (sourceIds.length === 0) return out;
        // Chunk to stay under D1's per-statement bound-parameter cap.
        for (let i = 0; i < sourceIds.length; i += MAX_LOOKUP_IDS) {
            const part = sourceIds.slice(i, i + MAX_LOOKUP_IDS);
            const rows = await this.db.select().from(importIdMap).where(and(
                eq(importIdMap.tenantId, tenantId),
                eq(importIdMap.packageId, packageId),
                eq(importIdMap.tableName, table),
                inArray(importIdMap.sourceId, [...part]),
            )).all();
            for (const row of rows) out.set(row.sourceId, row.newId);
        }
        return out;
    }

    /**
     * Insert mappings in bulk. Keys already present are skipped, not overwritten;
     * returns the number of rows actually inserted. Callers rely on this for
     * row-granular idempotency and resume.
     */
    async putMany(tenantId: string, packageId: string, entries: readonly IdMapEntry[]): Promise<number> {
        if (entries.length === 0) return 0;
        // Skip keys already mapped so onConflictDoNothing only sees new rows,
        // and the returned count is exact even on D1 where meta.changes varies.
        const keysByTable = new Map<string, string[]>();
        for (const e of entries) {
            const list = keysByTable.get(e.table) ?? [];
            list.push(e.sourceId);
            keysByTable.set(e.table, list);
        }
        const existing = new Set<string>();
        for (const [table, ids] of keysByTable) {
            const found = await this.getMany(tenantId, packageId, table, ids);
            for (const id of found.keys()) existing.add(`${table}\u0000${id}`);
        }
        const rows = entries
            .filter((e) => !existing.has(`${e.table}\u0000${e.sourceId}`))
            .map((e) => ({
                id: this.deps.genId(),
                tenantId,
                packageId,
                tableName: e.table,
                sourceId: e.sourceId,
                newId: e.newId,
                createdAt: new Date(this.deps.now()),
            }));
        if (rows.length === 0) return 0;
        for (let i = 0; i < rows.length; i += MAX_INSERT_ROWS) {
            await this.db.insert(importIdMap).values(rows.slice(i, i + MAX_INSERT_ROWS)).onConflictDoNothing().run();
        }
        return rows.length;
    }

    /** All mappings for one package — the revert list. */
    async listByPackage(tenantId: string, packageId: string): Promise<ImportIdMapRow[]> {
        return this.db.select().from(importIdMap).where(and(
            eq(importIdMap.tenantId, tenantId),
            eq(importIdMap.packageId, packageId),
        )).all();
    }

    /** Quota / read-only marker: is this inspection id an imported one? */
    async isImportedInspection(tenantId: string, newId: string): Promise<boolean> {
        const rows = await this.db.select({ id: importIdMap.id }).from(importIdMap).where(and(
            eq(importIdMap.tenantId, tenantId),
            eq(importIdMap.tableName, 'inspections'),
            eq(importIdMap.newId, newId),
        )).limit(1).all();
        return rows.length > 0;
    }
}
