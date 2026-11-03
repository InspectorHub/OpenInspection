/**
 * The inspection record keys the response schemas document (server/lib/validations/inspection/inspection-row.ts) are checked
 * against the table they come from, so a documented key cannot be a typo or outlive its column.
 */
import { getTableColumns } from 'drizzle-orm';
import { describe, it, expect } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { INSPECTION_COMPUTED_FIELDS, INSPECTION_COMPUTED_KEYS, INSPECTION_ROW_FIELDS } from '../../../server/lib/validations/inspection/inspection-row';
import { isMoneyField } from '../../../server/lib/auth/money-redaction';

const COLUMNS = new Set(Object.keys(getTableColumns(schema.inspections)));

/** Documented keys that are neither a column nor a declared computed key. */
function unknownKeys(documented: readonly string[]): string[] {
    return documented.filter((key) => !COLUMNS.has(key) && !INSPECTION_COMPUTED_KEYS.includes(key));
}

describe('the documented inspection record keys', () => {
    const documented = Object.keys(INSPECTION_ROW_FIELDS);

    it('are all columns of inspections', () => {
        expect(documented.length).toBeGreaterThan(40);
        expect(unknownKeys(documented)).toEqual([]);
    });

    it('control: a key that is neither a column nor a computed key is noticed', () => {
        expect(unknownKeys([...documented, 'aColumnThatDoesNotExist'])).toEqual(['aColumnThatDoesNotExist']);
    });

    it('keep the computed keys apart from the columns', () => {
        expect([...INSPECTION_COMPUTED_KEYS].sort()).toEqual(['clientPhone', 'signedByClient']);
        for (const key of INSPECTION_COMPUTED_KEYS) {
            expect(COLUMNS.has(key), key).toBe(false);
            expect(documented, key).not.toContain(key);
        }
        expect(Object.keys(INSPECTION_COMPUTED_FIELDS)).toEqual(INSPECTION_COMPUTED_KEYS);
    });

    it('leave the company id out of the published contract', () => {
        expect(documented).not.toContain('tenantId');
        expect(COLUMNS.has('tenantId')).toBe(true);
    });

    it('state that every money key is absent without the inspectionFees capability', () => {
        const money = documented.filter(isMoneyField);
        expect(money.sort()).toEqual(['depositRequiredCents', 'discountAmount', 'price']);
        for (const key of money) {
            const description = (INSPECTION_ROW_FIELDS as Record<string, { description?: string }>)[key]?.description ?? '';
            expect(description, key).toContain('ABSENT without the inspectionFees capability');
        }
    });

    it('make every key optional, so a server that predates a column stays valid', () => {
        for (const [key, field] of Object.entries(INSPECTION_ROW_FIELDS)) {
            expect(field.safeParse(undefined).success, key).toBe(true);
        }
    });
});
