import { describe, it, expect } from 'vitest';
import { extractInspectionIdFromPath } from '../../server/features/tenant-routing/resolve-by-inspection-id';

describe('extractInspectionIdFromPath', () => {
    it('matches page and API forms', () => {
        expect(extractInspectionIdFromPath('/invoice/abc-123')).toBe('abc-123');
        expect(extractInspectionIdFromPath('/api/public/inspections/abc-123/pay-intent')).toBe('abc-123');
        expect(extractInspectionIdFromPath('/api/public/inspections/abc-123/invoice')).toBe('abc-123');
    });
    it('ignores everything else', () => {
        expect(extractInspectionIdFromPath('/report/t/x')).toBeNull();
        expect(extractInspectionIdFromPath('/invoice/')).toBeNull();
        expect(extractInspectionIdFromPath('/api/public/verify/x')).toBeNull();
    });
});
