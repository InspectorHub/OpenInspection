import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../server/lib/db/schema';
import { createTestDb, setupSchema } from './db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../server/services/automation.service';
import { SmsConsentService } from '../../server/services/sms-consent.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;

const CREDS = { sid: 'ACx', token: 'tok', from: '+1999' };
const smsRuntime = { resolveCreds: vi.fn().mockResolvedValue(CREDS) };

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db; await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active', phone: '+15550001111',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
    svc = new AutomationService({} as D1Database);
    await new SmsConsentService({} as D1Database).publishDisclosure('disclosure');
    smsRuntime.resolveCreds.mockResolvedValue(CREDS);
});

async function seedSmsLog(over: { contactId?: string | null } = {}) {
    const inspId = crypto.randomUUID();
    await db.insert(schema.inspections).values({
        id: inspId, tenantId: TENANT, propertyAddress: '1 Main', clientName: 'Jane',
        clientEmail: 'jane@example.com', clientPhone: '+15551234567',
        clientContactId: over.contactId ?? null, date: '2026-07-01', status: 'published',
        paymentStatus: 'paid', price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date(),
    } as never);
    const ruleId = crypto.randomUUID();
    await db.insert(schema.automations).values({
        id: ruleId, tenantId: TENANT, name: 'R', trigger: 'report.published', recipient: 'client',
        delayMinutes: 0, subjectTemplate: 'S', bodyTemplate: 'B', smsBody: 'Hi {{client_name}} — {{company_name}}',
        channels: '["sms"]', channel: 'sms', active: true, isDefault: false, createdAt: new Date(),
    } as never);
    const logId = crypto.randomUUID();
    await db.insert(schema.automationLogs).values({
        id: logId, tenantId: TENANT, automationId: ruleId, inspectionId: inspId,
        recipient: '+15551234567', channel: 'sms',
        sendAt: new Date(Date.now() - 1000).toISOString(), status: 'pending',
    } as never);
    return { logId, inspId };
}

const statusOf = async (id: string) =>
    (await db.select().from(schema.automationLogs).where(eq(schema.automationLogs.id, id)).get());

describe('flush() — SMS branch (Track L)', () => {
    beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"sid":"SM1"}', { status: 201 }))));

    it('client SMS without consent → skipped', async () => {
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        await svc.flush('', '', 'Acme', 'https://acme.example.com', smsRuntime);
        const r = await statusOf(logId);
        expect(r?.status).toBe('skipped');
        expect(r?.error).toMatch(/consent/);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('client SMS with granted consent → sent via Twilio', async () => {
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});
        await svc.flush('', '', 'Acme', 'https://acme.example.com', smsRuntime);
        expect((await statusOf(logId))?.status).toBe('sent');
        const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(url).toContain('/Accounts/ACx/Messages.json');
    });

    it('no resolvable creds → skipped (fail-closed), no fetch', async () => {
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});
        smsRuntime.resolveCreds.mockResolvedValueOnce(null);
        await svc.flush('', '', 'Acme', 'https://acme.example.com', smsRuntime);
        expect((await statusOf(logId))?.status).toBe('skipped');
        expect((await statusOf(logId))?.error).toMatch(/not configured/);
        expect(fetch).not.toHaveBeenCalled();
    });
});

// Step 3b — reminder due-time is DERIVED live from inspection.date, NOT the
// stored send_at. These prove flush ignores send_at for inspection.reminder logs.
describe('flush() — derived reminder due-time (Track L Step 3b)', () => {
    beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"id":"re_1"}', { status: 200 }))));

    async function seedReminder(dateStr: string) {
        const inspId = crypto.randomUUID();
        await db.insert(schema.inspections).values({
            id: inspId, tenantId: TENANT, propertyAddress: '1 Main', clientName: 'Jane',
            clientEmail: 'jane@example.com', date: dateStr, status: 'confirmed',
            paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as never);
        const ruleId = crypto.randomUUID();
        await db.insert(schema.automations).values({
            id: ruleId, tenantId: TENANT, name: 'Reminder', trigger: 'inspection.reminder', recipient: 'client',
            delayMinutes: 1440, subjectTemplate: 'Reminder', bodyTemplate: 'See you tomorrow',
            channels: '["email"]', channel: 'email', active: true, isDefault: false, createdAt: new Date(),
        } as never);
        const logId = crypto.randomUUID();
        await db.insert(schema.automationLogs).values({
            id: logId, tenantId: TENANT, automationId: ruleId, inspectionId: inspId,
            recipient: 'jane@example.com', channel: 'email',
            // FAR-FUTURE stored send_at — flush must ignore it for reminders.
            sendAt: new Date(Date.now() + 365 * 24 * 3600_000).toISOString(),
            status: 'pending', eventId: `reminder:${ruleId}:${inspId}:email`,
        } as never);
        return logId;
    }

    it('processes a reminder whose DERIVED due is now (date=tomorrow) despite a far-future send_at', async () => {
        const tomorrow = new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 10);
        const logId = await seedReminder(tomorrow);
        await svc.flush('rk', 'from@x.com', 'Acme', 'https://acme.example.com');
        // tomorrow@09:00Z − 1440min(=1 day) ≈ today@09:00Z <= now → due → sent.
        expect((await statusOf(logId))?.status).toBe('sent');
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('leaves a reminder pending when its DERIVED due is in the future (date two weeks out)', async () => {
        const twoWeeks = new Date(Date.now() + 14 * 24 * 3600_000).toISOString().slice(0, 10);
        const logId = await seedReminder(twoWeeks);
        await svc.flush('rk', 'from@x.com', 'Acme', 'https://acme.example.com');
        expect((await statusOf(logId))?.status).toBe('pending');
        expect(fetch).not.toHaveBeenCalled();
    });
});
