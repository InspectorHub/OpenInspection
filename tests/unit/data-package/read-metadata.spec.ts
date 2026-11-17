/**
 * Read metadata layered on the table classification (1a) for the dumb Worker
 * read API. Every exportable table must have a usable keyset, the whitelisted
 * columns must agree with the classification, and the documented exceptions
 * (e-sign chain order, large blob columns, raw JSON) must hold.
 */
import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { CLASSIFICATION } from '../../../server/lib/data-package/classification';
import { columnDisposition } from '../../../server/lib/data-package/classification-types';
import {
    TABLE_READ_META,
    TABLE_READ_META_BY_NAME,
    TABLES_WITHOUT_KEYSET,
    pageCeilings,
} from '../../../server/lib/data-package/read-metadata';

describe('table read metadata', () => {
    it('covers exactly the exportable tables, once each', () => {
        const exportable = CLASSIFICATION
            .filter((e) => e.disposition === 'export' || e.disposition === 'archive' || e.disposition === 'partial')
            .map((e) => tableDbName(e));
        const metaNames = TABLE_READ_META.map((m) => m.table);
        expect(new Set(metaNames).size).toBe(metaNames.length);
        expect([...metaNames].sort()).toEqual([...exportable].sort());
    });

    it('gives every exportable table a usable keyset', () => {
        expect(TABLES_WITHOUT_KEYSET).toEqual([]);
    });

    it('whitelists exactly the included columns from the classification', () => {
        for (const e of CLASSIFICATION) {
            if (e.disposition !== 'export' && e.disposition !== 'archive' && e.disposition !== 'partial') continue;
            const meta = TABLE_READ_META_BY_NAME.get(tableDbName(e))!;
            const cols = getTableColumns(e.table) as Record<string, { name: string }>;
            const expected = Object.entries(cols)
                .filter(([prop]) => columnDisposition(e, prop) === 'include')
                .map(([, col]) => col.name)
                .sort();
            expect([...meta.columns].sort(), `${tableDbName(e)} columns`).toEqual(expected);
        }
    });

    it('reads the e-sign evidence chain in created_at, rowid order', () => {
        const esign = TABLE_READ_META_BY_NAME.get('esign_audit_logs')!;
        expect(esign.keyset).toEqual(['created_at', 'rowid']);
        expect(esign.usesRowid).toBe(true);
        expect(esign.blobColumns.map((c) => c.name)).toContain('payload_json');
    });

    it('returns storage JSON verbatim for inspection results', () => {
        expect(TABLE_READ_META_BY_NAME.get('inspection_results')!.rawJsonColumns).toContain('data');
    });

    it('marks every large payload column, including the schema\'s only BLOB', () => {
        // `inspection_results` holds both the large results JSON and the only
        // true SQLite BLOB in the schema (the authoritative Yjs `ydoc_state`).
        // `inspections` has no large payload column of its own.
        const results = TABLE_READ_META_BY_NAME.get('inspection_results')!;
        expect([...results.blobColumns.map((c) => c.name)].sort()).toEqual(['data', 'ydoc_state']);
        const esign = TABLE_READ_META_BY_NAME.get('esign_audit_logs')!;
        expect(esign.blobColumns.map((c) => c.name)).toContain('payload_json');
        expect(TABLE_READ_META_BY_NAME.get('inspections')!.blobColumns).toEqual([]);
    });

    it('cuts the row budget to a quarter on tables with a large blob column', () => {
        const withBlob = TABLE_READ_META_BY_NAME.get('inspection_results')!;
        const withoutBlob = TABLE_READ_META_BY_NAME.get('inspections')!;
        const freeWith = pageCeilings(withBlob, 'worker-free');
        const freeWithout = pageCeilings(withoutBlob, 'worker-free');
        expect(freeWith.maxPageRows).toBe(Math.floor(freeWithout.maxPageRows / 4));
        expect(freeWithout.maxPageBytes).toBe(96 * 1024);
        expect(pageCeilings(withoutBlob, 'worker-paid').maxPageRows).toBe(1000);
    });

    it('every blob and raw-JSON column is actually in the whitelist', () => {
        for (const m of TABLE_READ_META) {
            const names = new Set(m.columns);
            for (const c of m.blobColumns) expect(names.has(c.name), `${m.table}.${c.name} blob`).toBe(true);
            for (const c of m.rawJsonColumns) expect(names.has(c), `${m.table}.${c} rawJson`).toBe(true);
        }
    });
});

// getTableName, re-exported locally to keep the assertions readable.
import { getTableName } from 'drizzle-orm';
function tableDbName(e: (typeof CLASSIFICATION)[number]): string {
    return getTableName(e.table);
}
