/**
 * There is no shared SMS number, enforced at the send gate.
 *
 * On a hosted deployment, a company whose stored SMS mode is the legacy
 * platform value or the retired shared mode must not send: the gate refuses with
 * `sms not configured`, which the automation log row records and the
 * manual-send API returns. A company on its own account, a company with a
 * registered dedicated number (which then needs carrier approval), and every
 * self-hosted company are not held. The old SMS_MANAGED_SHARED_ENABLED switch is
 * retired and changes nothing. Each refusal sits beside a positive control.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { managedSendAllowed } from '../../../server/lib/sms/managed-send-gate';
import { smsSendGate } from '../../../server/lib/sms/send-gate';
import { AutomationService } from '../../../server/services/automation.service';
import { SmsConsentService } from '../../../server/services/sms-consent.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import type { EmailService } from '../../../server/services/email.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
let db: BetterSQLite3Database<typeof schema>;

const HOSTED = { APP_MODE: 'saas' };
const POOL = { TWILIO_SHARED_MESSAGING_SERVICE_SID: 'MGdep' };

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'acme', status: 'active', phone: '+15550001111',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
});

describe('managedSendAllowed: the hold', () => {
    it.each(['platform', 'managed_shared'])('hosted + %s: refused as sms not configured', async (mode) => {
        expect(await managedSendAllowed(db as never, { ...HOSTED, ...POOL }, TENANT, mode))
            .toEqual({ allowed: false, reason: 'sms not configured' });
    });

    it('hosted + own is unaffected (control)', async () => {
        expect(await managedSendAllowed(db as never, HOSTED, TENANT, 'own')).toEqual({ allowed: true });
    });

    it('standalone + platform is unaffected (control)', async () => {
        expect(await managedSendAllowed(db as never, {}, TENANT, 'platform')).toEqual({ allowed: true });
    });

    it('hosted + managed_dedicated is not held: it goes on to the carrier approval check (control for the refusals above)', async () => {
        expect(await managedSendAllowed(db as never, HOSTED, TENANT, 'managed_dedicated'))
            .toEqual({ allowed: false, reason: 'managed_not_approved' });
    });

    it('the retired switch changes nothing', async () => {
        const on = { ...HOSTED, ...POOL, SMS_MANAGED_SHARED_ENABLED: 'true' } as never;
        for (const mode of ['platform', 'managed_shared']) {
            expect(await managedSendAllowed(db as never, on, TENANT, mode))
                .toEqual({ allowed: false, reason: 'sms not configured' });
        }
    });

    it('a profile the caller already resolved is honoured', async () => {
        const { SAAS_PROFILE } = await import('../../../server/lib/deployment-profile');
        expect(await managedSendAllowed(db as never, { profile: SAAS_PROFILE }, TENANT, 'platform'))
            .toMatchObject({ allowed: false, reason: 'sms not configured' });
    });
});

describe('smsSendGate: the same refusal on the shared chain', () => {
    async function setMode(mode: 'platform' | 'own') {
        await db.insert(schema.tenantConfigs).values({ tenantId: TENANT, smsMode: mode, updatedAt: new Date() } as never);
    }
    const gate = (env: object) => smsSendGate({ db: db as never, tenantId: TENANT, to: '+15551234567', purpose: 'test', env, bodyTemplate: 'hello' });

    it('hosted platform mode: refused; a company with no config row is the same', async () => {
        expect(await gate(HOSTED)).toEqual({ allowed: false, reason: 'sms not configured' });
        await setMode('platform');
        expect(await gate(HOSTED)).toEqual({ allowed: false, reason: 'sms not configured' });
    });

    it('hosted own mode passes (control)', async () => {
        await setMode('own');
        expect(await gate(HOSTED)).toMatchObject({ allowed: true });
    });
});

describe('automation flush: the refusal is recorded on the log row', () => {
    const fakeSend = vi.fn().mockResolvedValue({ ok: true });
    const runtime = { resolveProvider: vi.fn().mockResolvedValue({ provider: { sendMessage: fakeSend, validateInboundSignature: vi.fn() }, from: '+1999' }) };
    const emailFor = async () => ({ sendEmail: async () => ({ delivered: true }) } as unknown as EmailService);

    async function seedLog(mode: 'platform' | 'own') {
        await seedRoleProfiles(asD1Db(db), TENANT, new Date(1));
        await db.insert(schema.tenantConfigs).values({ tenantId: TENANT, smsMode: mode, updatedAt: new Date() } as never);
        await new SmsConsentService({} as D1Database).publishDisclosure('disclosure');
        const inspId = crypto.randomUUID();
        await db.insert(schema.inspections).values({
            id: inspId, tenantId: TENANT, propertyAddress: '1 Main', date: '2026-07-01', status: 'completed',
            reportStatus: 'published', paymentStatus: 'paid', price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as never);
        await db.insert(schema.contacts).values({ id: 'c1', tenantId: TENANT, type: 'client', name: 'Jane', email: 'j@x.test', phone: '+15551234567', createdAt: new Date() } as never);
        await new PeopleService({ DB: {} as D1Database }).addPerson(TENANT, inspId, 'c1', `crp_${TENANT}_client`);
        const tpl = crypto.randomUUID();
        await db.insert(schema.messageTemplates).values({ id: tpl, tenantId: TENANT, name: 'R', channel: 'sms', subject: null, body: 'Hi {{client_name}}', variables: null, isSeeded: false, createdAt: new Date(), updatedAt: new Date() } as never);
        const rule = crypto.randomUUID();
        await db.insert(schema.automations).values({
            id: rule, tenantId: TENANT, name: 'R', trigger: 'report.published', recipientKind: 'role',
            recipientRoleProfileId: `crp_${TENANT}_client`, delayMinutes: 0, smsTemplateId: tpl,
            channels: '["sms"]', active: true, isDefault: false, createdAt: new Date(),
        } as never);
        const logId = crypto.randomUUID();
        await db.insert(schema.automationLogs).values({
            id: logId, tenantId: TENANT, automationId: rule, inspectionId: inspId, recipient: '+15551234567', channel: 'sms',
            recipientRoleKey: 'client', sendAt: new Date(Date.now() - 1000), status: 'pending',
        } as never);
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});
        return logId;
    }
    const row = (id: string) => db.select().from(schema.automationLogs).where(eq(schema.automationLogs.id, id)).get();
    const run = (env: object) => new AutomationService({} as D1Database).flush(emailFor, 'Acme', 'https://acme.example.com', runtime, 50, env);

    beforeEach(() => { fakeSend.mockClear(); });

    it('hosted platform mode: skipped with the reason, nothing sent', async () => {
        const id = await seedLog('platform');
        await run(HOSTED);
        expect(await row(id)).toMatchObject({ status: 'skipped', error: 'sms not configured' });
        expect(fakeSend).not.toHaveBeenCalled();
    });

    it('hosted own mode sends as before (control)', async () => {
        const id = await seedLog('own');
        await run(HOSTED);
        expect((await row(id))?.status).toBe('sent');
        expect(fakeSend).toHaveBeenCalledTimes(1);
    });

    it('hosted platform mode with the retired switch set: still skipped', async () => {
        const id = await seedLog('platform');
        await run({ ...HOSTED, SMS_MANAGED_SHARED_ENABLED: 'true' });
        expect(await row(id)).toMatchObject({ status: 'skipped', error: 'sms not configured' });
    });
});
