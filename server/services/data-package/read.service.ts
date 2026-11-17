/**
 * E-1 row reader for the dumb data-package Worker API.
 *
 * Turns the classification-derived read metadata (`read-metadata.ts`) into the
 * two read endpoints the desktop client needs:
 *
 *  - `tables()`  — the whitelist + keyset + page ceilings for every exportable
 *    table. The column list comes ONLY from classification; withhold/reset/out
 *    columns never appear.
 *  - `readRows()` — one keyset page from a table, scoped to the job's tenant,
 *    with a per-table snapshot watermark (created_at <= snapshotAt where the
 *    table has that column), verbatim stored values (no JSON normalization),
 *    and a `next` cursor (the last row's keyset) for stateless continuation.
 *  - `readColumnChunk()` — a byte slice of one large blob column via SQL
 *    `substr()`, for clients that cannot hold the whole value in a row page.
 *
 * Every table/column identifier is taken from the validated metadata map and
 * emitted through `sql.identifier`, never from the request; every value is a
 * bound parameter. The table name and column name are checked against the
 * whitelist before any SQL is built, so a client cannot steer the query at an
 * arbitrary table or column. Tenant scoping always comes from the verified job,
 * never the cursor (which carries only keyset values).
 */
import { sql, type SQLWrapper } from 'drizzle-orm';
import type { DrizzleDB } from '../../lib/db/scoped';
import { TABLE_READ_META_BY_NAME, pageCeilings, type TableReadMeta, type ReadProfile } from '../../lib/data-package/read-metadata';
import { encodeCursor, decodeCursor, type CursorValue } from '../../lib/data-package/cursor';
import { Errors } from '../../lib/errors';

/** The cursor value kind for each keyset column. `rowid` and `created_at` are
 * SQLite integers (epoch ms for the latter); every other keyset in the package
 * is a text id. Kept in one place so encode and decode always agree. */
function keysetKinds(meta: TableReadMeta): ('string' | 'number')[] {
    return meta.keyset.map((k) => (k === 'rowid' || k === 'created_at') ? 'number' : 'string');
}

/** The response shape for GET /tables (plan §2.2). */
export interface TableDescriptor {
    table: string;
    disposition: TableReadMeta['disposition'];
    columns: string[];
    keyset: string[];
    maxPageRows: number;
    maxPageBytes: number;
    blobColumns: { property: string; name: string }[];
}

export interface ReadRowsResult {
    rows: Record<string, unknown>[];
    next: string | null;
    bytes: number;
    rowsScanned: number;
}

export class DataPackageReadService {
    constructor(private readonly db: DrizzleDB) {}

    /** Resolve a whitelisted table or throw NOT_FOUND (404). */
    private meta(table: string): TableReadMeta {
        const m = TABLE_READ_META_BY_NAME.get(table);
        if (!m) throw Errors.NotFound(`Table '${table}' is not part of the data package.`);
        return m;
    }

    /** Tenant predicate: normal tables filter on tenant_id; the tenants row is matched on id. */
    private tenantPredicate(meta: TableReadMeta, tenantId: string) {
        return meta.scope === 'tenant_row'
            ? sql`${sql.identifier('id')} = ${tenantId}`
            : sql`${sql.identifier('tenant_id')} = ${tenantId}`;
    }

    /** GET /tables: the exportable-table descriptors for a profile. */
    tables(profile: ReadProfile): TableDescriptor[] {
        return [...TABLE_READ_META_BY_NAME.values()].map((m) => {
            const caps = pageCeilings(m, profile);
            return {
                table: m.table,
                disposition: m.disposition,
                columns: [...m.columns],
                keyset: [...m.keyset],
                maxPageRows: caps.maxPageRows,
                maxPageBytes: caps.maxPageBytes,
                blobColumns: m.blobColumns.map((b) => ({ property: b.property, name: b.name })),
            };
        });
    }

    /**
     * Read one keyset page. `after` is an opaque cursor from a previous page;
     * `snapshotAtMs` is the job's watermark (rows created after it are excluded
     * where the table has created_at); `profile` picks the page ceilings.
     */
    async readRows(
        tenantId: string,
        table: string,
        after: string | undefined,
        limit: number,
        snapshotAtMs: number,
        profile: ReadProfile,
    ): Promise<ReadRowsResult> {
        const meta = this.meta(table);
        const caps = pageCeilings(meta, profile);
        const pageSize = Math.max(1, Math.min(Number.isFinite(limit) ? limit : caps.maxPageRows, caps.maxPageRows));

        let afterValues: CursorValue[] | null = null;
        if (after !== undefined && after !== '') {
            afterValues = decodeCursor(after, keysetKinds(meta));
            if (!afterValues) throw Errors.BadRequest('Invalid row cursor.');
        }

        const conditions = [this.tenantPredicate(meta, tenantId)];
        // Snapshot watermark: only tables with a physical created_at column can
        // be cut at a consistent instant. For the rest the cursor is the only
        // watermark. Derived from the schema, not the (mutable) whitelist.
        if (meta.hasCreatedAt) {
            conditions.push(sql`${sql.identifier('created_at')} <= ${snapshotAtMs}`);
        }
        if (afterValues) {
            conditions.push(this.keysetAfter(meta, afterValues));
        }

        // Select the whitelisted columns, PLUS any keyset column not already in
        // the whitelist (SQLite's implicit `rowid` for the e-sign chain). Keyset
        // values must be present on each row to build the next cursor; rowid is
        // a cursor-only key, never a data column returned to the client by name
        // in the descriptor, so it is not part of `columns`.
        const selectParts: SQLWrapper[] = meta.columns.map((c) => sql.identifier(c));
        const selected = new Set(meta.columns);
        for (const k of meta.keyset) {
            if (!selected.has(k)) {
                selectParts.push(sql`${sql.identifier(k)} AS ${sql.identifier(k)}`);
                selected.add(k);
            }
        }
        const selectSql = selectParts.length
            ? sql.join(selectParts, sql`, `)
            : sql`1`;
        const orderSql = sql.join(
            meta.keyset.map((k) => sql`${sql.identifier(k)} ASC`),
            sql`, `,
        );
        const whereSql = sql.join(conditions, sql` AND `);

        // Fetch one extra row to know whether a next page exists.
        const query = sql`SELECT ${selectSql} FROM ${sql.identifier(meta.table)} WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ${pageSize + 1}`;
        const raw = await this.db.all<Record<string, unknown>>(query);
        const hasMore = raw.length > pageSize;
        const page = hasMore ? raw.slice(0, pageSize) : raw;

        // Byte budget: stop before exceeding it, but always return at least one row
        // (a single oversized row is still delivered; the blob-chunk endpoint is the
        // escape hatch for values too large for a page).
        const rows: Record<string, unknown>[] = [];
        let bytes = 0;
        for (const row of page) {
            const rowBytes = approximateBytes(row);
            if (rows.length > 0 && bytes + rowBytes > caps.maxPageBytes) break;
            rows.push(row);
            bytes += rowBytes;
        }
        // A page can end for either reason: the row limit (more rows fetched)
        // or the byte budget (some fetched rows were held back). Both mean the
        // client must come back for the rest, keyed off the last row we DID
        // return — the held-back rows are simply re-served on the next page.
        const truncated = rows.length < page.length;

        let next: string | null = null;
        if ((hasMore || truncated) && rows.length > 0) {
            const last = rows[rows.length - 1]!;
            const keyValues = meta.keyset.map((k) => toCursorValue(last[k], k));
            next = encodeCursor(keyValues);
        }

        // Remove keyset-only helper columns (e.g. rowid) so a row contains only
        // whitelisted data columns; the keyset travels in the opaque cursor.
        const keysetOnly = meta.keyset.filter((k) => !meta.columns.includes(k));
        if (keysetOnly.length) {
            for (const row of rows) for (const k of keysetOnly) delete row[k];
        }
        return { rows, next, bytes, rowsScanned: raw.length };
    }

    /** Lexicographic keyset-after predicate: (k1,k2,...) > (v1,v2,...). */
    private keysetAfter(meta: TableReadMeta, values: CursorValue[]) {
        const parts: ReturnType<typeof sql>[] = [];
        for (let i = 0; i < meta.keyset.length; i++) {
            const eqPrev = sql.join(
                meta.keyset.slice(0, i).map((k, j) => sql`${sql.identifier(k)} = ${values[j]}`),
                sql` AND `,
            );
            const gt = sql`${sql.identifier(meta.keyset[i]!)} > ${values[i]}`;
            parts.push(i === 0 ? gt : sql`(${eqPrev}) AND ${gt}`);
        }
        return sql`(${sql.join(parts, sql` OR `)})`;
    }

    /** Read a byte slice of one large column for one row, addressed by its keyset. */
    async readColumnChunk(
        tenantId: string,
        table: string,
        column: string,
        keyCursor: string,
        offset: number,
        len: number,
    ): Promise<{ data: Uint8Array; totalBytes: number; nextOffset: number | null }> {
        const meta = this.meta(table);
        const blob = meta.blobColumns.find((b) => b.name === column);
        if (!blob) throw Errors.NotFound(`Column '${column}' is not a chunkable column of '${table}'.`);
        const kinds = keysetKinds(meta);
        const keys = decodeCursor(keyCursor, kinds);
        if (!keys) throw Errors.BadRequest('Invalid row key cursor.');
        if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(len) || len <= 0) {
            throw Errors.BadRequest('Invalid chunk offset or length.');
        }

        const keyWhere = sql.join(
            meta.keyset.map((k, i) => sql`${sql.identifier(k)} = ${keys[i]}`),
            sql` AND `,
        );
        const whereSql = sql`${this.tenantPredicate(meta, tenantId)} AND ${keyWhere}`;
        const chunkLen = Math.min(len, 4 * 1024 * 1024);
        // substr/length on TEXT count characters, but the chunk contract is in
        // bytes (the client slices a byte stream). CAST to BLOB makes both
        // byte-based for TEXT columns and is a no-op for the true BLOB column.
        const asBlob = sql`CAST(${sql.identifier(column)} AS BLOB)`;
        const row = await this.db.get<{ chunk: Uint8Array | null; total: number }>(sql`
            SELECT substr(${asBlob}, ${offset + 1}, ${chunkLen}) AS chunk,
                   length(${asBlob}) AS total
            FROM ${sql.identifier(meta.table)}
            WHERE ${whereSql}
            LIMIT 1
        `);
        if (!row) throw Errors.NotFound('Row not found.');
        const total = Number(row.total ?? 0);
        const nextOffset = offset + chunkLen < total ? offset + chunkLen : null;
        return { data: row.chunk ?? new Uint8Array(), totalBytes: total, nextOffset };
    }
}

/** Rough UTF-8 byte size of a row's values, for the page byte budget. */
function approximateBytes(row: Record<string, unknown>): number {
    let bytes = 0;
    for (const v of Object.values(row)) {
        if (v === null || v === undefined) continue;
        const s = typeof v === 'string' ? v : JSON.stringify(v);
        bytes += Buffer.byteLength(s, 'utf8');
    }
    return bytes;
}

/** Coerce a raw SQL value into the cursor value type expected for its keyset column. */
function toCursorValue(raw: unknown, column: string): CursorValue {
    if (column === 'rowid') return typeof raw === 'number' ? raw : Number(raw);
    if (typeof raw === 'number') return raw; // epoch-ms created_at
    if (raw instanceof Date) return raw.getTime();
    return String(raw);
}
