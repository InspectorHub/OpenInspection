/**
 * Commercial PCA Phase C — xlsx workbook builder. Multi-sheet: Opinion of Cost
 * (TABLE 1) and, when enabled, Reserve Schedule (TABLE 2 year grid). Pure JS via
 * write-excel-file/universal (fflate-backed, no Node fs) — proven under workerd by
 * the Phase C isolate spike. Cents are converted to whole dollars for the sheet.
 */
import writeXlsxFile from 'write-excel-file/universal';
import type { CostTables } from './pca-costs';

const dollars = (cents: number) => Math.round(cents / 100);
type Cell = { value: string | number; type?: typeof String | typeof Number; fontWeight?: 'bold' };
const h = (value: string): Cell => ({ value, fontWeight: 'bold' });
const s = (value: string): Cell => ({ value, type: String });
const n = (value: number): Cell => ({ value, type: Number });

export async function costTablesToXlsxBuffer(tables: CostTables): Promise<ArrayBuffer> {
    const sheet1: Cell[][] = [
        [h('Item'), h('Qty'), h('Unit'), h('Unit Cost'), h('Immediate'), h('Short Term'), h('Comments')],
    ];
    for (const r of [...tables.table1.immediate, ...tables.table1.shortTerm]) {
        sheet1.push([
            s(r.item.component), n(r.item.quantity ?? 0), s(r.item.uom ?? ''),
            n(r.item.unitCostCents != null ? dollars(r.item.unitCostCents) : 0),
            n(r.item.bucket === 'immediate' ? dollars(r.total) : 0),
            n(r.item.bucket === 'short_term' ? dollars(r.total) : 0),
            s(r.item.suggestedRemedy),
        ]);
    }
    sheet1.push([
        h('Totals'), s(''), s(''), s(''),
        n(dollars(tables.table1.immediateTotalCents)), n(dollars(tables.table1.shortTermTotalCents)), s(''),
    ]);

    const sheets: Array<{ data: Cell[][]; sheet: string }> = [{ data: sheet1, sheet: 'Opinion of Cost' }];

    const rs = tables.reserveSchedule;
    if (rs) {
        const head: Cell[] = [h('Item'), h('EUL'), h('Eff Age'), h('RUL'), ...rs.years.map((y) => h(String(y))), h('Total')];
        const body: Cell[][] = rs.rows.map((row) => [
            s(row.item.component), n(row.item.eul ?? 0), n(row.item.effAge ?? 0), n(row.item.rul ?? 0),
            ...rs.years.map((y) => n(y === row.placementYear ? dollars(row.replacementCents) : 0)),
            n(dollars(row.replacementCents)),
        ]);
        const footUninflated: Cell[] = [h('Total Uninflated'), s(''), s(''), s(''), ...rs.uninflatedByYear.map((c) => n(dollars(c))), n(dollars(rs.totalUninflatedCents))];
        const footCumulative: Cell[] = [h('Cumulative Inflated'), s(''), s(''), s(''), ...rs.cumulativeInflatedByYear.map((c) => n(dollars(c))), n(dollars(rs.totalInflatedCents))];
        sheets.push({ data: [head, ...body, footUninflated, footCumulative], sheet: 'Reserve Schedule' });
    }

    const blob = await writeXlsxFile(sheets).toBlob();
    return blob.arrayBuffer();
}
