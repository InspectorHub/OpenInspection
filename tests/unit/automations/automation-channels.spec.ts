import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../../server/services/automation.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';

const TENANT = '00000000-0000-0000-0000-000000000001';
const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;
let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;

// Task 11a — resolveAddress sources the primary client's email/phone from
// inspection_people, so each fixture below needs a contact + inspection_people
// row for the 'client' role alongside the (now-unread) legacy columns.
async function seedPrimaryClient(inspectionId: string, contactId: string, fields: { name: string; email?: string | null; phone?: string | null }) {
    await db.insert(schema.contacts).values({
        id: contactId, tenantId: TENANT, type: 'client', name: fields.name,
        email: fields.email ?? null, phone: fields.phone ?? null, createdAt: new Date(),
    } as never);
    await new PeopleService({ DB: {} as D1Database }).addPerson(TENANT, inspectionId, contactId, roleProfileId('client'));
}

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await seedRoleProfiles(db, TENANT, new Date(1));
    svc = new AutomationService({} as D1Database);
});

describe('AutomationService — channels + sms_body (Track L)', () => {
    it('create persists channels and smsTemplateId (SP2: embedded body fields replaced by template ids)', async () => {
        const row = await svc.create(TENANT, {
            name: 'Multi', trigger: 'report.published', recipientKind: 'role', recipientRoleProfileId: roleProfileId('client'),
            delayMinutes: 0,
            channels: ['email', 'sms'], smsTemplateId: 'tpl-sms-1',
        });
        // Track L (Part A) — create/update parse channels on output (array, not JSON string).
        expect(row.channels).toEqual(['email', 'sms']);
        // SP2: smsBody is a dead column (null); template id round-trips instead.
        expect(row.smsTemplateId).toBe('tpl-sms-1');
    });

    it('create defaults to email-only channels when omitted', async () => {
        const row = await svc.create(TENANT, {
            name: 'Default', trigger: 'report.published', recipientKind: 'role', recipientRoleProfileId: roleProfileId('client'),
            delayMinutes: 0,
        });
        expect(row.channels).toEqual(['email']);
        // SP2: smsBody column is written null by create(); smsTemplateId is also null by default.
        expect(row.smsTemplateId).toBeNull();
    });

    it('update can change channels and smsTemplateId (SP2)', async () => {
        const created = await svc.create(TENANT, {
            name: 'U', trigger: 'report.published', recipientKind: 'role', recipientRoleProfileId: roleProfileId('client'),
            delayMinutes: 0,
        });
        const updated = await svc.update(TENANT, created.id, {
            channels: ['email', 'sms'], smsTemplateId: 'tpl-upd',
        });
        expect(updated.channels).toEqual(['email', 'sms']);
        expect(updated.smsTemplateId).toBe('tpl-upd');
    });

    it('trigger fans out one log per channel for a client with email + phone', async () => {
        const inspId = crypto.randomUUID();
        await db.insert(schema.inspections).values({
            id: inspId, tenantId: TENANT, propertyAddress: '1 Main', date: '2026-07-01',
            status: 'completed', reportStatus: 'published', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as never);
        await seedPrimaryClient(inspId, 'c-jane', { name: 'Jane', email: 'jane@example.com', phone: '(555) 123-4567' });
        const created = await svc.create(TENANT, {
            name: 'R', trigger: 'report.published', recipientKind: 'role', recipientRoleProfileId: roleProfileId('client'),
            delayMinutes: 0,
            channels: ['email', 'sms'], smsTemplateId: 'tpl-sms',
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
            id: inspId, tenantId: TENANT, propertyAddress: '2 Main', date: '2026-07-02',
            status: 'completed', reportStatus: 'published', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as never);
        await seedPrimaryClient(inspId, 'c-joe', { name: 'Joe', email: 'joe@example.com', phone: null });
        const created = await svc.create(TENANT, {
            name: 'R2', trigger: 'report.published', recipientKind: 'role', recipientRoleProfileId: roleProfileId('client'),
            delayMinutes: 0,
            channels: ['email', 'sms'], smsTemplateId: 'tpl-sms',
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
            name: 'L1', trigger: 'report.published', recipientKind: 'role', recipientRoleProfileId: roleProfileId('client'),
            delayMinutes: 0,
            channels: ['email', 'sms'],
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
            id: inspId, tenantId: TENANT, propertyAddress: '3 Main', date: future,
            status: 'scheduled', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as never);
        await seedPrimaryClient(inspId, 'c-ann', { name: 'Ann', email: 'ann@example.com', phone: '555-123-4567' });
        const created = await svc.create(TENANT, {
            name: 'Reminder', trigger: 'inspection.reminder', recipientKind: 'role', recipientRoleProfileId: roleProfileId('client'),
            delayMinutes: 1440,
            channels: ['email', 'sms'], smsTemplateId: 'tpl-reminder',
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
