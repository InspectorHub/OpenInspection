import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../server/lib/db/schema';
import { createTestDb, setupSchema } from './db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../server/services/automation.service';
import { SmsConsentService } from '../../server/services/sms-consent.service';
import type { EmailService } from '../../server/services/email.service';
import { PlanQuotaGuard } from '../../server/features/plan-quota/guard';

// Stub emailFor factory: returns a no-op EmailService (SMS tests don't exercise the email path).
const stubEmailFor = async (_tid: string) => ({ sendEmail: async () => ({ delivered: true }) } as unknown as EmailService);

const TENANT = '00000000-0000-0000-0000-000000000001';
let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;

// Provider-shaped fake: wraps a sendMessage mock — same intent as the old
// resolveCreds + sendTwilioSms pair. Twilio path assertion changed from
// "fetch was called with /Accounts/ACx/Messages.json" to "sendMessage was
// called with the right recipient" because the provider abstraction removes
// the direct Twilio REST call from this test's scope.
const fakeSendMessage = vi.fn().mockResolvedValue({ ok: true });
const fakeProvider = { sendMessage: fakeSendMessage, validateInboundSignature: vi.fn().mockResolvedValue(false) };
const smsRuntime = { resolveProvider: vi.fn().mockResolvedValue({ provider: fakeProvider, from: '+1999' }) };

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
    smsRuntime.resolveProvider.mockResolvedValue({ provider: fakeProvider, from: '+1999' });
    fakeSendMessage.mockResolvedValue({ ok: true });
});

async function seedSmsLog(over: { contactId?: string | null; smsBody?: string } = {}) {
    const inspId = crypto.randomUUID();
    await db.insert(schema.inspections).values({
        id: inspId, tenantId: TENANT, propertyAddress: '1 Main', clientName: 'Jane',
        clientEmail: 'jane@example.com', clientPhone: '+15551234567',
        clientContactId: over.contactId ?? null, date: '2026-07-01', status: 'completed',
        reportStatus: 'published', paymentStatus: 'paid', price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date(),
    } as never);
    const ruleId = crypto.randomUUID();
    const smsBody = over.smsBody ?? 'Hi {{client_name}} — {{company_name}}';
    await db.insert(schema.automations).values({
        id: ruleId, tenantId: TENANT, name: 'R', trigger: 'report.published', recipient: 'client',
        delayMinutes: 0, subjectTemplate: 'S', bodyTemplate: 'B', smsBody,
        channels: '["sms"]', channel: 'sms', active: true, isDefault: false, createdAt: new Date(),
    } as never);
    const logId = crypto.randomUUID();
    await db.insert(schema.automationLogs).values({
        id: logId, tenantId: TENANT, automationId: ruleId, inspectionId: inspId,
        recipient: '+15551234567', channel: 'sms',
        sendAt: new Date(Date.now() - 1000).toISOString(), status: 'pending',
    } as never);
    // SP2 — give the seeded sms rule a referenced template (body == embedded smsBody),
    // so the decoupled SMS delivery renders byte-identical output.
    const { backfillAutomationTemplates } = await import('../../server/services/message-template-backfill');
    await backfillAutomationTemplates({} as D1Database, TENANT);
    return { logId, inspId };
}

const statusOf = async (id: string) =>
    (await db.select().from(schema.automationLogs).where(eq(schema.automationLogs.id, id)).get());

describe('flush() — SMS branch (Track L)', () => {
    beforeEach(() => {
        fakeSendMessage.mockClear();
        smsRuntime.resolveProvider.mockClear();
        smsRuntime.resolveProvider.mockResolvedValue({ provider: fakeProvider, from: '+1999' });
        fakeSendMessage.mockResolvedValue({ ok: true });
    });

    it('client SMS without consent → skipped', async () => {
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com', smsRuntime);
        const r = await statusOf(logId);
        expect(r?.status).toBe('skipped');
        expect(r?.error).toMatch(/consent/);
        // Provider not called (skipped before resolve)
        expect(fakeSendMessage).not.toHaveBeenCalled();
    });

    it('client SMS with granted consent → sent via provider', async () => {
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});
        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com', smsRuntime);
        expect((await statusOf(logId))?.status).toBe('sent');
        // Provider's sendMessage must have been called with the log recipient
        expect(fakeSendMessage).toHaveBeenCalledTimes(1);
        const call = fakeSendMessage.mock.calls[0][0] as { to: string; body: string; from?: string };
        expect(call.to).toBe('+15551234567');
        expect(typeof call.body).toBe('string');
    });

    it('no resolvable provider → skipped (fail-closed), no send', async () => {
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});
        smsRuntime.resolveProvider.mockResolvedValueOnce(null);
        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com', smsRuntime);
        expect((await statusOf(logId))?.status).toBe('skipped');
        expect((await statusOf(logId))?.error).toMatch(/not configured/);
        expect(fakeSendMessage).not.toHaveBeenCalled();
    });

    it('SP2: deliverSms resolves the referenced sms template body', async () => {
        // Arrange: seedSmsLog backfills → smsTemplateId is set; smsBody='Hi {{client_name}} — {{company_name}}'.
        // Grant consent so delivery proceeds past the consent gate.
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});
        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com', smsRuntime);
        // Status must be 'sent' — resolved template body was rendered and delivered.
        expect((await statusOf(logId))?.status).toBe('sent');
        expect(fakeSendMessage).toHaveBeenCalledTimes(1);
        const call = fakeSendMessage.mock.calls[0][0] as { to: string; body: string; from?: string };
        // The resolved template body is 'Hi {{client_name}} — {{company_name}}';
        // after interpolation it must contain the client name and the tenant/company name.
        expect(call.body).toContain('Jane');   // client_name
        expect(call.body).toContain('Acme');   // company_name (tenant name)
    });

    it('SP2: deliverSms preserves the review_url fail-closed skip on the resolved body', async () => {
        // Arrange: seed an sms rule whose body includes {{review_url}}.
        // The backfill in seedSmsLog creates an sms template with that body.
        // tenant_configs.review_url is NOT set, so delivery must skip fail-closed.
        const { logId } = await seedSmsLog({ contactId: 'c1', smsBody: 'Visit {{review_url}}' });
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});
        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com', smsRuntime);
        expect((await statusOf(logId))?.status).toBe('skipped');
        expect((await statusOf(logId))?.error).toBe('review_url not configured');
        expect(fakeSendMessage).not.toHaveBeenCalled();
    });

    it('managed mode: sendMessage receives messagingServiceSid (not from)', async () => {
        // Arrange: resolve returns a managed bag — messagingServiceSid set, from absent.
        // The managed send path must pass messagingServiceSid through to sendMessage
        // and must NOT require a from number (managed Messaging Services supply that).
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});
        smsRuntime.resolveProvider.mockResolvedValueOnce({
            provider: fakeProvider,
            from: null,
            messagingServiceSid: 'MG_test_service_sid',
        });
        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com', smsRuntime);
        expect((await statusOf(logId))?.status).toBe('sent');
        expect(fakeSendMessage).toHaveBeenCalledTimes(1);
        const call = fakeSendMessage.mock.calls[0][0] as {
            to: string; body: string; from?: string; messagingServiceSid?: string;
        };
        // messagingServiceSid must be forwarded to the provider.
        expect(call.messagingServiceSid).toBe('MG_test_service_sid');
        // from must NOT be set when managed (null from → no from arg).
        expect(call.from).toBeUndefined();
        expect(call.to).toBe('+15551234567');
    });

    it('own/platform mode: sendMessage does NOT receive messagingServiceSid', async () => {
        // The existing own/platform path (from set, no messagingServiceSid) must be unchanged.
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});
        // Default smsRuntime already returns { provider, from: '+1999' } — no messagingServiceSid.
        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com', smsRuntime);
        expect((await statusOf(logId))?.status).toBe('sent');
        expect(fakeSendMessage).toHaveBeenCalledTimes(1);
        const call = fakeSendMessage.mock.calls[0][0] as {
            to: string; body: string; from?: string; messagingServiceSid?: string;
        };
        expect(call.from).toBe('+1999');
        expect(call.messagingServiceSid).toBeUndefined();
    });
});

describe('flush() — managed-send compliance gate (Task 8)', () => {
    beforeEach(() => {
        fakeSendMessage.mockClear();
        smsRuntime.resolveProvider.mockClear();
        smsRuntime.resolveProvider.mockResolvedValue({
            provider: fakeProvider, from: null, messagingServiceSid: 'MG_managed',
        });
        fakeSendMessage.mockResolvedValue({ ok: true });
    });

    // Seed a managed_dedicated or managed_shared tenant config row.
    async function setSmsMode(mode: 'managed_dedicated' | 'managed_shared' | 'own' | 'platform') {
        // upsert tenant_configs.smsMode for TENANT
        const existing = await db.select().from(schema.tenantConfigs)
            .where(eq(schema.tenantConfigs.tenantId, TENANT)).get();
        if (existing) {
            await db.update(schema.tenantConfigs).set({ smsMode: mode })
                .where(eq(schema.tenantConfigs.tenantId, TENANT));
        } else {
            await db.insert(schema.tenantConfigs).values({
                tenantId: TENANT, smsMode: mode, updatedAt: new Date(),
            } as never);
        }
    }

    async function seedCompliance(complianceStatus: string) {
        const now = new Date();
        await db.insert(schema.messagingCompliance).values({
            tenantId: TENANT,
            mode: 'managed_dedicated',
            complianceStatus,
            createdAt: now,
            updatedAt: now,
        } as never);
    }

    it('managed_dedicated with non-approved compliance → skipped (managed_not_approved), no send', async () => {
        await setSmsMode('managed_dedicated');
        await seedCompliance('campaign_pending');
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        // Grant consent so the consent gate does not interfere.
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});
        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com', smsRuntime);
        const r = await statusOf(logId);
        expect(r?.status).toBe('skipped');
        expect(r?.error).toBe('managed_not_approved');
        expect(fakeSendMessage).not.toHaveBeenCalled();
    });

    it('managed_dedicated with no compliance row → skipped (fail-closed), no send', async () => {
        await setSmsMode('managed_dedicated');
        // No messaging_compliance row seeded — fail-closed.
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});
        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com', smsRuntime);
        const r = await statusOf(logId);
        expect(r?.status).toBe('skipped');
        expect(r?.error).toBe('managed_not_approved');
        expect(fakeSendMessage).not.toHaveBeenCalled();
    });

    it('managed_dedicated with complianceStatus=approved → sends (gate passes)', async () => {
        await setSmsMode('managed_dedicated');
        await seedCompliance('approved');
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});
        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com', smsRuntime);
        expect((await statusOf(logId))?.status).toBe('sent');
        expect(fakeSendMessage).toHaveBeenCalledTimes(1);
    });

    it('managed_dedicated approved + client without consent → skipped (consent gate still applies)', async () => {
        await setSmsMode('managed_dedicated');
        await seedCompliance('approved');
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        // No consent granted — consent gate must block.
        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com', smsRuntime);
        const r = await statusOf(logId);
        expect(r?.status).toBe('skipped');
        expect(r?.error).toMatch(/consent/);
        expect(fakeSendMessage).not.toHaveBeenCalled();
    });

    it('managed_shared with TWILIO_SHARED_MESSAGING_SERVICE_SID set → sends', async () => {
        await setSmsMode('managed_shared');
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});
        // Pass the shared-SID env to deliverSms via flush's env arg.
        const envWithSid = { TWILIO_SHARED_MESSAGING_SERVICE_SID: 'MG_shared_sid' };
        // flush() → deliverSms() currently receives env as an additional arg.
        // The cron would pass env; in tests we call flush with a patched svc.
        // Directly call deliverSms through the service with env.
        const db2 = svc['getDrizzle']() as import('drizzle-orm/better-sqlite3').BetterSQLite3Database<typeof schema>;
        // Re-use the logs already created. Instead of going through flush, call deliverSms directly.
        const logs = await db2.select().from(schema.automationLogs).all();
        const automationRow = await db2.select().from(schema.automations).get();
        const inspRow = await db2.select().from(schema.inspections).get();
        const tenantRow = await db2.select().from(schema.tenants).get();
        if (!logs[0] || !automationRow || !inspRow || !tenantRow) throw new Error('Seed missing');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (svc as any).deliverSms(
            db2, { log: logs[0], automation: automationRow, inspection: inspRow, tenant: tenantRow },
            smsRuntime, 'Acme', 'acme.example.com', envWithSid,
        );
        expect((await statusOf(logId))?.status).toBe('sent');
        expect(fakeSendMessage).toHaveBeenCalledTimes(1);
    });

    it('managed_shared with TWILIO_SHARED_MESSAGING_SERVICE_SID absent → skipped (managed_not_approved)', async () => {
        await setSmsMode('managed_shared');
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});
        // No shared SID env → gate blocks.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db2 = svc['getDrizzle']() as import('drizzle-orm/better-sqlite3').BetterSQLite3Database<typeof schema>;
        const logs = await db2.select().from(schema.automationLogs).all();
        const automationRow = await db2.select().from(schema.automations).get();
        const inspRow = await db2.select().from(schema.inspections).get();
        const tenantRow = await db2.select().from(schema.tenants).get();
        if (!logs[0] || !automationRow || !inspRow || !tenantRow) throw new Error('Seed missing');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (svc as any).deliverSms(
            db2, { log: logs[0], automation: automationRow, inspection: inspRow, tenant: tenantRow },
            smsRuntime, 'Acme', 'acme.example.com', {}, // empty env — no shared SID
        );
        const r = await statusOf(logId);
        expect(r?.status).toBe('skipped');
        expect(r?.error).toBe('managed_not_approved');
        expect(fakeSendMessage).not.toHaveBeenCalled();
    });

    it('own-mode tenant → gate allows, send proceeds normally', async () => {
        await setSmsMode('own');
        smsRuntime.resolveProvider.mockResolvedValue({ provider: fakeProvider, from: '+1999' });
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});
        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com', smsRuntime);
        expect((await statusOf(logId))?.status).toBe('sent');
        expect(fakeSendMessage).toHaveBeenCalledTimes(1);
    });

    it('platform-mode tenant → gate allows, send proceeds normally', async () => {
        // No tenant_configs row (default platform mode).
        smsRuntime.resolveProvider.mockResolvedValue({ provider: fakeProvider, from: '+1999' });
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});
        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com', smsRuntime);
        expect((await statusOf(logId))?.status).toBe('sent');
        expect(fakeSendMessage).toHaveBeenCalledTimes(1);
    });
});

// ─── Free-tier pre-flight + source tagging (Task 5) ──────────────────────────
// A second independent SMS send site: automations flush through deliverSms
// (not server/api/sms.ts), so the same pre-flight + tagging is wired here too
// (scheduled.ts threads its quotaGuard into flush()'s new trailing param).

describe('flush() — SMS free-tier pre-flight + source tagging (Task 5)', () => {
    beforeEach(() => {
        fakeSendMessage.mockClear();
        fakeSendMessage.mockResolvedValue({ ok: true });
        smsRuntime.resolveProvider.mockClear();
        smsRuntime.resolveProvider.mockResolvedValue({ provider: fakeProvider, from: '+1999' });
    });

    it('free tenant (platform mode) at 50 lifetime sms → log failed (quota exceeded), no provider send', async () => {
        const quotaGuard = new PlanQuotaGuard({} as D1Database, { enforced: true, billingPortalUrl: null });
        await new MeteringService({} as D1Database).record(TENANT, 'sms', '2026-06', 50);
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});

        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com', smsRuntime, 50, undefined, quotaGuard);

        const r = await statusOf(logId);
        expect(r?.status).toBe('failed');
        expect(r?.error).toMatch(/Free plan limit reached/);
        expect(fakeSendMessage).not.toHaveBeenCalled();
    });

    it("'own' mode tenant at 50 seeded platform sms → send proceeds and records 'sms_byo'", async () => {
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, smsMode: 'own', updatedAt: new Date(),
        } as never);
        const quotaGuard = new PlanQuotaGuard({} as D1Database, { enforced: true, billingPortalUrl: null });
        await new MeteringService({} as D1Database).record(TENANT, 'sms', '2026-06', 50);
        const record = vi.fn().mockResolvedValue(undefined);
        svc = new AutomationService({} as D1Database, undefined, undefined, { record } as never);
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});

        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com', smsRuntime, 50, undefined, quotaGuard);

        expect((await statusOf(logId))?.status).toBe('sent');
        expect(fakeSendMessage).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledWith(TENANT, 'sms_byo', expect.stringMatching(/^\d{4}-\d{2}$/));
    });

    it('platform-mode send under the cap → records plain \'sms\'', async () => {
        const quotaGuard = new PlanQuotaGuard({} as D1Database, { enforced: true, billingPortalUrl: null });
        const record = vi.fn().mockResolvedValue(undefined);
        svc = new AutomationService({} as D1Database, undefined, undefined, { record } as never);
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});

        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com', smsRuntime, 50, undefined, quotaGuard);

        expect((await statusOf(logId))?.status).toBe('sent');
        expect(record).toHaveBeenCalledWith(TENANT, 'sms', expect.stringMatching(/^\d{4}-\d{2}$/));
    });

    it('no quotaGuard supplied (standalone) → cap never enforced even at 50', async () => {
        await new MeteringService({} as D1Database).record(TENANT, 'sms', '2026-06', 50);
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});

        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com', smsRuntime);

        expect((await statusOf(logId))?.status).toBe('sent');
        expect(fakeSendMessage).toHaveBeenCalledTimes(1);
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
        // SP2 — give the seeded rule a referenced email template (content == the embedded
        // subject/body), so the decoupled delivery renders byte-identical output.
        const { backfillAutomationTemplates } = await import('../../server/services/message-template-backfill');
        await backfillAutomationTemplates({} as D1Database, TENANT);

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
        // Use today's date so the derived due-time = today@09:00Z − 1440min = yesterday@09:00Z,
        // which is always in the past regardless of the time-of-day the test runs.
        // Using tomorrow caused flakiness before 09:00 UTC: tomorrow@09:00Z − 1440min =
        // today@09:00Z, which is in the future until 09:00 UTC passes.
        const today = new Date().toISOString().slice(0, 10);
        const logId = await seedReminder(today);
        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com');
        // today@09:00Z − 1440min(=1 day) = yesterday@09:00Z ≤ now → always due → sent.
        // Email now routes through stubEmailFor (not raw fetch), so we verify status only.
        expect((await statusOf(logId))?.status).toBe('sent');
    });

    it('leaves a reminder pending when its DERIVED due is in the future (date two weeks out)', async () => {
        const twoWeeks = new Date(Date.now() + 14 * 24 * 3600_000).toISOString().slice(0, 10);
        const logId = await seedReminder(twoWeeks);
        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com');
        expect((await statusOf(logId))?.status).toBe('pending');
    });
});

// ─── managedSendAllowed SMS quota gate (Task 10) ─────────────────────────────

import { managedSendAllowed, DEFAULT_MANAGED_SMS_ALLOWANCE } from '../../server/lib/sms/managed-send-gate';
import { MeteringService } from '../../server/services/metering.service';
import { currentPeriodKey } from '../../server/lib/usage/period';

describe('managedSendAllowed — SMS quota gate (Task 10)', () => {
    // For quota tests we use the better-sqlite3 db via the mock (same as the metering
    // tests above). The gate now always runs the quota check via the drizzle db arg.

    beforeEach(() => {
        fakeSendMessage.mockClear();
        smsRuntime.resolveProvider.mockClear();
        smsRuntime.resolveProvider.mockResolvedValue({ provider: fakeProvider, from: '+1999' });
        fakeSendMessage.mockResolvedValue({ ok: true });
    });

    it('managed_dedicated approved, count=0 → allowed (under allowance)', async () => {
        // Seed compliance=approved; no usage_counters row → count defaults to 0.
        const now = new Date();
        await db.insert(schema.messagingCompliance).values({
            tenantId: TENANT, mode: 'managed_dedicated',
            complianceStatus: 'approved', createdAt: now, updatedAt: now,
        } as never);
        const result = await managedSendAllowed(db, { MANAGED_SMS_MONTHLY_ALLOWANCE: '2' }, TENANT, 'managed_dedicated');
        expect(result.allowed).toBe(true);
    });

    it('managed_dedicated approved, count at allowance → quota_exceeded', async () => {
        // Seed compliance=approved + a usage_counters row AT the cap (allowance=2, count=2).
        const now = new Date();
        await db.insert(schema.messagingCompliance).values({
            tenantId: TENANT, mode: 'managed_dedicated',
            complianceStatus: 'approved', createdAt: now, updatedAt: now,
        } as never);
        const period = currentPeriodKey(new Date());
        await db.insert(schema.usageCounters).values({
            tenantId: TENANT, metric: 'sms', periodKey: period, value: 2, updatedAt: now,
        } as never);
        const result = await managedSendAllowed(db, { MANAGED_SMS_MONTHLY_ALLOWANCE: '2' }, TENANT, 'managed_dedicated');
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('managed_quota_exceeded');
    });

    it('managed_dedicated approved, count over allowance → quota_exceeded (end-to-end through deliverSms)', async () => {
        // Full end-to-end: flush() → deliverSms() → managed gate → quota blocks → skipped.
        const now = new Date();
        await db.insert(schema.messagingCompliance).values({
            tenantId: TENANT, mode: 'managed_dedicated',
            complianceStatus: 'approved', createdAt: now, updatedAt: now,
        } as never);
        // Set smsMode=managed_dedicated for TENANT.
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, smsMode: 'managed_dedicated', updatedAt: now,
        } as never);
        // Seed count OVER the allowance: allowance=2, value=3.
        const period = currentPeriodKey(new Date());
        await db.insert(schema.usageCounters).values({
            tenantId: TENANT, metric: 'sms', periodKey: period, value: 3, updatedAt: now,
        } as never);
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});
        smsRuntime.resolveProvider.mockResolvedValueOnce({ provider: fakeProvider, from: null, messagingServiceSid: 'MG_dedic' });

        const db2 = svc['getDrizzle']() as typeof db;
        const logs = await db2.select().from(schema.automationLogs).all();
        const automationRow = await db2.select().from(schema.automations).get();
        const inspRow = await db2.select().from(schema.inspections).get();
        const tenantRow = await db2.select().from(schema.tenants).get();
        if (!logs[0] || !automationRow || !inspRow || !tenantRow) throw new Error('Seed missing');
        // Pass MANAGED_SMS_MONTHLY_ALLOWANCE=2 in the env so the gate uses cap=2.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (svc as any).deliverSms(
            db2, { log: logs[0], automation: automationRow, inspection: inspRow, tenant: tenantRow },
            smsRuntime, 'Acme', 'acme.example.com',
            { MANAGED_SMS_MONTHLY_ALLOWANCE: '2' },
        );
        const r = await statusOf(logId);
        expect(r?.status).toBe('skipped');
        expect(r?.error).toBe('managed_quota_exceeded');
        expect(fakeSendMessage).not.toHaveBeenCalled();
    });

    it('managed_dedicated approved, count under allowance → sends (deliverSms end-to-end)', async () => {
        // Full end-to-end: count=1 under allowance=2 → gate passes → sent.
        const now = new Date();
        await db.insert(schema.messagingCompliance).values({
            tenantId: TENANT, mode: 'managed_dedicated',
            complianceStatus: 'approved', createdAt: now, updatedAt: now,
        } as never);
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, smsMode: 'managed_dedicated', updatedAt: now,
        } as never);
        const period = currentPeriodKey(new Date());
        await db.insert(schema.usageCounters).values({
            tenantId: TENANT, metric: 'sms', periodKey: period, value: 1, updatedAt: now,
        } as never);
        const { logId } = await seedSmsLog({ contactId: 'c1' });
        await new SmsConsentService({} as D1Database).record(TENANT, 'c1', 'granted', 'admin', {});
        smsRuntime.resolveProvider.mockResolvedValueOnce({ provider: fakeProvider, from: null, messagingServiceSid: 'MG_dedic' });

        const db2 = svc['getDrizzle']() as typeof db;
        const logs = await db2.select().from(schema.automationLogs).all();
        const automationRow = await db2.select().from(schema.automations).get();
        const inspRow = await db2.select().from(schema.inspections).get();
        const tenantRow = await db2.select().from(schema.tenants).get();
        if (!logs[0] || !automationRow || !inspRow || !tenantRow) throw new Error('Seed missing');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (svc as any).deliverSms(
            db2, { log: logs[0], automation: automationRow, inspection: inspRow, tenant: tenantRow },
            smsRuntime, 'Acme', 'acme.example.com',
            { MANAGED_SMS_MONTHLY_ALLOWANCE: '2' },
        );
        expect((await statusOf(logId))?.status).toBe('sent');
        expect(fakeSendMessage).toHaveBeenCalledTimes(1);
    });

    it('own mode + count over any allowance → always allowed (quota not checked)', async () => {
        // Seed an enormous counter; own mode never checks quota.
        const period = currentPeriodKey(new Date());
        await db.insert(schema.usageCounters).values({
            tenantId: TENANT, metric: 'sms', periodKey: period, value: 99999, updatedAt: new Date(),
        } as never);
        const result = await managedSendAllowed(db, { MANAGED_SMS_MONTHLY_ALLOWANCE: '2' }, TENANT, 'own');
        expect(result.allowed).toBe(true);
    });

    it('platform mode + count over any allowance → always allowed (quota not checked)', async () => {
        const period = currentPeriodKey(new Date());
        await db.insert(schema.usageCounters).values({
            tenantId: TENANT, metric: 'sms', periodKey: period, value: 99999, updatedAt: new Date(),
        } as never);
        const result = await managedSendAllowed(db, { MANAGED_SMS_MONTHLY_ALLOWANCE: '2' }, TENANT, 'platform');
        expect(result.allowed).toBe(true);
    });

    it('own mode → always allowed regardless of count', async () => {
        const result = await managedSendAllowed(db, {}, TENANT, 'own');
        expect(result.allowed).toBe(true);
    });

    it('platform mode → always allowed', async () => {
        const result = await managedSendAllowed(db, {}, TENANT, 'platform');
        expect(result.allowed).toBe(true);
    });

    it('DEFAULT_MANAGED_SMS_ALLOWANCE is 1000', () => {
        expect(DEFAULT_MANAGED_SMS_ALLOWANCE).toBe(1000);
    });
});

describe('MeteringService.getCount — quota reads for managed send (Task 10)', () => {
    it('getCount returns 0 for unknown tenant/period (baseline for quota check)', async () => {
        // drizzle mock points at the test db (same pattern as other metering tests in sms-api)
        const svc = new MeteringService({} as D1Database);
        const count = await svc.getCount(TENANT, 'sms', currentPeriodKey(new Date()));
        expect(count).toBe(0);
    });

    it('getCount returns the accumulated send count after sends are recorded', async () => {
        const svc = new MeteringService({} as D1Database);
        const period = currentPeriodKey(new Date());
        await svc.record(TENANT, 'sms', period, 1);
        await svc.record(TENANT, 'sms', period, 1);
        const count = await svc.getCount(TENANT, 'sms', period);
        expect(count).toBe(2);
    });

    it('getCount does not cross-contaminate periods', async () => {
        const svc = new MeteringService({} as D1Database);
        await svc.record(TENANT, 'sms', '2026-05', 999);
        const count = await svc.getCount(TENANT, 'sms', '2026-06');
        expect(count).toBe(0);
    });
});
