import { describe, it, expect } from 'vitest';
import { buildSlotGrid } from '../../../server/lib/booking/slot-grid';

describe('buildSlotGrid — open vs fixed slot mode', () => {
    const window = [{ startTime: '09:15', endTime: '11:00' }];

    it('fixed mode emits window-aligned starts at the interval step', () => {
        expect(buildSlotGrid(window, { mode: 'fixed', intervalMin: 30 })).toEqual([
            '09:15',
            '09:45',
            '10:15',
            '10:45',
        ]);
    });

    it('open mode emits clock-aligned interval starts within the window', () => {
        expect(buildSlotGrid(window, { mode: 'open', intervalMin: 30 })).toEqual([
            '09:30',
            '10:00',
            '10:30',
        ]);
    });

    it('defaults to fixed / 30 and matches legacy window fill on aligned starts', () => {
        const aligned = [{ startTime: '08:00', endTime: '10:00' }];
        expect(buildSlotGrid(aligned)).toEqual(['08:00', '08:30', '09:00', '09:30']);
        expect(buildSlotGrid(aligned, { mode: 'fixed', intervalMin: 30 })).toEqual([
            '08:00',
            '08:30',
            '09:00',
            '09:30',
        ]);
        expect(buildSlotGrid(aligned, { mode: 'open', intervalMin: 30 })).toEqual([
            '08:00',
            '08:30',
            '09:00',
            '09:30',
        ]);
    });

    it('respects 15 and 60 minute intervals', () => {
        const w = [{ startTime: '08:00', endTime: '09:00' }];
        expect(buildSlotGrid(w, { mode: 'fixed', intervalMin: 15 })).toEqual([
            '08:00',
            '08:15',
            '08:30',
            '08:45',
        ]);
        expect(buildSlotGrid(w, { mode: 'fixed', intervalMin: 60 })).toEqual(['08:00']);
    });
});
