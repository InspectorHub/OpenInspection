/**
 * `expireOlderThan` does two UPDATEs — and, until this spec, a third query
 * whose only purpose was to synthesise a return value.
 *
 * The value it synthesised was wrong: it counted rows ALREADY in `expired`
 * state inside the window, not rows this run changed, which is why an idle
 * deployment logged `[cron] expired agreements {count: 4}` every five minutes
 * forever. D1 exposes no rowsAffected through Drizzle, so there is no honest
 * count available here; returning none beats returning a misleading one.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { AgreementService } from '../../../server/services/agreement.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { TENANT_A, INSP_ID, seedBase } from '../helpers/agreement-signers-setup';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

describe('AgreementService.expireOlderThan', () => {
    let svc: AgreementService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        await seedBase(testDb);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        svc = new AgreementService({} as D1Database, { jwtSecret: 'test-secret' });
    });

    it('does not run a third query just to synthesise a return count', async () => {
        const selectSpy = vi.spyOn(testDb, 'select');
        await svc.expireOlderThan(14);
        expect(
            selectSpy.mock.calls.length,
            `expireOlderThan issued ${selectSpy.mock.calls.length} SELECT(s); it should issue two UPDATEs and none`,
        ).toBe(0);
    });

    it('still expires the envelope — the query removal must not remove the work', async () => {
        // The positive control. "No SELECT ran" is also true of a function that
        // does nothing at all.
        const r = await svc.findOrCreate(TENANT_A, INSP_ID, {
            signers: [{ name: 'Jane', email: 'jane@test.com' }],
        });
        await testDb.update(schema.agreementRequests)
            .set({ sentAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) })
            .where(eq(schema.agreementRequests.id, r.requestId));

        await svc.expireOlderThan(14);

        const row = await testDb.select().from(schema.agreementRequests)
            .where(eq(schema.agreementRequests.id, r.requestId)).get();
        expect(row!.status).toBe('expired');
    });
});
