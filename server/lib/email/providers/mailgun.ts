import { logger } from '../../logger';
import type { EmailProvider, EmailSendArgs } from '../provider';

/**
 * MailgunProvider — thin fetch-based adapter over the Mailgun v3 REST API.
 * Satisfies EmailProvider for send + credential validation.
 * No Mailgun SDK dependency — plain fetch only.
 *
 * Constructor creds: { apiKey, domain } where apiKey is the Mailgun API key
 * and domain is the sending domain (e.g. "mg.example.com").
 */
export class MailgunProvider implements EmailProvider {
  constructor(private creds: { apiKey: string; domain: string }) {}

  private get authHeader(): string {
    return `Basic ${btoa(`api:${this.creds.apiKey}`)}`;
  }

  async sendEmail(
    args: EmailSendArgs,
  ): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
    const params = new URLSearchParams();
    params.append('from', args.from);
    // Normalize to: string | string[] → one `to` field per address (URLSearchParams allows repeats).
    if (Array.isArray(args.to)) {
      for (const addr of args.to) {
        params.append('to', addr);
      }
    } else {
      params.append('to', args.to);
    }
    params.append('subject', args.subject);
    params.append('html', args.html);
    if (args.replyTo) params.append('h:Reply-To', args.replyTo);

    let res: Response;
    try {
      res = await fetch(
        `https://api.mailgun.net/v3/${this.creds.domain}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': this.authHeader,
          },
          body: params.toString(),
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'network error';
      logger.error('[email] MailgunProvider fetch error', { message });
      return { ok: false, error: message };
    }

    if (res.ok) {
      let json: { id?: string } | null = null;
      try { json = (await res.json()) as { id?: string }; } catch { /* empty body */ }
      return { ok: true, ...(json?.id ? { id: json.id } : {}) };
    }

    // Non-2xx: extract Mailgun error message best-effort.
    let errMsg: string;
    try {
      const body = (await res.json()) as { message?: string } | null;
      errMsg = body?.message ?? `Mailgun ${res.status}`;
    } catch {
      errMsg = `Mailgun ${res.status}`;
    }
    logger.error('[email] MailgunProvider delivery failed', { status: res.status, error: errMsg });
    return { ok: false, error: errMsg };
  }

  async validateCredentials(): Promise<{ ok: true } | { ok: false; error: string }> {
    let res: Response;
    try {
      res = await fetch(`https://api.mailgun.net/v3/${this.creds.domain}`, {
        headers: { 'Authorization': this.authHeader },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'network error';
      return { ok: false, error: message };
    }
    if (res.ok) return { ok: true };
    return { ok: false, error: `Mailgun ${res.status}` };
  }
}
