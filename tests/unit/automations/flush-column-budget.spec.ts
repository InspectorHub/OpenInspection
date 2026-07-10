import { describe, it, expect } from 'vitest';
import { getTableColumns, is, Table } from 'drizzle-orm';
import { FLUSH_SELECTION } from '../../../server/services/automation/delivery';

// Cloudflare D1 caps a result set at 100 columns; overflowing it throws
// "too many columns in result set" (SQLITE_ERROR 7500). The automation flush
// joins automation_logs + automations + inspections + tenants. Selecting the
// WHOLE inspections row (70+ columns) pushed the total past the cap and failed
// EVERY cron tick (`[cron] automation flush failed`). FLUSH_SELECTION narrows
// `inspection` to the FlushInspection column set to stay under the cap; this test
// fails if a future change re-selects a whole wide table into the join.
function columnCount(value: unknown): number {
    if (is(value, Table)) return Object.keys(getTableColumns(value)).length;
    return Object.keys(value as Record<string, unknown>).length; // narrowed projection record
}

describe('automation flush column budget', () => {
    it('keeps the 4-table join result under D1 100-column cap (with margin)', () => {
        const total = Object.values(FLUSH_SELECTION).reduce((n, v) => n + columnCount(v), 0);
        expect(total).toBeLessThanOrEqual(90);
    });

    it('does not select the whole inspections row', () => {
        // inspection must be a narrowed projection record, never the wide table.
        expect(is(FLUSH_SELECTION.inspection, Table)).toBe(false);
    });
});
