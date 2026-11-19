/**
 * Import-plan tests: the hand-maintained tier order must cover every row-table
 * exactly once, and must never write a row before a row-table it references.
 */
import { describe, it, expect } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { IMPORT_TIERS, buildImportPlan, assertPlanCoverage } from '../../../server/lib/data-package/import-plan';
import { rowTableNames } from '../../../server/lib/data-package/row-schemas';
import { CLASSIFICATION } from '../../../server/lib/data-package/classification';

const packageTables = new Set(rowTableNames());
const tablesByName = new Map(
    CLASSIFICATION.map((e) => [getTableName(e.table), e.table] as const),
);

describe('import plan', () => {
    it('covers every row table exactly once, no more, no less', () => {
        expect(() => assertPlanCoverage()).not.toThrow();
        const flat = IMPORT_TIERS.flat();
        expect(new Set(flat).size).toBe(flat.length);
        expect(new Set(flat)).toEqual(packageTables);
    });

    it('writes every row-table at or after all of its row-table parents', () => {
        const plan = buildImportPlan();
        const violations: string[] = [];
        for (const [name, table] of tablesByName) {
            if (!packageTables.has(name)) continue;
            const fks = (getTableConfig(table as any) as any).foreignKeys ?? [];
            for (const fk of fks) {
                const ref = fk.reference();
                const parent = ref.foreignTable ? getTableName(ref.foreignTable) : null;
                if (!parent || !packageTables.has(parent)) continue; // parent not in the package
                if (parent === name) continue; // self-reference
                if ((plan.tierOf.get(parent) ?? 0) > (plan.tierOf.get(name) ?? 0)) {
                    violations.push(`${name} (tier ${plan.tierOf.get(name)}) before parent ${parent} (tier ${plan.tierOf.get(parent)})`);
                }
            }
        }
        expect(violations).toEqual([]);
    });

    it('exposes a stable flat order', () => {
        const plan = buildImportPlan();
        expect(plan.order.length).toBe(packageTables.size);
        expect(plan.order[0]).toBe('tenants');
    });
});
