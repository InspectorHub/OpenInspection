/**
 * A-polish 10.2 — a Google event marked "transparent" (free) is stored as an
 * availability_override for provenance but must NOT remove any booking slot.
 * Opaque and legacy-NULL blocking overrides keep their existing behavior.
 */
import { describe, it, expect } from 'vitest';
import { buildTenantSlotMap, type SlotOverrideRow } from '../../../server/lib/booking/tenant-slot-map';

const GRID = { intervalMin: 30 as const };
const INSP = 'insp-1';
const WINDOW = { inspectorId: INSP, startTime: '08:00', endTime: '10:00' };

function freeSlots(overrides: SlotOverrideRow[]): string[] {
    const map = buildTenantSlotMap([INSP], [WINDOW], overrides, [], [], GRID);
    return [...map.entries()]
        .filter(([, free]) => free.has(INSP))
        .map(([t]) => t)
        .sort();
}

const blocking = (transparency: 'opaque' | 'transparent' | null): SlotOverrideRow => ({
    inspectorId: INSP, isAvailable: false, startTime: null, endTime: null, transparency,
});

describe('transparent overrides do not block slots', () => {
    it('a transparent blocking override leaves every slot intact', () => {
        expect(freeSlots([blocking('transparent')])).toEqual(['08:00', '08:30', '09:00', '09:30']);
    });

    it('an opaque blocking override still blocks the day', () => {
        expect(freeSlots([blocking('opaque')])).toEqual([]);
    });

    it('a legacy NULL-transparency blocking override still blocks', () => {
        expect(freeSlots([blocking(null)])).toEqual([]);
    });
});

describe('google timed busy removes only overlapping slots', () => {
    const googleBusy = (startTime: string, endTime: string): SlotOverrideRow => ({
        inspectorId: INSP, isAvailable: false, startTime, endTime,
        transparency: 'opaque', source: 'google',
    });

    it('subtracts only the overlapping slot, not the whole day', () => {
        // Busy 08:30–09:00 removes the 08:30 slot ([08:30,09:00) overlaps); the
        // 08:00, 09:00 and 09:30 slots survive — proving it is not a day block.
        expect(freeSlots([googleBusy('08:30', '09:00')])).toEqual(['08:00', '09:00', '09:30']);
    });

    it('a transparent google event removes nothing', () => {
        const free: SlotOverrideRow = {
            inspectorId: INSP, isAvailable: false, startTime: '08:30', endTime: '09:00',
            transparency: 'transparent', source: 'google',
        };
        expect(freeSlots([free])).toEqual(['08:00', '08:30', '09:00', '09:30']);
    });
});
