import { describe, it, expect } from 'vitest';
import { paginationQuerySchema, PaginatedMetaSchema, buildMeta } from '../../server/lib/validations/pagination.schema';

describe('paginationQuerySchema', () => {
    it('defaults page=1 pageSize=50 when omitted', () => {
        expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 50 });
    });
    it('coerces numeric strings (URL query)', () => {
        expect(paginationQuerySchema.parse({ page: '2', pageSize: '25' })).toEqual({ page: 2, pageSize: 25 });
    });
    it('rejects pageSize outside {12,25,50,100}', () => {
        expect(() => paginationQuerySchema.parse({ pageSize: 30 })).toThrow();
    });
    it('rejects page < 1', () => {
        expect(() => paginationQuerySchema.parse({ page: 0 })).toThrow();
    });
});

describe('buildMeta', () => {
    it('computes totalPages with ceiling division', () => {
        expect(buildMeta({ total: 13, page: 1, pageSize: 12 })).toEqual({
            total: 13, page: 1, pageSize: 12, totalPages: 2,
        });
    });
    it('totalPages is 1 when total <= pageSize', () => {
        expect(buildMeta({ total: 0,  page: 1, pageSize: 50 }).totalPages).toBe(1);
        expect(buildMeta({ total: 50, page: 1, pageSize: 50 }).totalPages).toBe(1);
    });
});

describe('PaginatedMetaSchema', () => {
    it('round-trips a valid meta object', () => {
        const m = { total: 100, page: 2, pageSize: 25, totalPages: 4 };
        expect(PaginatedMetaSchema.parse(m)).toEqual(m);
    });
});
