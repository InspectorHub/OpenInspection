// apps/openinspection/tests/unit/automation-core/deliver.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { deliverAction } from '../../../server/lib/automation-core/deliver';
import type { TemplateStore, Transport, AutomationLogger, Clock, ResolvedTemplate } from '../../../server/lib/automation-core/ports';

const clock: Clock = { nowMs: () => 1_700_000_000_000 };

function makeDeps(tpl: ResolvedTemplate | null) {
  const templates: TemplateStore = { resolve: vi.fn().mockResolvedValue(tpl) };
  const sendEmail = vi.fn().mockResolvedValue({ ok: true, id: 'e1' });
  const sendSms = vi.fn().mockResolvedValue({ ok: true });
  const transport: Transport = { sendEmail, sendSms };
  const record = vi.fn().mockResolvedValue(undefined);
  const logger: AutomationLogger = { record };
  return { deps: { templates, transport, logger, clock }, sendEmail, sendSms, record };
}

describe('deliverAction (core)', () => {
  it('email: resolves, interpolates, sends, records sent', async () => {
    const { deps, sendEmail, record } = makeDeps(
      { channel: 'email', subject: 'Hi {{client_name}}', body: 'From {{company_name}}', variables: [] });
    const out = await deliverAction({
      tenantId: 't1', logId: 'l1', to: 'jane@example.com',
      action: { channel: 'email', templateId: 'tpl1' },
      vars: { client_name: 'Jane', company_name: 'Acme' }, requiredVars: {}, deps,
    });
    expect(out).toEqual({ status: 'sent' });
    expect(sendEmail).toHaveBeenCalledWith({ tenantId: 't1', to: 'jane@example.com', subject: 'Hi Jane', html: 'From Acme' });
    expect(record).toHaveBeenCalledWith({ logId: 'l1', status: 'sent', deliveredAtMs: 1_700_000_000_000 });
  });

  it('requiredVars missing → skipped, no send, records skipped reason', async () => {
    const { deps, sendEmail, record } = makeDeps(
      { channel: 'email', subject: 'S', body: 'Review: {{review_url}}', variables: [] });
    const out = await deliverAction({
      tenantId: 't1', logId: 'l1', to: 'jane@example.com',
      action: { channel: 'email', templateId: 'tpl1' },
      vars: {}, requiredVars: { review_url: undefined }, deps,
    });
    expect(out).toEqual({ status: 'skipped', error: 'review_url not configured' });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith({ logId: 'l1', status: 'skipped', error: 'review_url not configured' });
  });

  it('template not found → failed', async () => {
    const { deps, record } = makeDeps(null);
    const out = await deliverAction({
      tenantId: 't1', logId: 'l1', to: 'x', action: { channel: 'email', templateId: 'missing' },
      vars: {}, requiredVars: {}, deps,
    });
    expect(out.status).toBe('failed');
    expect(record).toHaveBeenCalledWith({ logId: 'l1', status: 'failed', error: 'template not found' });
  });

  it('sms: sends via transport.sendSms, records sent', async () => {
    const { deps, sendSms } = makeDeps(
      { channel: 'sms', body: 'Hi {{client_name}}', variables: [] });
    const out = await deliverAction({
      tenantId: 't1', logId: 'l1', to: '+15551234567',
      action: { channel: 'sms', templateId: 'tpl1' }, vars: { client_name: 'Jane' }, requiredVars: {}, deps,
    });
    expect(out).toEqual({ status: 'sent' });
    expect(sendSms).toHaveBeenCalledWith({ tenantId: 't1', to: '+15551234567', body: 'Hi Jane' });
  });

  it('transport failure → failed with provider error', async () => {
    const { deps } = makeDeps({ channel: 'email', subject: 'S', body: 'B', variables: [] });
    (deps.transport.sendEmail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: 'boom' });
    const out = await deliverAction({
      tenantId: 't1', logId: 'l1', to: 'x', action: { channel: 'email', templateId: 'tpl1' },
      vars: {}, requiredVars: {}, deps,
    });
    expect(out).toEqual({ status: 'failed', error: 'boom' });
  });
});
