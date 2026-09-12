/**
 * The Communication summary line must not contradict the Outbox printed under
 * it.
 *
 * What was observed on a real inspection: `2 delivered · 0 unread · 0 need
 * attention` with five `0/1` notices listed immediately beneath it, every one of
 * them due more than an hour earlier and never sent. The roll-up was not merely
 * unhelpful — it told the inspector there was nothing to look at, above the
 * evidence that there was.
 *
 * The old rule ("only `failed` and `skipped` need attention") is the whole cause:
 * those are the rows the flush REACHED and settled. A row it never reached stays
 * `pending` with no error for ever, which is the exact state a cron outage
 * produces — and the state nothing was counting.
 *
 * Both directions are asserted here, because a fix that simply counted every
 * pending row would be just as wrong in the other direction: a notice scheduled
 * for tomorrow, and one enqueued thirty seconds ago, are plans.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { communicationCounts, DELIVERY_OVERDUE_AFTER_MS } from '../../../server/lib/communication-counts';

const TENANT = '00000000-0000-0000-0000-0000000000f1';
const OTHER_TENANT = '00000000-0000-0000-0000-0000000000f2';
const INSP = 'insp-outbox-rollup';
const OTHER_INSP = 'insp-outbox-rollup-2';
const NOW = Date.parse('2026-09-10T12:00:00Z');
const MINUTE = 60_000;

describe('communicationCounts — a long-overdue delivery needs attention', () => {
    let db: BetterSQLite3Database<typeof schema>;

    async function log(
        status: 'sent' | 'pending' | 'failed' | 'skipped',
        sendAtOffsetMs: number,
        inspectionId = INSP,
        tenantId = TENANT,
    ) {
        await db.insert(schema.automationLogs).values({
            id: crypto.randomUUID(), tenantId, automationId: null, inspectionId,
            recipient: 'client@x.com', channel: 'email',
            sendAt: new Date(NOW + sendAtOffsetMs), status,
        });
    }

    const counts = () => communicationCounts(db as never, TENANT, INSP, new Date(NOW));

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        for (const id of [TENANT, OTHER_TENANT]) {
            await db.insert(schema.tenants).values({
                id, slug: `acme-${id.slice(-2)}`, status: 'active',
                deploymentMode: 'shared', tier: 'free', createdAt: new Date(NOW),
            });
        }
    });

    it('counts a pending delivery that has been due for an hour', async () => {
        // The observed case: five report notices, due, pending, untouched.
        for (let i = 0; i < 5; i++) await log('pending', -60 * MINUTE);
        await log('sent', -60 * MINUTE);
        await log('sent', -60 * MINUTE);

        const c = await counts();
        expect(c.delivered).toBe(2);
        // The number the summary line prints. `0` here is the defect: it stood
        // above the five rows themselves.
        expect(c.needsAttention).toBe(5);
    });

    it('still counts the rows the flush settled badly', async () => {
        // The discriminating half in the other direction: a fix that swapped
        // failed/skipped for overdue-pending would pass the test above.
        await log('failed', -60 * MINUTE);
        await log('skipped', -60 * MINUTE);
        expect((await counts()).needsAttention).toBe(2);
    });

    it('does NOT count a delivery that is merely due, or one scheduled ahead', async () => {
        // A pending row is a plan until it has been ignored for long enough to
        // be an incident. Counting every pending row would make the roll-up
        // alarm on the normal case — one tick of the flush away from sending.
        await log('pending', -1 * MINUTE);
        await log('pending', +120 * MINUTE);
        expect((await counts()).needsAttention).toBe(0);
    });

    it('starts counting exactly at the declared threshold, not at a number of its own', async () => {
        // Asserted against the exported constant rather than a literal 15: a
        // test carrying its own copy of the threshold agrees with itself and
        // nothing else.
        // Two sides of the line, one minute either way, on two inspections so
        // the same fixture answers both.
        await log('pending', -(DELIVERY_OVERDUE_AFTER_MS + MINUTE), INSP);
        await log('pending', -(DELIVERY_OVERDUE_AFTER_MS - MINUTE), OTHER_INSP);
        expect((await counts()).needsAttention).toBe(1);
        const other = await communicationCounts(db as never, TENANT, OTHER_INSP, new Date(NOW));
        expect(other.needsAttention).toBe(0);
    });

    it('counts only THIS inspection, in THIS tenant', async () => {
        // The roll-up sits on one inspection's page; an overdue row from a
        // neighbouring order (or another workspace) there would be the same
        // class of lie in the opposite direction.
        await log('pending', -60 * MINUTE, OTHER_INSP, TENANT);
        await log('pending', -60 * MINUTE, INSP, OTHER_TENANT);
        expect((await counts()).needsAttention).toBe(0);
    });
});
