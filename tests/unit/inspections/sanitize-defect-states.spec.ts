import { describe, it, expect } from 'vitest';
// sanitizeDefectStates is module-private; export it for testing if it isn't already.
// If still private, add `export` keyword on its declaration in inspection.service.ts.
import { sanitizeDefectStates } from '../../../server/services/inspection.service';

describe('sanitizeDefectStates — new structured fields', () => {
    it('keeps a valid trade/deadline/timeframe trio', () => {
        const data = {
            item1: { tabs: { defects: [{
                cannedId: 'rd1', included: true,
                trade: 'licensed-plumber',
                deadline: 'before-closing',
                timeframe: '3-5-years',
            }] } },
        };
        sanitizeDefectStates(data);
        const d = (data.item1 as any).tabs.defects[0];
        expect(d.trade).toBe('licensed-plumber');
        expect(d.deadline).toBe('before-closing');
        expect(d.timeframe).toBe('3-5-years');
    });

    it('drops unknown trade to null', () => {
        const data = {
            item1: { tabs: { defects: [{
                cannedId: 'rd1', included: true,
                trade: 'plumber-extraordinaire',
            }] } },
        };
        sanitizeDefectStates(data);
        expect((data.item1 as any).tabs.defects[0].trade).toBeNull();
    });

    it('drops unknown deadline + timeframe to null independently', () => {
        const data = {
            item1: { tabs: { defects: [{
                cannedId: 'rd1', included: true,
                trade: 'licensed-plumber',  // valid; stays
                deadline: 'asap',           // invalid
                timeframe: 'eventually',    // invalid
            }] } },
        };
        sanitizeDefectStates(data);
        const d = (data.item1 as any).tabs.defects[0];
        expect(d.trade).toBe('licensed-plumber');
        expect(d.deadline).toBeNull();
        expect(d.timeframe).toBeNull();
    });

    it('leaves missing fields untouched (does not invent null entries)', () => {
        const data = {
            item1: { tabs: { defects: [{
                cannedId: 'rd1', included: true,
            }] } },
        };
        sanitizeDefectStates(data);
        const d = (data.item1 as any).tabs.defects[0];
        expect('trade' in d).toBe(false);
        expect('deadline' in d).toBe(false);
        expect('timeframe' in d).toBe(false);
    });
});
