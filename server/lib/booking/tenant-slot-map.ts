/**
 * Build the per-slot free-inspector map used by getTenantSlots.
 *
 * Combines recurring windows, date overrides, inspection busy times, and
 * calendar_blocks (all-day = no contribution; timed = overlapping slots busy).
 */
import { buildSlotGrid, type BuildSlotGridOptions } from './slot-grid';
import {
    addCalendarBlockBusyTimes,
    computeBusyTimes,
    hasAllDayCalendarBlock,
    type BusyRow,
    type CalendarBlockBusy,
} from './busy-times';

export interface SlotWindowRow {
    inspectorId: string;
    startTime: string | null;
    endTime: string | null;
}

export interface SlotOverrideRow {
    inspectorId: string;
    isAvailable: boolean;
    startTime: string | null;
    endTime: string | null;
    // A-polish 10 — Google event free/busy. 'transparent' rows are stored for
    // provenance but never block a slot; 'opaque'/NULL behave as before.
    transparency?: 'opaque' | 'transparent' | null;
    // A-polish 10 — 'google' rows are TIMED busy (subtract only overlapping
    // slots). NULL = manual (legacy whole-day blocking semantics).
    source?: 'google' | null;
}

export interface SlotBusyRow extends BusyRow {
    userId: string;
}

export interface SlotBlockRow extends CalendarBlockBusy {
    userId: string;
}

/**
 * Returns Map<slot HH:MM, Set<free inspector id>> for the given day inputs.
 */
export function buildTenantSlotMap(
    qualified: string[],
    windows: SlotWindowRow[],
    overrides: SlotOverrideRow[],
    busy: SlotBusyRow[],
    blocks: SlotBlockRow[],
    gridOpts: BuildSlotGridOptions,
): Map<string, Set<string>> {
    const slotMap = new Map<string, Set<string>>();
    const intervalMin = gridOpts.intervalMin ?? 30;

    for (const inspectorId of qualified) {
        const myWindows = windows.filter((w) => w.inspectorId === inspectorId);
        // Transparent (free) Google events are stored as overrides but never
        // block; drop them before any blocking is computed.
        const visible = overrides.filter(
            (o) => o.inspectorId === inspectorId && o.transparency !== 'transparent',
        );
        // Google-sourced busy is TIMED — it subtracts only the overlapping slots
        // (like a timed calendar block), never the whole day. Manual overrides
        // keep the legacy whole-day blocking semantics.
        const googleBusy = visible.filter(
            (o) => o.source === 'google' && !o.isAvailable && o.startTime && o.endTime,
        );
        const myOverrides = visible.filter((o) => o.source !== 'google');
        const myBlocks = blocks.filter((b) => b.userId === inspectorId);
        // All-day time-off matches a blocking override: no slots that day.
        if (hasAllDayCalendarBlock(myBlocks)) continue;

        const blocked = myOverrides.some((o) => !o.isAvailable);
        const effective = blocked ? myOverrides.filter((o) => o.isAvailable) : myWindows;
        if (effective.length === 0) continue;

        const busyTimes = computeBusyTimes(busy.filter((b) => b.userId === inspectorId));
        const mySlots = buildSlotGrid(effective, gridOpts);
        addCalendarBlockBusyTimes(busyTimes, myBlocks, mySlots, intervalMin);
        // Google busy blocks subtract overlapping slots, same as timed calendar blocks.
        addCalendarBlockBusyTimes(
            busyTimes,
            googleBusy.map((g) => ({ allDay: false, startTime: g.startTime, endTime: g.endTime })),
            mySlots,
            intervalMin,
        );

        for (const time of mySlots) {
            if (!slotMap.has(time)) slotMap.set(time, new Set());
            if (!busyTimes.has(time)) {
                slotMap.get(time)!.add(inspectorId);
            }
        }
    }

    return slotMap;
}
