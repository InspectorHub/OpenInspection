import { describe, it, expect } from 'vitest';
import { PatchItemFieldSchema, PatchPropertyFactSchema } from '../../server/lib/validations/inspection-patch.schema';

describe('PatchItemFieldSchema (subsystem B phase 3)', () => {
    it('accepts a rating field write', () => {
        const r = PatchItemFieldSchema.safeParse({ field: 'rating', value: 'defect', expectedVersion: 2 });
        expect(r.success).toBe(true);
    });

    it('accepts a notes field with optional force flag', () => {
        const r = PatchItemFieldSchema.safeParse({ field: 'notes', value: 'leak', expectedVersion: 0, force: true });
        expect(r.success).toBe(true);
    });

    it('rejects unknown field name', () => {
        const r = PatchItemFieldSchema.safeParse({ field: 'bogus', value: 'x', expectedVersion: 0 });
        expect(r.success).toBe(false);
    });

    it('rejects negative expectedVersion', () => {
        const r = PatchItemFieldSchema.safeParse({ field: 'rating', value: 'sat', expectedVersion: -1 });
        expect(r.success).toBe(false);
    });

    it('accepts null value (clear-rating semantics)', () => {
        const r = PatchItemFieldSchema.safeParse({ field: 'rating', value: null, expectedVersion: 3 });
        expect(r.success).toBe(true);
    });
});

describe('PatchPropertyFactSchema (subsystem B phase 3)', () => {
    it('accepts year_built integer write', () => {
        const r = PatchPropertyFactSchema.safeParse({ key: 'year_built', value: 1973, expectedVersion: 0 });
        expect(r.success).toBe(true);
    });

    it('rejects empty key', () => {
        const r = PatchPropertyFactSchema.safeParse({ key: '', value: 1973, expectedVersion: 0 });
        expect(r.success).toBe(false);
    });

    it('rejects key over 64 chars', () => {
        const r = PatchPropertyFactSchema.safeParse({ key: 'x'.repeat(65), value: 0, expectedVersion: 0 });
        expect(r.success).toBe(false);
    });
});
