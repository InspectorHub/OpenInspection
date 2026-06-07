import { describe, it, expect } from 'vitest';
import { extractInspectionIdFromPath } from '../../server/features/tenant-routing/resolve-by-inspection-id';

describe('extractInspectionIdFromPath', () => {
    it('matches page and API forms', () => {
        expect(extractInspectionIdFromPath('/r/abc-123/invoice')).toBe('abc-123');
        expect(extractInspectionIdFromPath('/r/abc-123/repair-request')).toBe('abc-123');
        expect(extractInspectionIdFromPath('/api/public/r/abc-123/pay-intent')).toBe('abc-123');
        expect(extractInspectionIdFromPath('/api/public/r/abc-123/invoice')).toBe('abc-123');
    });
    it('ignores everything else', () => {
        expect(extractInspectionIdFromPath('/report/t/x')).toBeNull();
        expect(extractInspectionIdFromPath('/r/')).toBeNull();
        expect(extractInspectionIdFromPath('/api/public/verify/x')).toBeNull();
    });
});

describe('repair-request data GET coverage', () => {
    it('extracts the id from /api/public/repair-request/:id', () => {
        expect(extractInspectionIdFromPath('/api/public/repair-request/abc-123')).toBe('abc-123');
    });
    it('the /email POST sibling extracts a non-id segment (harmless miss, not a crash)', () => {
        expect(extractInspectionIdFromPath('/api/public/repair-request/email')).toBe('email');
    });
});
