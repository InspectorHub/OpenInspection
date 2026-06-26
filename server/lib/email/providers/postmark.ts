import { logger } from '../../logger';
import type { EmailProvider, EmailSendArgs } from '../provider';

/**
 * PostmarkProvider — thin fetch-based adapter over the Postmark REST API.
 * Satisfies EmailProvider for send + credential validation.
 * No Postmark SDK dependency — plain fetch only.
 *
 * Constructor creds: { apiKey } — carries the POSTMARK_SERVER_TOKEN value.
 */
export class PostmarkProvider implements EmailProvider {
  constructor(private creds: { apiKey: string }) {}

  async sendEmail(
    args: EmailSendArgs,
  ): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
    // Normalize to: string | string[] → comma-separated string required by Postmark.
    const to = Array.isArray(args.to) ? args.to.join(',') : args.to;

    const payload: Record<string, unknown> = {
      From: args.from,
      To: to,
      Subject: args.subject,
      HtmlBody: args.html,
    };
    if (args.replyTo) payload.ReplyTo = args.replyTo;

    let res: Response;
    try {
      res = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Postmark-Server-Token': this.creds.apiKey,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'network error';
      logger.error('[email] PostmarkProvider fetch error', { message });
      return { ok: false, error: message };
    }

    if (res.ok) {
      let json: { MessageID?: string } | null = null;
      try { json = (await res.json()) as { MessageID?: string }; } catch { /* empty body */ }
      return { ok: true, ...(json?.MessageID ? { id: json.MessageID } : {}) };
    }

    // Non-2xx: extract Postmark error message best-effort.
    let errMsg: string;
    try {
      const body = (await res.json()) as { Message?: string } | null;
      errMsg = body?.Message ?? `Postmark ${res.status}`;
    } catch {
      errMsg = `Postmark ${res.status}`;
    }
    logger.error('[email] PostmarkProvider delivery failed', { status: res.status, error: errMsg });
    return { ok: false, error: errMsg };
  }

  async validateCredentials(): Promise<{ ok: true } | { ok: false; error: string }> {
    let res: Response;
    try {
      res = await fetch('https://api.postmarkapp.com/server', {
        headers: {
          'Accept': 'application/json',
          'X-Postmark-Server-Token': this.creds.apiKey,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'network error';
      return { ok: false, error: message };
    }
    if (res.ok) return { ok: true };
    return { ok: false, error: `Postmark ${res.status}` };
  }
}
