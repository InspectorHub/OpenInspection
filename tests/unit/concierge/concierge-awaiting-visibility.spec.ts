import { describe, it, expect, beforeEach } from 'vitest';
import { inArray } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { ConciergeService } from '../../../server/services/concierge.service';
import type { EmailService } from '../../../server/services/email.service';
import { ALL_INSPECTIONS, type InspectionScope } from '../../../server/lib/inspection/visibility';
import { seedVisibilityFixture, TENANT, USERS, INSP } from '../helpers/visibility-fixture';

import { lazyD1 } from '../helpers/d1-binding';
const testD1 = lazyD1();

describe('the dashboard count of bookings awaiting an inspector honours the scope', () => {
    let svc: ConciergeService;
    beforeEach(async () => {
        const f = createTestDb(); await setupSchema(f.sqlite); await seedVisibilityFixture(f.db);
        testD1.use(f.db);
        // two awaiting bookings on inspections inspA can see (own, team), two on ones it cannot (other, unassigned)
        await f.db.update(schema.inspections).set({ conciergeStatus: 'awaiting_inspector' })
            .where(inArray(schema.inspections.id, [INSP.own, INSP.team, INSP.other, INSP.unassigned]));
        svc = new ConciergeService(testD1.binding, async () => ({}) as unknown as EmailService, 'https://acme.example.com');
    });
    const A: InspectionScope = { kind: 'assigned', userId: USERS.inspA };

    it('a restricted inspector counts only the bookings on their own inspections', async () => {
        expect((await svc.listAwaitingInspector(TENANT, A)).count).toBe(2);
    });
    it('control: the all-scope counts every awaiting booking', async () => {
        expect((await svc.listAwaitingInspector(TENANT, ALL_INSPECTIONS)).count).toBe(4);
    });
    it('an inspector assigned to nothing counts none', async () => {
        expect((await svc.listAwaitingInspector(TENANT, { kind: 'assigned', userId: USERS.inspC })).count).toBe(0);
    });
});
