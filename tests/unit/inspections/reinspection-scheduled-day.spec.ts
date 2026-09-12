/**
 * A RE-INSPECTION IS NOT SCHEDULED FOR THE MOMENT THE BUTTON WAS PRESSED.
 *
 * The Create re-inspection dialog offers an item selector, Cancel and Create. No
 * date, no time. The service nonetheless wrote `createdAt.toISOString()` into
 * `inspections.date`, so a round created at 09:37:35.967 was recorded as an
 * appointment at 09:37:35.967 — a precision nobody asked for about a decision
 * nobody made, and one that every consumer of an instant then repeats (the
 * calendar places the card at that minute; the .ics feed publishes it).
 *
 * Two things are asserted, and they are separate failures:
 *   1. SHAPE — the value is a civil day (`YYYY-MM-DD`), which is the shape that
 *      says "this date, time not set". `inspections.date` deliberately holds both
 *      shapes, so the day-only form is available and means something.
 *   2. ZONE — the day is the COMPANY's day, not UTC's. For half of the evening on
 *      the US west coast those are different dates, and the difference is a
 *      re-inspection filed against tomorrow.
 *
 * The four dated cases straddle both US transitions in ONE zone. A fix that
 * captured the offset once would pass two of them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InspectionService } from '../../../server/services/inspection.service';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000d1';
const BASELINE = '11111111-1111-1111-1111-1111111111d1';
const PACIFIC = 'America/Los_Angeles';

describe('createReinspection writes a company-zone DAY, not the creation instant', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db as BetterSQLite3Database<typeof schema>;
        sqlite = fix.sqlite;
        await setupSchema(fix.sqlite);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(testDb);

        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'reinspect-day', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.users).values({
            id: 'user-a', tenantId: TENANT, email: 'insp@example.com',
            passwordHash: 'x', name: 'Inspector A', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: BASELINE, tenantId: TENANT,
            propertyAddress: '1 Main St',
            date: '2026-06-01',
            status: 'completed', reportStatus: 'published', paymentStatus: 'unpaid',
            price: 0, paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });
        await testDb.insert(schema.reportVersions).values({
            id: crypto.randomUUID(), tenantId: TENANT, inspectionId: BASELINE,
            versionNumber: 1,
            snapshotJson: JSON.stringify({
                inspection: { id: BASELINE },
                data: { 'item-a': { rating: 'defect', notes: 'cracked', photos: [] } },
                units: [],
            }),
            publishedAt: new Date(), publishedBy: 'user-a', createdAt: new Date(),
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        sqlite.close();
    });

    async function createAt(nowIso: string, companyZone?: string, scheduledDate?: string) {
        if (companyZone !== undefined) {
            await testDb.insert(schema.tenantConfigs).values({
                tenantId: TENANT, updatedAt: new Date(), defaultTimezone: companyZone,
            });
        }
        vi.useFakeTimers();
        vi.setSystemTime(new Date(nowIso));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sdb = new ScopedDB(testDb as any, TENANT);
        const svc = new InspectionService({} as D1Database, undefined, sdb);
        const out = await svc.createReinspection(TENANT, BASELINE, {
            selectedItemIds: ['item-a'], inspectorId: 'user-a',
            ...(scheduledDate === undefined ? {} : { scheduledDate }),
        });
        const row = await testDb.select().from(schema.inspections)
            .where(eq(schema.inspections.id, out.id)).get();
        return row!;
    }

    it('records a bare calendar day and no time of day at all', async () => {
        // 19:30 Pacific on the 4th. The old code wrote this whole instant.
        const row = await createAt('2026-11-05T03:30:00.000Z', PACIFIC);

        // SHAPE. `toContain('T')` is the assertion that actually discriminates:
        // a full instant starts with the right ten characters too, so a prefix
        // check alone would have passed against the bug it replaces.
        expect(String(row.date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(String(row.date)).not.toContain('T');
        expect(String(row.date)).not.toContain('Z');

        // ZONE. The company's day is the 4th; UTC's is the 5th.
        expect(row.date).toBe('2026-11-04');

        // And nothing claims an instant either: scheduled_start_ms stays NULL,
        // which is what makes the calendar and the ICS feed fall back to the
        // default business-hours start instead of publishing 19:30.
        expect(row.scheduledStartMs).toBeNull();
        expect(row.scheduledEndMs).toBeNull();
    });

    describe('the company day across both DST transitions', () => {
        const cases: Array<{ now: string; expected: string; note: string }> = [
            // Autumn: PDT (-07:00) the week before the fall-back...
            { now: '2026-10-31T06:30:00.000Z', expected: '2026-10-30', note: 'PDT, -07:00' },
            // ...and PST (-08:00) the week after. A captured -07:00 would make
            // this 2026-11-07, a day late.
            { now: '2026-11-07T07:30:00.000Z', expected: '2026-11-06', note: 'PST, -08:00' },
            // Spring: PST (-08:00) before the jump...
            { now: '2027-03-13T07:30:00.000Z', expected: '2027-03-12', note: 'PST, -08:00' },
            // ...and PDT (-07:00) after it, where the day has already turned over
            // locally. A captured -08:00 would make this 2027-03-19, a day early.
            { now: '2027-03-20T07:30:00.000Z', expected: '2027-03-20', note: 'PDT, -07:00' },
        ];

        for (const { now, expected, note } of cases) {
            it(`at ${now} the Pacific day is ${expected} (${note})`, async () => {
                const row = await createAt(now, PACIFIC);
                expect(row.date).toBe(expected);
            });
        }
    });

    /**
     * F47 — THE OPERATOR CAN NOW NAME THE DAY, WHICH CHANGES WHO ANSWERS.
     *
     * Everything above describes the DEFAULT: nobody said which day, so the
     * service works one out. The dialog now carries a date field prefilled with
     * the operator's own today, so the ordinary path supplies a day outright and
     * no inference happens at all.
     *
     * That in turn retires the undeclared-timezone guess. This suite used to
     * assert that a workspace with no config row "degrades to the UTC day",
     * reasoning that refusing would block a follow-up round over a settings
     * omission. That reasoning expired with this field: nobody is blocked any
     * more, because the dialog always sends a day. What is left in the refusing
     * branch is a caller that supplied neither a date nor a declared company
     * timezone — which is not a question anything can answer, only guess at, and
     * the guess is WRONG for every workspace west of Greenwich after ~17:00
     * local. A silent wrong date on a scheduled appointment is worse than a 400.
     */
    describe('an explicitly chosen day', () => {
        it('is stored verbatim, whatever the clock or the company zone says', async () => {
            // 19:30 Pacific on the 4th — the "today" branch would have written
            // 2026-11-04, and UTC would have written 2026-11-05. Neither wins.
            const row = await createAt('2026-11-05T03:30:00.000Z', PACIFIC, '2026-12-01');
            expect(row.date).toBe('2026-12-01');
        });

        it('needs no declared company timezone, because nothing is being inferred', async () => {
            const row = await createAt('2026-11-05T03:30:00.000Z', undefined, '2026-12-01');
            expect(row.date).toBe('2026-12-01');
        });

        it('still claims no time of day', async () => {
            const row = await createAt('2026-11-05T03:30:00.000Z', PACIFIC, '2026-12-01');
            expect(String(row.date)).not.toContain('T');
            expect(row.scheduledStartMs).toBeNull();
            expect(row.scheduledEndMs).toBeNull();
        });
    });

    it('refuses to invent a day when no date was chosen and no company zone was declared', async () => {
        await expect(createAt('2026-11-05T03:30:00.000Z')).rejects.toThrow(/timezone/i);
    });

    it('still defaults to the company day when the zone IS declared and no date was chosen', async () => {
        // The positive control for the test above: the refusal must be about the
        // UNDECLARED zone specifically, not about the absent date. Without this
        // pair, a service that simply threw on every dateless call would look
        // correct.
        const row = await createAt('2026-11-05T03:30:00.000Z', PACIFIC);
        expect(row.date).toBe('2026-11-04');
    });
});
