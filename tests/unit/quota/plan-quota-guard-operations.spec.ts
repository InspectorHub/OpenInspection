/**
 * Every operation a plan limit can refuse is listed here, with the kind of thing it refuses.
 *
 * A tenant whose paid plan ended keeps reading and downloading its history, so a limit may only ever stop a
 * tenant from creating something, sending something, calling AI, uploading a NEW video or adding a seat.
 * Adding a method to the guard (a `canRead`, an `assertCanExport`) must fail here and make the author say
 * which of those it is, which is also the moment a reviewer sees it.
 */
import { describe, it, expect } from 'vitest';
import { PlanQuotaGuard } from '../../../server/features/plan-quota/guard';
import * as seatQuota from '../../../server/features/seat-quota';
import * as videoResolve from '../../../server/services/video/resolve';

type Refuses = 'create' | 'send' | 'ai' | 'new-video' | 'seat' | 'none';

/** PlanQuotaGuard methods: what each one is allowed to refuse. */
const GUARD_OPERATIONS: Record<string, Refuses> = {
    consumeInspection: 'create',
    assertInspectionRoom: 'create',
    releaseInspection: 'none', // gives an allowance back after a failed create; never refuses
    checkMessagingQuota: 'send',
    checkAiQuota: 'ai',
};

/** Seat limit entry points (exports of the seat-quota feature). */
const SEAT_OPERATIONS: Record<string, Refuses> = {
    requireSeatAvailable: 'seat',
    getSeatUsage: 'none', // reports usage; never refuses
    assertSeatAvailableForJoin: 'seat',
    SEAT_QUOTA_UNENFORCED: 'none',
};

/** Video backend resolution: only the choice for a NEW upload depends on the plan. */
const VIDEO_OPERATIONS: Record<string, Refuses> = {
    resolveVideoProvider: 'new-video',
    // Chosen by the plan for a NEW upload; or by the stored row's provider when an existing video is deleted or finalized.
    resolveVideoBackend: 'new-video',
    videoStreamServiceable: 'none',
};

const guardMethods = Object.getOwnPropertyNames(PlanQuotaGuard.prototype).filter((n) => n !== 'constructor').sort();

const REGISTER_HINT = (what: string, names: string[]) =>
    `${what} not registered: ${names.join(', ')}. A plan limit may only refuse a create, a send, an AI call, a NEW video or a seat; `
    + 'it must never stop a tenant reading, downloading or exporting its history. Register the new operation in this spec '
    + 'with the kind it refuses, and have a reviewer confirm it is not called from a read path.';

describe('plan limit operations are registered', () => {
    it('the guard exposes methods (both numbers print)', () => {
        console.info(`[plan-quota-registry] guard methods ${guardMethods.length}, registered ${Object.keys(GUARD_OPERATIONS).length}`);
        expect(guardMethods.length).toBeGreaterThan(0);
    });

    it('every PlanQuotaGuard method is registered, and every registration still exists', () => {
        const unregistered = guardMethods.filter((n) => !(n in GUARD_OPERATIONS));
        expect(unregistered, REGISTER_HINT('PlanQuotaGuard method(s)', unregistered)).toEqual([]);
        expect(Object.keys(GUARD_OPERATIONS).filter((n) => !guardMethods.includes(n))).toEqual([]);
    });

    it('the seat-quota feature exports exactly the registered operations', () => {
        const names = Object.keys(seatQuota).sort();
        expect(names.filter((n) => !(n in SEAT_OPERATIONS)), REGISTER_HINT('seat-quota export(s)', names)).toEqual([]);
        expect(Object.keys(SEAT_OPERATIONS).filter((n) => !names.includes(n))).toEqual([]);
    });

    it('the video resolver exports exactly the registered operations', () => {
        const names = Object.keys(videoResolve).sort();
        expect(names.filter((n) => !(n in VIDEO_OPERATIONS)), REGISTER_HINT('video resolver export(s)', names)).toEqual([]);
        expect(Object.keys(VIDEO_OPERATIONS).filter((n) => !names.includes(n))).toEqual([]);
    });

    it('no registered operation is named like a read path, and the registered kinds are exactly the allowed set', () => {
        const all = { ...GUARD_OPERATIONS, ...SEAT_OPERATIONS, ...VIDEO_OPERATIONS };
        for (const name of Object.keys(all)) {
            expect(name, 'a limit named like a read path').not.toMatch(/read|download|export|view|fetch/i);
        }
        expect([...new Set(Object.values(all))].sort()).toEqual(['ai', 'create', 'new-video', 'none', 'seat', 'send']);
    });
});
