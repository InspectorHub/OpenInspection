// apps/openinspection/tests/unit/automation-characterization.spec.ts
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

const TENANT = '00000000-0000-0000-0000-000000000001';
let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;

// Record what the email path delivered: [subject, html] tuples.
const sent: Array<{ subject: string; html: string }> = [];
const stubEmailFor = async (_tid: string) => ({
  sendEmail: async (_to: string[], subject: string, html: string) => {
    sent.push({ subject, html });
    return { delivered: true };
  },
} as unknown as EmailService);

const fakeSendMessage = vi.fn().mockResolvedValue({ ok: true });
const fakeProvider = { sendMessage: fakeSendMessage, validateInboundSignature: vi.fn().mockResolvedValue(false) };
const smsRuntime = { resolveProvider: vi.fn().mockResolvedValue({ provider: fakeProvider, from: '+1999' }) };

beforeEach(async () => {
  const fx = createTestDb();
  db = fx.db; await setupSchema(fx.sqlite);
  (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
  sent.length = 0;
  fakeSendMessage.mockClear();
  smsRuntime.resolveProvider.mockResolvedValue({ provider: fakeProvider, from: '+1999' });
  await db.insert(schema.tenants).values({
    id: TENANT, name: 'Acme', slug: 'acme', status: 'active', phone: '+15550001111',
    deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
  } as never);
  svc = new AutomationService({} as D1Database);
});

async function seedInspection(over: Partial<typeof schema.inspections.$inferInsert> = {}) {
  const id = (over.id as string) ?? crypto.randomUUID();
  await db.insert(schema.inspections).values({
    id, tenantId: TENANT, propertyAddress: '1 Main', clientName: 'Jane',
    clientEmail: 'jane@example.com', date: '2026-06-01', status: 'completed',
    reportStatus: 'published', paymentStatus: 'unpaid', price: 50000,
    agreementRequired: false, paymentRequired: false, createdAt: new Date(), ...over,
  } as never);
  return id;
}

async function seedRuleAndLog(opts: {
  conditions?: object | null; channel?: 'email' | 'sms'; subject?: string; body?: string;
  smsBody?: string; trigger?: string; inspectionId: string;
}) {
  const ruleId = crypto.randomUUID();
  await db.insert(schema.automations).values({
    id: ruleId, tenantId: TENANT, name: 'R', trigger: opts.trigger ?? 'report.published',
    recipient: 'client', delayMinutes: 0, subjectTemplate: opts.subject ?? 'Subj',
    bodyTemplate: opts.body ?? 'Body', smsBody: opts.smsBody ?? null,
    channels: JSON.stringify([opts.channel ?? 'email']), channel: opts.channel ?? 'email',
    active: true, isDefault: false, createdAt: new Date(),
    conditions: opts.conditions ? JSON.stringify(opts.conditions) : null,
  } as never);
  // SP2 — give the seeded rule a referenced email template (content == the embedded
  // subject/body), so the decoupled delivery renders byte-identical output.
  const { backfillAutomationTemplates } = await import('../../server/services/message-template-backfill');
  await backfillAutomationTemplates({} as D1Database, TENANT);

  const logId = crypto.randomUUID();
  await db.insert(schema.automationLogs).values({
    id: logId, tenantId: TENANT, automationId: ruleId, inspectionId: opts.inspectionId,
    recipient: opts.channel === 'sms' ? '+15551234567' : 'jane@example.com',
    channel: opts.channel ?? 'email',
    sendAt: new Date(Date.now() - 1000).toISOString(), status: 'pending',
  } as never);
  return logId;
}

const statusOf = async (id: string) =>
  await db.select().from(schema.automationLogs).where(eq(schema.automationLogs.id, id)).get();

describe('CHARACTERIZATION — automation delivery (freeze before SP-ENG refactor)', () => {
  it('email path: conditions pass → sent, interpolates company_name + client_name', async () => {
    const insp = await seedInspection({ paymentStatus: 'paid' });
    const logId = await seedRuleAndLog({
      conditions: { requirePaid: true }, subject: 'Hi {{client_name}}',
      body: 'From {{company_name}}', inspectionId: insp,
    });
    await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com');
    expect((await statusOf(logId))?.status).toBe('sent');
    expect(sent).toEqual([{ subject: 'Hi Jane', html: 'From Acme' }]);
  });

  it('email path: requirePaid fails on unpaid → skipped "condition: not paid"', async () => {
    const insp = await seedInspection({ paymentStatus: 'unpaid' });
    const logId = await seedRuleAndLog({ conditions: { requirePaid: true }, inspectionId: insp });
    await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com');
    const r = await statusOf(logId);
    expect(r?.status).toBe('skipped');
    expect(r?.error).toBe('condition: not paid');
    expect(sent).toEqual([]);
  });

  it('email path: requireSigned skips when no signed agreement', async () => {
    const insp = await seedInspection();
    const logId = await seedRuleAndLog({ conditions: { requireSigned: true }, inspectionId: insp });
    await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com');
    const r = await statusOf(logId);
    expect(r?.status).toBe('skipped');
    expect(r?.error).toBe('condition: agreement not signed');
  });

  it('email path: serviceIds skips when none booked', async () => {
    const insp = await seedInspection();
    const logId = await seedRuleAndLog({ conditions: { serviceIds: ['svc-x'] }, inspectionId: insp });
    await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com');
    const r = await statusOf(logId);
    expect(r?.status).toBe('skipped');
    expect(r?.error).toBe('condition: service not matched');
  });

  it('review_url FAIL-CLOSED: body references {{review_url}}, tenant_configs unset → skipped', async () => {
    const insp = await seedInspection();
    const logId = await seedRuleAndLog({ body: 'Review: {{review_url}}', inspectionId: insp });
    await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com');
    const r = await statusOf(logId);
    expect(r?.status).toBe('skipped');
    expect(r?.error).toBe('review_url not configured');
    expect(sent).toEqual([]);
  });

  it('review_url configured → sent with the configured url', async () => {
    const insp = await seedInspection();
    await db.insert(schema.tenantConfigs).values(
      { tenantId: TENANT, reviewUrl: 'https://g.page/r/acme', updatedAt: new Date() } as never);
    const logId = await seedRuleAndLog({ body: 'Review: {{review_url}}', inspectionId: insp });
    await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com');
    expect((await statusOf(logId))?.status).toBe('sent');
    expect(sent).toEqual([{ subject: 'Subj', html: 'Review: https://g.page/r/acme' }]);
  });

  it('SMS branch: client without consent → skipped "no sms consent"', async () => {
    const insp = await seedInspection({ clientContactId: 'c1', clientPhone: '+15551234567' });
    const logId = await seedRuleAndLog({ channel: 'sms', smsBody: 'Hi {{client_name}}', inspectionId: insp });
    await new SmsConsentService({} as D1Database).publishDisclosure('disclosure');
    await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com', smsRuntime);
    const r = await statusOf(logId);
    expect(r?.status).toBe('skipped');
    expect(r?.error).toMatch(/consent/);
    expect(fakeSendMessage).not.toHaveBeenCalled();
  });

  it('SMS branch: client with granted consent → sent via provider', async () => {
    const insp = await seedInspection({ clientContactId: 'c1', clientPhone: '+15551234567' });
    const consent = new SmsConsentService({} as D1Database);
    await consent.publishDisclosure('disclosure');
    await consent.record(TENANT, 'c1', 'granted', 'admin', {});
    const logId = await seedRuleAndLog({ channel: 'sms', smsBody: 'Hi {{client_name}}', inspectionId: insp });
    await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com', smsRuntime);
    expect((await statusOf(logId))?.status).toBe('sent');
    expect(fakeSendMessage).toHaveBeenCalledTimes(1);
    expect((fakeSendMessage.mock.calls[0][0] as { to: string }).to).toBe('+15551234567');
  });
});
