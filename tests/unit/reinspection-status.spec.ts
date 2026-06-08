import { describe, it, expect } from 'vitest';
import { DEFAULT_REINSPECTION_STATUSES, parseReinspectionStatuses, isOpenStatus } from '../../server/lib/reinspection-status';

describe('reinspection status config', () => {
    it('defaults to 3 neutral categories', () => {
        expect(DEFAULT_REINSPECTION_STATUSES.map(s => s.key)).toEqual(['resolved', 'not_resolved', 'not_inspected']);
        expect(DEFAULT_REINSPECTION_STATUSES.find(s => s.key === 'resolved')!.closed).toBe(true);
    });

    it('parse falls back to default on null/garbage', () => {
        expect(parseReinspectionStatuses(null)).toEqual(DEFAULT_REINSPECTION_STATUSES);
        expect(parseReinspectionStatuses('not json')).toEqual(DEFAULT_REINSPECTION_STATUSES);
    });

    it('parse accepts a valid custom list', () => {
        const custom = JSON.stringify([{ key: 'pass', label: 'Pass', closed: true }, { key: 'fail', label: 'Fail', closed: false }]);
        expect(parseReinspectionStatuses(custom)).toHaveLength(2);
    });

    it('isOpenStatus treats unknown/null keys as open', () => {
        expect(isOpenStatus('resolved', DEFAULT_REINSPECTION_STATUSES)).toBe(false);
        expect(isOpenStatus('not_resolved', DEFAULT_REINSPECTION_STATUSES)).toBe(true);
        expect(isOpenStatus(null, DEFAULT_REINSPECTION_STATUSES)).toBe(true);
        expect(isOpenStatus('bogus', DEFAULT_REINSPECTION_STATUSES)).toBe(true);
    });
});
