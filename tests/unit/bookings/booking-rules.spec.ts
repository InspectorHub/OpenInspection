import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { BookingService } from '../../../server/services/booking.service';
import { tenants, tenantConfigs, users, availability } from '../../../server/lib/db/schema';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
    applyBookingRules,
    parseCutoffTime,
    parseMinLeadHours,
} from '../../../server/lib/booking/booking-rules';
import { wallClockToEpochMs } from '../../../server/lib/tz';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const CHICAGO = 'America/Chicago';
const MONDAY = '2026-06-08';

describe('booking rules are civil-time rules, evaluated in the tenant zone', () => {
    const at = (ymd: string, hm: string) => wallClockToEpochMs(ymd, hm, CHICAGO);

    it('a 24h lead time blocks tomorrow morning and allows the day after', () => {
        const base = {
            minLeadHours: 24, sameDayCutoffTime: null, tenantTz: CHICAGO,
            nowMs: at('2026-06-08', '10:00'),
        };
        expect(applyBookingRules({ ...base, civilDate: '2026-06-09', slotTime: '08:00' }))
            .toEqual({ allowed: false, reason: 'min_lead' });
        expect(applyBookingRules({ ...base, civilDate: '2026-06-09', slotTime: '11:00' }))
            .toEqual({ allowed: true, reason: null });
    });

    it('a 15:00 same-day cutoff closes today at 15:00 tenant-local and leaves tomorrow alone', () => {
        const rules = { minLeadHours: 0, sameDayCutoffTime: '15:00', tenantTz: CHICAGO };
        // 14:59 local — today is still open.
        expect(applyBookingRules({
            ...rules, civilDate: MONDAY, slotTime: '17:00', nowMs: at(MONDAY, '14:59'),
        }).allowed).toBe(true);
        // 15:00 local — closed for today.
        expect(applyBookingRules({
            ...rules, civilDate: MONDAY, slotTime: '17:00', nowMs: at(MONDAY, '15:00'),
        })).toEqual({ allowed: false, reason: 'same_day_cutoff' });
        // Tomorrow is unaffected by today's cutoff.
        expect(applyBookingRules({
            ...rules, civilDate: '2026-06-09', slotTime: '08:00', nowMs: at(MONDAY, '15:00'),
        }).allowed).toBe(true);
    });

    it('the cutoff follows the OFFICE clock, not UTC', () => {
        const rules = { minLeadHours: 0, sameDayCutoffTime: '15:00', tenantTz: CHICAGO };
        // 20:30Z on the 8th is 15:30 in Chicago (CDT) — past the cutoff — but
        // still "the 8th" in UTC either way. The zone is what decides, and a
        // naive UTC comparison of 20:30 >= 15:00 would agree here by accident.
        // 17:30Z is 12:30 local: open. A UTC comparison would call it closed.
        expect(applyBookingRules({
            ...rules, civilDate: MONDAY, slotTime: '18:00', nowMs: Date.parse('2026-06-08T17:30:00Z'),
        }).allowed).toBe(true);
        expect(applyBookingRules({
            ...rules, civilDate: MONDAY, slotTime: '18:00', nowMs: Date.parse('2026-06-08T20:30:00Z'),
        }).allowed).toBe(false);
    });

    it('lead time wins when both rules apply, so the client is told the binding one', () => {
        expect(applyBookingRules({
            minLeadHours: 48, sameDayCutoffTime: '15:00', tenantTz: CHICAGO,
            civilDate: MONDAY, slotTime: '17:00', nowMs: at(MONDAY, '16:00'),
        })).toEqual({ allowed: false, reason: 'min_lead' });
    });

    it('unconfigured rules allow everything', () => {
        expect(applyBookingRules({
            minLeadHours: 0, sameDayCutoffTime: null, tenantTz: CHICAGO,
            civilDate: '2020-01-01', slotTime: '08:00', nowMs: Date.now(),
        })).toEqual({ allowed: true, reason: null });
    });

    it('malformed stored values mean "no rule", never a crash or an accidental block', () => {
        expect(parseCutoffTime('25:00')).toBeNull();
        expect(parseCutoffTime('3pm')).toBeNull();
        expect(parseCutoffTime('')).toBeNull();
        expect(parseCutoffTime('09:30')).toBe('09:30');
        expect(parseMinLeadHours(-5)).toBe(0);
        expect(parseMinLeadHours(null)).toBe(0);
        expect(parseMinLeadHours(1e9)).toBe(24 * 365);
    });
});

describe('getTenantSlots enforces the rules on the computed grid', () => {
    let svc: BookingService;
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db; sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(db);
        svc = new BookingService({} as any);
        await db.insert(tenants).values({ id: 't1', slug: 'acme', createdAt: new Date() });
        await db.insert(users).values({
            id: 'u1', tenantId: 't1', email: 'u1@x.com', passwordHash: 'h',
            role: 'inspector', name: 'Ann', createdAt: new Date(),
        });
        await db.insert(availability).values({
            id: 'a1', tenantId: 't1', inspectorId: 'u1', dayOfWeek: 1,
            startTime: '08:00', endTime: '10:00', createdAt: new Date(),
        });
    });
    afterEach(() => { vi.useRealTimers(); sqlite.close(); });

    it('a same-day cutoff already passed leaves the day with no bookable slot', async () => {
        await db.insert(tenantConfigs).values({
            tenantId: 't1', defaultTimezone: CHICAGO,
            bookingSameDayCutoffTime: '07:00', updatedAt: new Date(),
        });
        vi.useFakeTimers();
        vi.setSystemTime(new Date(wallClockToEpochMs(MONDAY, '07:30', CHICAGO)));

        const { slots } = await svc.getTenantSlots('t1', MONDAY, []);
        expect(slots.length).toBeGreaterThan(0);
        expect(slots.every(s => s.available === false)).toBe(true);
        expect(slots.every(s => s.inspectorIds.length === 0)).toBe(true);
    });

    it('with no rules configured the same grid is fully bookable', async () => {
        await db.insert(tenantConfigs).values({
            tenantId: 't1', defaultTimezone: CHICAGO, updatedAt: new Date(),
        });
        vi.useFakeTimers();
        vi.setSystemTime(new Date(wallClockToEpochMs(MONDAY, '07:30', CHICAGO)));

        const { slots } = await svc.getTenantSlots('t1', MONDAY, []);
        expect(slots.some(s => s.available)).toBe(true);
    });
});
