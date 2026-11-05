/**
 * Two requests create the default pay rule for one service at the same moment. The pre-check passes for
 * both; the second INSERT meets the partial unique index. Drizzle on D1 reports that as "Failed query: ..."
 * with the driver's UNIQUE text on `.cause`, so the answer must come from reading the cause chain: the
 * client gets the 409 it can act on, not a 500.
 */
import { describe, it, expect } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { servicePayRules, services, tenants } from '../../../server/lib/db/schema';
import { createPayRule } from '../../../server/services/service/pay-rules';
import { createTestDb } from '../db';
import { d1For } from '../helpers/d1-binding';

const T = 't1';
const SVC = 'svc1';

function setup(raceOnInsert: boolean) {
    const { db, sqlite } = createTestDb();
    const now = new Date();
    db.insert(tenants).values({ id: T, slug: T, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now } as never).run();
    db.insert(services).values({ id: SVC, tenantId: T, name: 'Home Inspection', price: 50000, createdAt: now } as never).run();
    const real = d1For(sqlite);
    let raced = false;
    const binding = {
        prepare: (sql: string) => {
            // The competing request lands between this request's pre-check and its INSERT.
            if (raceOnInsert && !raced && /^insert into "service_pay_rules"/i.test(sql)) {
                raced = true;
                db.insert(servicePayRules).values({
                    id: 'rival', tenantId: T, serviceId: SVC, userId: null, type: 'fixed', value: 500, createdAt: now,
                } as never).run();
            }
            return real.prepare(sql);
        },
        batch: (list: never) => (real.batch as (l: never) => unknown)(list),
    } as unknown as D1Database;
    return { d1: drizzle(binding), db };
}

describe('createPayRule when another request wrote the same slot first', () => {
    it('answers the 409 conflict, not the raw driver failure', async () => {
        const { d1 } = setup(true);
        await expect(createPayRule(d1, T, SVC, { type: 'fixed', amountCents: 1000 } as never))
            .rejects.toMatchObject({ status: 409 });
    });

    it('control: with no rival the same create succeeds', async () => {
        const { d1 } = setup(false);
        await expect(createPayRule(d1, T, SVC, { type: 'fixed', amountCents: 1000 } as never))
            .resolves.toMatchObject({ userId: null });
    });
});
