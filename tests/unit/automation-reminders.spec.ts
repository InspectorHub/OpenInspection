import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../server/lib/db/schema';
import { createTestDb, setupSchema } from './db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../server/services/automation.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;
const NOW = Date.parse('2026-05-30T08:00:00Z'); // fixed clock for the test

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    svc = new AutomationService({} as D1Database);
});

async function reminderRule(delayMinutes = 1440) {
    const id = crypto.randomUUID();
    await db.insert(schema.automations).values({
        id, tenantId: TENANT, name: 'Appt reminder', trigger: 'inspection.reminder',
        recipient: 'client', delayMinutes, subjectTemplate: 'Reminder', bodyTemplate: 'See you {{scheduled_date}}',
        active: true, isDefault: false, createdAt: new Date(),
    } as never);
    return id;
}
async function insp(date: string, over: Partial<typeof schema.inspections.$inferInsert> = {}) {
    const id = crypto.randomUUID();
    await db.insert(schema.inspections).values({
        id, tenantId: TENANT, propertyAddress: '1 Main', clientName: 'Jane',
        clientEmail: 'jane@example.com', date, status: 'scheduled', paymentStatus: 'unpaid',
        price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date(), ...over,
    } as never);
    return id;
}
async function logsFor(inspectionId: string) {
    return db.select().from(schema.automationLogs)
        .where(eq(schema.automationLogs.inspectionId, inspectionId));
}

describe('AutomationService.enqueueReminders (Track J D7)', () => {
    it('creates one pending log at date − lead for an upcoming inspection', async () => {
        const ruleId = await reminderRule(1440); // 24h lead
        const i = await insp('2026-05-31'); // tomorrow at 09:00Z → lead 24h → 2026-05-30T09:00Z
        const n = await svc.enqueueReminders(NOW);
        expect(n).toBe(1);
        const [log] = await logsFor(i);
        expect(log.status).toBe('pending');
        expect(log.automationId).toBe(ruleId);
        expect(log.eventId).toBe(`reminder:${ruleId}:${i}`);
        expect(Date.parse(log.sendAt)).toBe(Date.parse('2026-05-30T09:00:00Z'));
    });

    it('floors a near-term reminder to now + 5min', async () => {
        await reminderRule(1440);
        const i = await insp('2026-05-30'); // today 09:00Z; 24h lead is already in the past
        await svc.enqueueReminders(NOW);
        const [log] = await logsFor(i);
        expect(Date.parse(log.sendAt)).toBe(NOW + 5 * 60_000);
    });

    it('is idempotent — re-scan does not double-create', async () => {
        await reminderRule(1440);
        const i = await insp('2026-05-31');
        await svc.enqueueReminders(NOW);
        await svc.enqueueReminders(NOW);
        expect((await logsFor(i)).length).toBe(1);
    });

    it('ignores cancelled/completed inspections and inspections with no client email', async () => {
        await reminderRule(1440);
        await insp('2026-05-31', { status: 'cancelled' });
        await insp('2026-05-31', { clientEmail: null });
        const n = await svc.enqueueReminders(NOW);
        expect(n).toBe(0);
    });

    it('creates nothing when there is no active inspection.reminder rule', async () => {
        await insp('2026-05-31');
        expect(await svc.enqueueReminders(NOW)).toBe(0);
    });

    it('suppresses a reminder whose inspection was cancelled after enqueue', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"id":"re_1"}', { status: 200 })));
        await reminderRule(1440);
        const i = await insp('2026-05-31');
        await svc.enqueueReminders(NOW);
        // inspection gets cancelled before the reminder is due
        await db.update(schema.inspections).set({ status: 'cancelled' }).where(eq(schema.inspections.id, i));
        // force the pending log due now
        await db.update(schema.automationLogs).set({ sendAt: new Date(NOW - 1000).toISOString() })
            .where(eq(schema.automationLogs.inspectionId, i));
        await svc.flush('rk', 'from@x.com', 'Acme', 'https://acme.example.com');
        const [log] = await logsFor(i);
        expect(log.status).toBe('skipped');
        expect(log.error).toMatch(/no longer active/);
        expect(fetch).not.toHaveBeenCalled();
    });
});
