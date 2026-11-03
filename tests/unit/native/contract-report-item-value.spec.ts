/**
 * ReportItem.value is a union that may also be null. The null rides on the string branch, so a client generated from the
 * contract reads `string | null`; a branch that is only `{ nullable: true }` would be an untyped member of the union.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ReportDataFullSchema } from '../../../server/lib/validations/inspection/report-data.schema';

interface Schema { anyOf?: Array<Record<string, unknown>> }
const contract = JSON.parse(readFileSync('contracts/native-contract.openapi.json', 'utf8')) as { components: { schemas: Record<string, { properties: Record<string, Schema> }> } };

describe('ReportItem.value in the native contract', () => {
    const branches = contract.components.schemas['ReportItem']?.properties['value']?.anyOf ?? [];

    it('has only typed branches, and carries the null on the string branch', () => {
        expect(branches.length).toBe(4);
        for (const branch of branches) expect(branch['type'], JSON.stringify(branch)).toBeTypeOf('string');
        expect(branches[0]).toEqual({ type: 'string', nullable: true });
    });

    it('control: a branch that is only nullable is noticed', () => {
        const untyped = [...branches, { nullable: true }];
        expect(untyped.filter((branch) => typeof branch['type'] !== 'string')).toHaveLength(1);
    });

    it('still accepts each kind of value, null and absence', () => {
        const item = ReportDataFullSchema.shape.sections.element.shape.items.element.shape.value;
        for (const value of ['x', 3, true, ['a', 'b'], null, undefined]) expect(item.safeParse(value).success, String(value)).toBe(true);
        expect(item.safeParse({}).success).toBe(false);
    });
});
