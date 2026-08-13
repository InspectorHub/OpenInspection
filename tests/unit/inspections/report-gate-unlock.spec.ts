/**
 * The report gate is ORDER-WIDE, and the way out is a manual unlock.
 *
 * Any required agreement left unsigned, or payment outstanding, blocks every
 * report on the inspection — not just the one belonging to the service whose
 * agreement is missing. That is one rule an inspector and a client can both
 * state without looking it up, and it is what a client means by "my paperwork".
 *
 * Its cost is that an add-on's unsigned addendum can hold back a report that is
 * finished and that someone is waiting for. The release is a named person
 * opening one inspection and recording why — not a finer-grained gate, which
 * would put a service dimension on `agreement_requests`, a signed-evidence table
 * with a retention rule, to solve what one override solves.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { InspectionStatusService } from '../../../server/services/inspection/inspection-status.service';

const TENANT = 'tenant-gate-1';
const INSP = 'insp-gate-1';
const OWNER = 'user-owner';

describe('report gate unlock', () => {
    let db: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;
    let svc: InspectionStatusService;

    const row = () => db.select().from(schema.inspections)
        .where(eq(schema.inspections.id, INSP)).get();

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: TENANT, slug: 't', createdAt: new Date(),
        });
        await db.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 Main St', date: '2026-09-01',
            status: 'completed', paymentStatus: 'unpaid', price: 45000, createdAt: new Date(),
            agreementRequired: true, paymentRequired: true,
        } as never);

        svc = new InspectionStatusService({} as never);
    });

    afterEach(() => { sqlite.close(); });

    it('starts locked — nothing is unlocked by default', async () => {
        // A tenant arriving from another platform expects reports to be held
        // until signed and paid. Defaulting open would quietly change that.
        expect((await row())?.unlockedAt).toBeNull();
    });

    it('records who unlocked it and why', async () => {
        await svc.unlockReportGate(TENANT, INSP, OWNER, 'Client is at closing; radon addendum still out for signature.');

        const after = await row();
        expect(after?.unlockedAt).toBeTruthy();
        expect(after?.unlockedBy).toBe(OWNER);
        expect(after?.unlockReason).toContain('radon addendum');
    });

    it('keeps the ORIGINAL record when unlocked twice', async () => {
        // The record has to show who actually made the call, not whoever pressed
        // the button last.
        await svc.unlockReportGate(TENANT, INSP, OWNER, 'first reason');
        const first = await row();

        const second = await svc.unlockReportGate(TENANT, INSP, 'someone-else', 'second reason');

        expect(second.alreadyUnlocked).toBe(true);
        const after = await row();
        expect(after?.unlockedBy).toBe(OWNER);
        expect(after?.unlockReason).toBe('first reason');
        expect(after?.unlockedAt).toEqual(first?.unlockedAt);
    });

    it('relocking clears the reason with it', async () => {
        // The reason described a decision that no longer stands.
        await svc.unlockReportGate(TENANT, INSP, OWNER, 'closing today');
        await svc.relockReportGate(TENANT, INSP);

        const after = await row();
        expect(after?.unlockedAt).toBeNull();
        expect(after?.unlockedBy).toBeNull();
        expect(after?.unlockReason).toBeNull();
    });

    it('refuses to unlock an inspection in another tenant', async () => {
        await expect(svc.unlockReportGate('other-tenant', INSP, OWNER, 'nope'))
            .rejects.toThrow(/not found/i);
        expect((await row())?.unlockedAt).toBeNull();
    });

    it('can be unlocked again after a relock', async () => {
        await svc.unlockReportGate(TENANT, INSP, OWNER, 'first');
        await svc.relockReportGate(TENANT, INSP);
        const again = await svc.unlockReportGate(TENANT, INSP, 'user-two', 'second');

        expect(again.alreadyUnlocked).toBe(false);
        expect((await row())?.unlockReason).toBe('second');
    });
});
