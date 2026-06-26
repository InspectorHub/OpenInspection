import { logger } from '../../logger';
import type { EmailProvider, EmailSendArgs } from '../provider';

/**
 * ResendProvider — thin fetch-based adapter over the Resend REST API.
 * Satisfies EmailProvider for send + credential validation.
 * No Resend SDK dependency — plain fetch only.
 */
export class ResendProvider implements EmailProvider {
  constructor(private creds: { apiKey: string }) {}

  async sendEmail(
    args: EmailSendArgs,
  ): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
    const payload: Record<string, unknown> = {
      from: args.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
    };
    if (args.replyTo) payload.reply_to = args.replyTo;
    if (args.text) payload.text = args.text;
    if (args.attachments && args.attachments.length > 0) payload.attachments = args.attachments;

    let res: Response;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.creds.apiKey}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'network error';
      logger.error('[email] ResendProvider fetch error', { message });
      return { ok: false, error: message };
    }

    if (res.ok) {
      let json: { id?: string } | null = null;
      try { json = (await res.json()) as { id?: string }; } catch { /* empty body */ }
      return { ok: true, ...(json?.id ? { id: json.id } : {}) };
    }

    // Non-2xx: try to extract the provider's error message.
    let errMsg: string;
    try {
      const body = (await res.json()) as { message?: string; name?: string } | null;
      errMsg = body?.message ?? body?.name ?? `Resend ${res.status}`;
    } catch {
      errMsg = `Resend ${res.status}`;
    }
    logger.error('[email] ResendProvider delivery failed', { status: res.status, error: errMsg });
    return { ok: false, error: errMsg };
  }

  async validateCredentials(): Promise<{ ok: true } | { ok: false; error: string }> {
    let res: Response;
    try {
      res = await fetch('https://api.resend.com/domains', {
        headers: { 'Authorization': `Bearer ${this.creds.apiKey}` },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'network error';
      return { ok: false, error: message };
    }
    if (res.ok) return { ok: true };
    return { ok: false, error: `Resend ${res.status}` };
  }
}
