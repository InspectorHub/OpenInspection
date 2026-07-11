// Commercial PCA Phase C — xlsx workbook builder test. Asserts the returned
// bytes are a well-formed zip (PK header) rather than parsing the workbook
// contents; the row-shape logic mirrors the already-tested CSV builder.
import { describe, it, expect } from 'vitest';
import { costTablesToXlsxBuffer } from '../../../server/lib/pca-costs-xlsx';
import type { CostTables } from '../../../server/lib/pca-costs';

const tables: CostTables = {
    table1: {
        immediate: [{
            item: {
                id: 'a', system: 'roof', component: 'membrane', location: '', action: 'replace',
                costMethod: 'lump_sum', quantity: null, uom: null, unitCostCents: null,
                lumpSumCents: 500000, eul: null, effAge: null, rul: null,
                suggestedRemedy: 'Replace', bucket: 'immediate', sectionRef: null,
                photoRef: null, sortOrder: 0,
            },
            total: 500000,
        }],
        shortTerm: [], immediateTotalCents: 500000, shortTermTotalCents: 0,
    },
    reserveSchedule: null,
    rollup: { immediateCents: 500000, shortTermCents: 0, reserveCents: 0 },
    droppedCount: 0,
};

describe('costTablesToXlsxBuffer', () => {
    it('produces a non-trivial xlsx (PK zip header)', async () => {
        const buf = await costTablesToXlsxBuffer(tables);
        const bytes = new Uint8Array(buf);
        expect(bytes.length).toBeGreaterThan(100);
        // xlsx is a zip — first two bytes are 'P','K' (0x50, 0x4b)
        expect(bytes[0]).toBe(0x50);
        expect(bytes[1]).toBe(0x4b);
    });
});
