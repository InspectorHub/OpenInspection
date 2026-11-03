/**
 * Money fields are classified from the table definition: every `_cents` column must have a key that `isMoneyField` recognises, so that
 * redaction and the write guard cover it. A column that is not an amount is listed in NOT_MONEY with its reason.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableColumns, is } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, it, expect } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { isMoneyField, redactMoney } from '../../../server/lib/auth/money-redaction';

/** `table.key` -> why a `_cents` column is not an amount. Each entry must match a real column (checked below). */
const NOT_MONEY: Record<string, string> = {};

const SCHEMA_DIR = join(process.cwd(), 'server/lib/db/schema');
const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));

const centColumns = (): Array<{ table: string; key: string; column: string }> => {
    const out: Array<{ table: string; key: string; column: string }> = [];
    for (const [exportName, value] of Object.entries(schema)) {
        if (!is(value, SQLiteTable)) continue;
        for (const [key, column] of Object.entries(getTableColumns(value))) {
            if (column.name.endsWith('_cents')) out.push({ table: exportName, key, column: column.name });
        }
    }
    return out;
};

describe('money columns and the redactor', () => {
    it('finds the money columns (the list below is not empty, and includes the inspection price and discount)', () => {
        const found = centColumns().map((c) => `${c.table}.${c.key}`);
        expect(found.length).toBeGreaterThan(10);
        expect(found).toContain('inspections.price');
        expect(found).toContain('inspections.discountAmount');
    });

    it('every `_cents` column is recognised by its key', () => {
        const missed = centColumns().filter((c) => !(`${c.table}.${c.key}` in NOT_MONEY) && !isMoneyField(c.key)).map((c) => `${c.table}.${c.key} (${c.column})`);
        expect(missed).toEqual([]);
    });

    it('looks at every table declared under the schema directory, not only the ones the index re-exports', () => {
        const declared = sourceFiles(SCHEMA_DIR).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/export const (\w+) = sqliteTable\(/g)].map((m) => m[1]));
        const seen = Object.entries(schema).filter(([, v]) => is(v, SQLiteTable)).map(([k]) => k);
        expect(declared.length).toBeGreaterThan(50);
        expect(declared.filter((n) => !seen.includes(n))).toEqual([]);
    });

    it('every NOT_MONEY entry names a real column', () => {
        const all = new Set(centColumns().map((c) => `${c.table}.${c.key}`));
        expect(Object.keys(NOT_MONEY).filter((k) => !all.has(k))).toEqual([]);
        for (const reason of Object.values(NOT_MONEY)) expect(reason.length).toBeGreaterThan(10);
    });

    it('service lines drop the catalog price and the override without the fee capability', () => {
        const lines = [{ id: 'l', serviceId: 's', name: 'Radon', priceCents: 1, priceSnapshot: 1, priceOverride: null }];
        const without = redactMoney({ services: lines }, { inspectionFees: false, companyFinance: false }, 'inspectionFees');
        expect(without).toEqual({ services: [{ id: 'l', serviceId: 's', name: 'Radon' }] });
        expect(redactMoney({ services: lines }, { inspectionFees: true, companyFinance: false }, 'inspectionFees')).toEqual({ services: lines });
    });

    it('would notice a money column under an unknown key (the control for the check above)', () => {
        expect(isMoneyField('aFeeNobodyListed')).toBe(false);
        expect(isMoneyField('discountAmount')).toBe(true);
        expect(isMoneyField('depositRequiredCents')).toBe(true);
    });

    it('does not take a key that merely starts like a money key', () => {
        for (const key of ['discountCodeId', 'discountReason', 'priceList', 'pricing', 'center']) expect(isMoneyField(key), key).toBe(false);
    });

    it('drops the discount for a caller without the fee capability and keeps it for one with it', () => {
        const row = { id: 'i', price: 1, discountAmount: 2, depositRequiredCents: 3, discountCodeId: 'code' };
        const without = redactMoney(row, { inspectionFees: false, companyFinance: false }, 'inspectionFees');
        expect(without).toEqual({ id: 'i', discountCodeId: 'code' });
        expect(redactMoney(row, { inspectionFees: true, companyFinance: false }, 'inspectionFees')).toEqual(row);
    });
});
