import { describe, expect, it } from 'vitest';
import { AUDIT_FAMILIES } from '../../../server/lib/audit-families';

describe('audit families', () => {
    it('has families at all — an empty list satisfies every assertion below', () => {
        expect(AUDIT_FAMILIES.length).toBeGreaterThan(20);
    });

    it('has no duplicates', () => {
        expect(new Set(AUDIT_FAMILIES).size).toBe(AUDIT_FAMILIES.length);
    });

    it('spells tenant_config one way', () => {
        expect(AUDIT_FAMILIES).toContain('tenant_config');
        expect(AUDIT_FAMILIES, 'the plural was one call site against nine').not.toContain('tenant_configs');
    });

    it('is snake_case throughout, so a family never has two spellings', () => {
        expect(AUDIT_FAMILIES.filter((f) => !/^[a-z][a-z0-9_]*$/.test(f))).toEqual([]);
    });
});
