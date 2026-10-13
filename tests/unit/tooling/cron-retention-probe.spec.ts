/**
 * The retention-agreements probe answers "is a pass due?" with the retention window
 * applied. Without the window it was true for every signed agreement ever, so the job
 * was enqueued on every five-minute tick and purged nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import { agreementRequests, agreements, tenantConfigs, tenants } from '../../../server/lib/db/schema';
import { retentionAgreementsJob } from '../../../server/cron/jobs/agreements';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

describe('retention-agreements probe', () => {
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let db: ReturnType<typeof createTestDb>['db'];

    beforeEach(async () => {
        const setup = createTestDb();
        sqlite = setup.sqlite;
        db = setup.db;
        await setupSchema(sqlite);
        await db.insert(tenants).values([
            { id: 't6', slug: 't6', createdAt: new Date(NOW) },
            { id: 't2', slug: 't2', createdAt: new Date(NOW) },
        ]);
        // t6 has no config row (default window 6 years); t2 keeps two years.
        await db.insert(tenantConfigs).values({ tenantId: 't2', agreementRetentionYears: 2, updatedAt: new Date(NOW) } as never);
        await db.insert(schema.inspections).values(['t6', 't2'].map((t) => ({
            id: `insp-${t}`, tenantId: t, propertyAddress: '1 Main', clientName: null, clientEmail: null,
            date: '2026-01-01', status: 'completed', paymentStatus: 'unpaid', price: 0, createdAt: new Date(NOW),
        })) as never);
        await db.insert(agreements).values(['t6', 't2'].map((t) => ({
            id: `tpl-${t}`, tenantId: t, name: 'Tpl', content: 'b', createdAt: new Date(NOW),
        })) as never);
    });

    afterEach(() => sqlite.close());

    async function sign(id: string, tenantId: string, ageDays: number, purged = false) {
        await db.insert(agreementRequests).values({
            id, tenantId, inspectionId: `insp-${tenantId}`, agreementId: `tpl-${tenantId}`,
            clientEmail: 'c@example.com', clientName: 'C', status: 'signed',
            signedAt: new Date(NOW - ageDays * DAY), createdAt: new Date(NOW - ageDays * DAY),
            ...(purged ? { purgedAt: new Date(NOW) } : {}),
        } as never);
    }
    const probe = () => retentionAgreementsJob.probe({ DB: toD1Binding(sqlite) } as never);

    it('is not due when every signed agreement is inside its window', async () => {
        await sign('a', 't6', 400); // ~1 year into a 6-year window
        await sign('b', 't2', 100); // a few months into a 2-year window
        expect(await probe()).toBe(0);
    });

    it('is due once a tenant with the default window passes 6 years', async () => {
        await sign('a', 't6', 6 * 366 + 5);
        expect(await probe()).toBe(1);
    });

    it("applies each tenant's own window, not one global one", async () => {
        await sign('a', 't6', 3 * 365); // old for t2's window, young for the 6-year default
        expect(await probe()).toBe(0);
        await sign('b', 't2', 3 * 365);
        expect(await probe()).toBe(1);
    });

    it('is not due for an expired agreement that is already purged', async () => {
        await sign('a', 't2', 5 * 365, true);
        expect(await probe()).toBe(0);
    });
});
