/**
 * What flush() records about having LOOKED at a row, and in what order it
 * looks.
 *
 * Both exist because of the same production shape: three `report.published`
 * logs sat `pending` with a null `error` for fourteen hours and then delivered
 * normally. Every exit in the delivery paths writes a terminal status, so that
 * state could only mean flush never finished with them — but nothing recorded
 * whether it had ever STARTED, so "the cron did not run" and "the isolate died
 * mid-batch" were the same row, and neither was visible while it was happening.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, asc } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../../server/services/automation.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import type { EmailService } from '../../../server/services/email.service';

const TENANT = '00000000-0000-0000-0000-0000000c1a10';

let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'acme-c1a10', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
    await seedRoleProfiles(asD1Db(db), TENANT, new Date(1));
    svc = new AutomationService({} as D1Database);
    vi.spyOn(svc, 'ensureSeeds').mockResolvedValue();
    await db.insert(schema.inspections).values({
        id: 'insp-1', tenantId: TENANT, propertyAddress: '1 Main St',
        date: '2026-07-01', status: 'completed', reportStatus: 'published',
        paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false,
        createdAt: new Date(),
    } as never);
});

async function seedLog(id: string, sendAt: Date) {
    await db.insert(schema.automationLogs).values({
        id, tenantId: TENANT, automationId: null, inspectionId: 'insp-1',
        recipient: `${id}@example.com`, channel: 'in_app', sendAt, status: 'pending',
    } as never);
}

/** in_app rows settle inside flush() with no transport at all, so these tests
 *  never need an email service that does anything. */
const emailFor = async () => ({ sendEmail: vi.fn() } as unknown as EmailService);

describe('flush() — claim stamp', () => {
    it('records the claim BEFORE dispatch, so a row picked up once is distinguishable from one never seen', async () => {
        await seedLog('log-claimed', new Date(Date.now() - 1000));
        // Not due — flush must not touch it, or "attempts = 0" stops meaning
        // "never picked up" and the whole signal is noise.
        await seedLog('log-untouched', new Date(Date.now() + 60 * 60 * 1000));

        await svc.flush(emailFor, 'Acme', 'https://acme.example.com');

        const claimed = await db.select().from(schema.automationLogs)
            .where(eq(schema.automationLogs.id, 'log-claimed')).get();
        expect(claimed?.attempts).toBe(1);
        expect(claimed?.lastAttemptAt).not.toBeNull();

        const untouched = await db.select().from(schema.automationLogs)
            .where(eq(schema.automationLogs.id, 'log-untouched')).get();
        expect(untouched?.attempts).toBe(0);
        expect(untouched?.lastAttemptAt).toBeNull();
    });

    it('counts a SECOND claim of a row that survived the first, which is the fingerprint of a batch that died mid-flight', async () => {
        // Terminal rows leave the due query, so the only way to be claimed
        // twice is to still be pending on the next tick.
        await seedLog('log-stuck', new Date(Date.now() - 1000));
        await db.update(schema.automationLogs)
            .set({ status: 'pending' })
            .where(eq(schema.automationLogs.id, 'log-stuck'));

        await svc.flush(emailFor, 'Acme', 'https://acme.example.com');
        // Put it back to pending: stands in for the isolate being killed
        // between the claim and the outcome write.
        await db.update(schema.automationLogs)
            .set({ status: 'pending', deliveredAt: null })
            .where(eq(schema.automationLogs.id, 'log-stuck'));
        await svc.flush(emailFor, 'Acme', 'https://acme.example.com');

        const row = await db.select().from(schema.automationLogs)
            .where(eq(schema.automationLogs.id, 'log-stuck')).get();
        expect(row?.attempts).toBe(2);
    });
});

describe('flush() — batch order', () => {
    it('drains OLDEST DUE FIRST when the backlog is larger than one batch', async () => {
        const base = Date.now() - 10 * 60 * 1000;
        // Inserted newest-first so insertion order (rowid) disagrees with
        // send_at — without an ORDER BY the planner is free to return either,
        // and this test would be asserting the scan order by accident.
        for (let i = 9; i >= 0; i--) {
            await seedLog(`log-${String(i).padStart(2, '0')}`, new Date(base + i * 1000));
        }

        await svc.flush(emailFor, 'Acme', 'https://acme.example.com', undefined, /* batchSize */ 4);

        const settled = await db.select().from(schema.automationLogs)
            .where(eq(schema.automationLogs.status, 'sent'))
            .orderBy(asc(schema.automationLogs.sendAt)).all();
        expect(settled.map((r) => r.id)).toEqual(['log-00', 'log-01', 'log-02', 'log-03']);
    });
});
