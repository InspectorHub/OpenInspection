import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailService } from '../../../server/services/email.service';
import { logger } from '../../../server/lib/logger';
import type { EmailProvider } from '../../../server/lib/email/provider';

/**
 * WH-3 — send-path suppression gate. The gate is injected the same way `meter`
 * is (an optional constructor port), normalizes each recipient the SAME way the
 * webhook receiver stores them (`.trim().toLowerCase()`), drops suppressed
 * recipients before the provider call, and — when ALL recipients are suppressed —
 * skips the provider entirely and returns the benign `{ delivered: false }` shape
 * (the same value the missing-API-key skip already returns; non-breaking).
 */

/** A provider stub that records every send and never actually transports. */
function stubProvider(): EmailProvider & { calls: Array<{ to: string | string[] }> } {
  const calls: Array<{ to: string | string[] }> = [];
  return {
    calls,
    async sendEmail(args) {
      calls.push({ to: args.to });
      return { ok: true, id: 'msg_1' };
    },
    async verifyWebhookSignature() { return false; },
    parseWebhookEvents() { return []; },
  };
}

/** Build an EmailService with the injected provider + suppression stub. */
function buildService(
  suppression: { isSuppressed(email: string): Promise<boolean> } | undefined,
  provider = stubProvider(),
) {
  // ctor: (apiKey, senderEmail, appName, identity?, renderer?, meter?, provider?, suppression?)
  const svc = new EmailService(
    're_realkey', 'no-reply@x.io', 'App',
    undefined, undefined, undefined, provider, suppression,
  );
  return { svc, provider };
}

describe('EmailService send-path suppression gate (WH-3)', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 }))));
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('suppressed sole recipient → provider NOT called, benign skip, logged', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const suppression = { isSuppressed: vi.fn(async () => true) };
    const { svc, provider } = buildService(suppression);

    const result = await svc.sendEmail(['blocked@x.io'], 'Subj', '<p>hi</p>');

    expect(provider.calls).toHaveLength(0);
    expect(result).toEqual({ delivered: false }); // benign, non-throwing skip
    expect(warn).toHaveBeenCalledTimes(1);
    // No email/PII in the log payload.
    const [msg, data] = warn.mock.calls[0];
    expect(String(msg)).not.toContain('blocked@x.io');
    expect(JSON.stringify(data ?? {})).not.toContain('blocked@x.io');
    expect((data as { suppressedCount?: number }).suppressedCount).toBe(1);
  });

  it('clean recipient → provider called normally (unchanged)', async () => {
    const suppression = { isSuppressed: vi.fn(async () => false) };
    const { svc, provider } = buildService(suppression);

    const result = await svc.sendEmail(['ok@x.io'], 'Subj', '<p>hi</p>');

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].to).toEqual(['ok@x.io']);
    expect(result).toEqual({ delivered: true });
  });

  it('normalizes the recipient before lookup (trim + lowercase)', async () => {
    const isSuppressed = vi.fn(async () => false);
    const { svc } = buildService({ isSuppressed });

    await svc.sendEmail(['  Mixed.Case@X.IO  '], 'Subj', '<p>hi</p>');

    expect(isSuppressed).toHaveBeenCalledWith('mixed.case@x.io');
  });

  it('multi-recipient with one suppressed → provider gets only the clean ones', async () => {
    const suppression = {
      isSuppressed: vi.fn(async (email: string) => email === 'blocked@x.io'),
    };
    const { svc, provider } = buildService(suppression);

    const result = await svc.sendEmail(['blocked@x.io', 'ok@x.io'], 'Subj', '<p>hi</p>');

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].to).toEqual(['ok@x.io']);
    expect(result).toEqual({ delivered: true });
  });

  it('no suppression injected → provider called unchanged (back-compat)', async () => {
    const { svc, provider } = buildService(undefined);

    const result = await svc.sendEmail(['anyone@x.io'], 'Subj', '<p>hi</p>');

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].to).toEqual(['anyone@x.io']);
    expect(result).toEqual({ delivered: true });
  });

  it('fail-OPEN: a lookup error never blocks the send', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const suppression = { isSuppressed: vi.fn(async () => { throw new Error('db down'); }) };
    const { svc, provider } = buildService(suppression);

    const result = await svc.sendEmail(['ok@x.io'], 'Subj', '<p>hi</p>');

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].to).toEqual(['ok@x.io']);
    expect(result).toEqual({ delivered: true });
    // The error path must not log the email address.
    for (const call of warn.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('ok@x.io');
    }
  });
});
