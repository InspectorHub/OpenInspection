import { logger } from '../../logger';
import type { EmailProvider, EmailSendArgs } from '../provider';

/**
 * SendgridProvider — thin fetch-based adapter over the SendGrid v3 REST API.
 * Satisfies EmailProvider for send + credential validation.
 * No SendGrid SDK dependency — plain fetch only.
 */
export class SendgridProvider implements EmailProvider {
  constructor(private creds: { apiKey: string }) {}

  async sendEmail(
    args: EmailSendArgs,
  ): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
    // Normalize to: string | string[] → array of { email } objects required by SendGrid.
    const toAddresses = (Array.isArray(args.to) ? args.to : [args.to]).map(
      (email) => ({ email }),
    );

    const payload: Record<string, unknown> = {
      personalizations: [{ to: toAddresses }],
      from: { email: args.from },
      subject: args.subject,
      content: [{ type: 'text/html', value: args.html }],
    };
    if (args.replyTo) payload.reply_to = { email: args.replyTo };

    let res: Response;
    try {
      res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.creds.apiKey}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'network error';
      logger.error('[email] SendgridProvider fetch error', { message });
      return { ok: false, error: message };
    }

    // SendGrid returns 202 with an empty body on success — no id.
    if (res.ok) {
      return { ok: true };
    }

    // Non-2xx: extract SendGrid error message best-effort.
    let errMsg: string;
    try {
      const body = (await res.json()) as { errors?: Array<{ message?: string }> } | null;
      errMsg = body?.errors?.[0]?.message ?? `SendGrid ${res.status}`;
    } catch {
      errMsg = `SendGrid ${res.status}`;
    }
    logger.error('[email] SendgridProvider delivery failed', { status: res.status, error: errMsg });
    return { ok: false, error: errMsg };
  }

  async validateCredentials(): Promise<{ ok: true } | { ok: false; error: string }> {
    let res: Response;
    try {
      res = await fetch('https://api.sendgrid.com/v3/scopes', {
        headers: { 'Authorization': `Bearer ${this.creds.apiKey}` },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'network error';
      return { ok: false, error: message };
    }
    if (res.ok) return { ok: true };
    return { ok: false, error: `SendGrid ${res.status}` };
  }
}
