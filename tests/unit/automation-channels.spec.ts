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

describe('AutomationService — channels + sms_body (Track L)', () => {
    it('create persists channels and sms_body', async () => {
        const row = await svc.create(TENANT, {
            name: 'Multi', trigger: 'report.published', recipient: 'client',
            delayMinutes: 0, subjectTemplate: 's', bodyTemplate: 'b',
            channels: ['email', 'sms'], smsBody: 'Your report is ready',
        });
        // Track L (Part A) — create/update parse channels on output (array, not JSON string).
        expect(row.channels).toEqual(['email', 'sms']);
        expect(row.smsBody).toBe('Your report is ready');
    });

    it('create defaults to email-only channels when omitted', async () => {
        const row = await svc.create(TENANT, {
            name: 'Default', trigger: 'report.published', recipient: 'client',
            delayMinutes: 0, subjectTemplate: 's', bodyTemplate: 'b',
        });
        expect(row.channels).toEqual(['email']);
        expect(row.smsBody).toBeNull();
    });

    it('update can change channels and sms_body', async () => {
        const created = await svc.create(TENANT, {
            name: 'U', trigger: 'report.published', recipient: 'client',
            delayMinutes: 0, subjectTemplate: 's', bodyTemplate: 'b',
        });
        const updated = await svc.update(TENANT, created.id, {
            channels: ['email', 'sms'], smsBody: 'hi',
        });
        expect(updated.channels).toEqual(['email', 'sms']);
        expect(updated.smsBody).toBe('hi');
    });

    it('trigger fans out one log per channel for a client with email + phone', async () => {
        const inspId = crypto.randomUUID();
        await db.insert(schema.inspections).values({
            id: inspId, tenantId: TENANT, propertyAddress: '1 Main', clientName: 'Jane',
            clientEmail: 'jane@example.com', clientPhone: '(555) 123-4567', date: '2026-07-01',
            status: 'completed', reportStatus: 'published', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as never);
        const created = await svc.create(TENANT, {
            name: 'R', trigger: 'report.published', recipient: 'client',
            delayMinutes: 0, subjectTemplate: 's', bodyTemplate: 'b',
            channels: ['email', 'sms'], smsBody: 'sms',
        });
        await svc.trigger({ tenantId: TENANT, inspectionId: inspId, triggerEvent: 'report.published',
            companyName: 'Acme', reportBaseUrl: 'https://acme.example.com' });
        const logs = (await db.select().from(schema.automationLogs)
            .where(eq(schema.automationLogs.inspectionId, inspId)).all())
            .filter((l) => l.automationId === created.id);
        const byChannel = Object.fromEntries(logs.map((l) => [l.channel, l.recipient]));
        expect(byChannel.email).toBe('jane@example.com');
        expect(byChannel.sms).toBe('+15551234567'); // normalized at resolution
        expect(logs.map((l) => l.channel).sort()).toEqual(['email', 'sms']);
    });

    it('trigger skips the sms log when the client has no phone', async () => {
        const inspId = crypto.randomUUID();
        await db.insert(schema.inspections).values({
            id: inspId, tenantId: TENANT, propertyAddress: '2 Main', clientName: 'Joe',
            clientEmail: 'joe@example.com', date: '2026-07-02',
            status: 'completed', reportStatus: 'published', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as never);
        const created = await svc.create(TENANT, {
            name: 'R2', trigger: 'report.published', recipient: 'client',
            delayMinutes: 0, subjectTemplate: 's', bodyTemplate: 'b',
            channels: ['email', 'sms'], smsBody: 'sms',
        });
        await svc.trigger({ tenantId: TENANT, inspectionId: inspId, triggerEvent: 'report.published',
            companyName: 'Acme', reportBaseUrl: 'https://acme.example.com' });
        const logs = (await db.select().from(schema.automationLogs)
            .where(eq(schema.automationLogs.inspectionId, inspId)).all())
            .filter((l) => l.automationId === created.id);
        expect(logs.map((l) => l.channel)).toEqual(['email']);
    });

    it('list() parses the JSON channels column to a string[] on output (Part A)', async () => {
        await svc.create(TENANT, {
            name: 'L1', trigger: 'report.published', recipient: 'client',
            delayMinutes: 0, subjectTemplate: 's', bodyTemplate: 'b',
            channels: ['email', 'sms'], smsBody: 'sms',
        });
        const rows = await svc.list(TENANT);
        const row = rows.find((r) => r.name === 'L1');
        expect(Array.isArray(row?.channels)).toBe(true);
        expect(row?.channels).toEqual(['email', 'sms']);
    });

    it('enqueueReminders fans out a pending log per channel with channel-appropriate recipient', async () => {
        const inspId = crypto.randomUUID();
        const future = new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 10);
        await db.insert(schema.inspections).values({
            id: inspId, tenantId: TENANT, propertyAddress: '3 Main', clientName: 'Ann',
            clientEmail: 'ann@example.com', clientPhone: '555-123-4567', date: future,
            status: 'scheduled', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as never);
        const created = await svc.create(TENANT, {
            name: 'Reminder', trigger: 'inspection.reminder', recipient: 'client',
            delayMinutes: 1440, subjectTemplate: 's', bodyTemplate: 'b',
            channels: ['email', 'sms'], smsBody: 'reminder',
        });
        const n = await svc.enqueueReminders(Date.now());
        expect(n).toBe(2);
        const logs = (await db.select().from(schema.automationLogs)
            .where(eq(schema.automationLogs.inspectionId, inspId)).all())
            .filter((l) => l.automationId === created.id);
        const byChannel = Object.fromEntries(logs.map((l) => [l.channel, l.recipient]));
        expect(byChannel.email).toBe('ann@example.com');
        expect(byChannel.sms).toBe('+15551234567');
        // dedup key is per-channel
        expect(logs.map((l) => l.eventId).sort()).toEqual([
            `reminder:${created.id}:${inspId}:email`,
            `reminder:${created.id}:${inspId}:sms`,
        ]);
        // a re-scan does not double-create
        expect(await svc.enqueueReminders(Date.now())).toBe(0);
    });
});
