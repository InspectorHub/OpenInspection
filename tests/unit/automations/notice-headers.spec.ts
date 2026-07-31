/**
 * Communication C1 (design §3.13) — the notice HEADER: one `notifications` row
 * per (rule firing x recipient), created at trigger time, with each of that
 * recipient's channel rows in `automation_logs` stamped `notice_id`.
 *
 * The retry case is the sharp edge: `trigger()` inserts logs with
 * `.onConflictDoNothing()` (report.published dedup), so headers must be
 * created only for rows that ACTUALLY inserted — a retry that conflicts away
 * must not orphan a fresh set of headers.
 */
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
import { insertNoticeHeader } from '../../../server/services/automation/notice-headers';
import { makeManualSendLogger } from '../../../server/services/automation/manual-log';

const TENANT = '00000000-0000-0000-0000-00000000c100';
const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme-c100', status: 'active', phone: '+15550009999',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
    await seedRoleProfiles(db, TENANT, new Date(1));
    svc = new AutomationService({} as D1Database);
    vi.spyOn(svc, 'ensureSeeds').mockResolvedValue();
});

async function seedInspection(id: string) {
    await db.insert(schema.inspections).values({
        id, tenantId: TENANT, propertyAddress: '1 Main',
        date: '2026-07-01', status: 'completed', reportStatus: 'published',
        paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false,
        createdAt: new Date(),
    } as never);
}

async function addContact(id: string, fields: { name: string; email?: string | null; phone?: string | null; type?: 'client' | 'agent' }) {
    await db.insert(schema.contacts).values({
        id, tenantId: TENANT, type: fields.type ?? 'client', name: fields.name,
        email: fields.email ?? null, phone: fields.phone ?? null, createdAt: new Date(),
    } as never);
}

const people = () => new PeopleService({ DB: {} as D1Database });
const allHeaders = () => db.select().from(schema.notifications)
    .where(eq(schema.notifications.tenantId, TENANT)).all();
const allLogs = (insp: string) => db.select().from(schema.automationLogs)
    .where(eq(schema.automationLogs.inspectionId, insp)).all();

describe('trigger() creates notice headers (C1)', () => {
    it('one header per recipient spanning channels; every log row stamped with its header', async () => {
        const insp = 'insp-c1-fanout';
        await seedInspection(insp);
        await addContact('c-jane', { name: 'Jane', email: 'jane@example.com', phone: '+15550001111' });
        await addContact('c-agent', { name: 'Agent', email: 'agent@example.com', phone: '+15550002222', type: 'agent' });
        await people().addPerson(TENANT, insp, 'c-jane', roleProfileId('client'));
        await people().addPerson(TENANT, insp, 'c-agent', roleProfileId('buyer_agent'));
        await svc.create(TENANT, {
            name: 'R-both', trigger: 'report.published', recipientKind: 'all',
            recipientRoleProfileId: null, delayMinutes: 0, channels: ['email', 'sms'],
        });

        await svc.trigger({ tenantId: TENANT, inspectionId: insp, triggerEvent: 'report.published',
            companyName: 'Acme', reportBaseUrl: 'https://acme.example.com' });

        const logs = await allLogs(insp);
        expect(logs.length).toBe(4); // 2 recipients x 2 channels

        const headers = (await allHeaders()).filter((h) => h.contactId != null);
        expect(headers.length).toBe(2); // one per recipient, NOT per channel
        for (const h of headers) {
            expect(h.userId).toBeNull();          // XOR: contact recipient
            expect(h.inspectionId).toBe(insp);
            expect(h.type).toBe('report.published');
        }

        // Each recipient's two channel rows share THEIR header's id.
        const byContact = new Map(headers.map((h) => [h.contactId, h.id]));
        for (const log of logs) {
            expect(log.noticeId).toBe(byContact.get(log.recipientContactId));
        }
    });

    it('a report.published retry that conflicts away creates NO orphan headers', async () => {
        const insp = 'insp-c1-retry';
        await seedInspection(insp);
        await addContact('c-solo', { name: 'Solo', email: 'solo@example.com' });
        await people().addPerson(TENANT, insp, 'c-solo', roleProfileId('client'));
        await svc.create(TENANT, {
            name: 'R-retry', trigger: 'report.published', recipientKind: 'all',
            recipientRoleProfileId: null, delayMinutes: 0, channels: ['email'],
        });
        const fire = () => svc.trigger({ tenantId: TENANT, inspectionId: insp, triggerEvent: 'report.published',
            companyName: 'Acme', reportBaseUrl: 'https://acme.example.com' });

        await fire();
        const after1 = (await allHeaders()).filter((h) => h.contactId != null).length;
        await fire(); // dedup: onConflictDoNothing inserts zero rows
        const after2 = (await allHeaders()).filter((h) => h.contactId != null).length;

        expect(after1).toBe(1);
        expect(after2).toBe(1); // unchanged — no orphans
    });
});

describe('insertNoticeHeader — the XOR invariant the DB cannot express', () => {
    it('throws when BOTH user and contact are set, and when NEITHER is', async () => {
        await expect(insertNoticeHeader(db, {
            tenantId: TENANT, userId: 'u1', contactId: 'c1', type: 'x', title: 'T',
        })).rejects.toThrow(/exactly one/i);
        await expect(insertNoticeHeader(db, {
            tenantId: TENANT, userId: null, contactId: null, type: 'x', title: 'T',
        })).rejects.toThrow(/exactly one/i);
    });
});

describe('manual send logger creates headers (C1)', () => {
    it('one header per contact per batch; rows without a contact keep notice_id NULL', async () => {
        const insp = 'insp-c1-manual';
        await seedInspection(insp);
        await addContact('c-m1', { name: 'M1', email: 'm1@example.com' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const log = makeManualSendLogger(db as any, TENANT, insp, 'email');

        await log({ recipient: 'm1@example.com', contactId: 'c-m1', roleKey: 'client', status: 'sent' });
        await log({ recipient: 'm1-alt@example.com', contactId: 'c-m1', roleKey: 'client', status: 'sent' });
        await log({ recipient: 'stranger@example.com', contactId: null, roleKey: 'other', status: 'failed', error: 'bounced' });

        const headers = (await allHeaders()).filter((h) => h.contactId === 'c-m1');
        expect(headers.length).toBe(1); // batch collapses to one header per contact

        const logs = await allLogs(insp);
        const withContact = logs.filter((l) => l.recipientContactId === 'c-m1');
        expect(withContact.length).toBe(2);
        for (const l of withContact) expect(l.noticeId).toBe(headers[0].id);
        const stranger = logs.find((l) => l.recipient === 'stranger@example.com');
        expect(stranger?.noticeId).toBeNull();
    });
});
