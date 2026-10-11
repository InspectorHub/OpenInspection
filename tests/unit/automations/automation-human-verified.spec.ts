/**
 * A report publish that passed the human check vouches for the email rows it
 * queued, including delayed ones that are sent later with no request around.
 * The stamp is scoped: this tenant, this inspection, pending email rows, once.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { stampIfHumanVerified } from '../../../server/services/automation/human-verified';

const T1 = '00000000-0000-0000-0000-0000000aa001';
const T2 = '00000000-0000-0000-0000-0000000aa002';

let db: BetterSQLite3Database<typeof schema>;

const row = (id: string, over: Record<string, unknown> = {}) => ({
    id, tenantId: T1, inspectionId: 'insp-1', recipient: 'c@example.com', channel: 'email' as const,
    sendAt: new Date(), status: 'pending' as const, ...over,
});

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    for (const [id, slug] of [[T1, 'a1'], [T2, 'a2']] as const) {
        await db.insert(schema.tenants).values({ id, slug, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() } as never);
    }
});

const stamped = async () =>
    (await db.select({ id: schema.automationLogs.id, at: schema.automationLogs.humanVerifiedAt }).from(schema.automationLogs))
        .filter((r) => r.at !== null).map((r) => r.id).sort();

describe('stampHumanVerifiedLogs', () => {
    it('stamps only this inspection\'s pending email rows for this tenant', async () => {
        await db.insert(schema.automationLogs).values([
            row('mine'),
            row('other-inspection', { inspectionId: 'insp-2' }),
            row('other-tenant', { tenantId: T2 }),
            row('sms', { channel: 'sms' }),
            row('already-sent', { status: 'sent' }),
        ] as never);
        await stampIfHumanVerified(async () => true, db as never, T1, 'insp-1');
        expect(await stamped()).toEqual(['mine']);
    });

    it('never overwrites an earlier stamp', async () => {
        const first = new Date(1_000);
        await db.insert(schema.automationLogs).values(row('a', { humanVerifiedAt: first })).run();
        await stampIfHumanVerified(async () => true, db as never, T1, 'insp-1');
        const [r] = await db.select().from(schema.automationLogs);
        expect(r!.humanVerifiedAt!.getTime()).toBe(1_000);
    });

    it('stamps nothing when there is no token or it does not verify', async () => {
        await db.insert(schema.automationLogs).values(row('a') as never).run();
        await stampIfHumanVerified(undefined, db as never, T1, 'insp-1');
        await stampIfHumanVerified(async () => false, db as never, T1, 'insp-1');
        expect(await stamped()).toEqual([]);
    });
});
