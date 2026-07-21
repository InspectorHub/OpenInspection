import { logger } from '../../logger';
import type { EmailProvider, EmailSendArgs, EmailWebhookContext, NormalizedEmailEvent } from '../provider';
import {
  base64ToBytes,
  bytesToHex,
  constantTimeEquals,
  hmacSha256,
  normalizeEmail,
  withinReplayWindow,
} from '../webhook-crypto';

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
    const hasAttachments = !!(args.attachments && args.attachments.length > 0);
    // Binary attachments can't ride urlencoded — switch to multipart only when present,
    // keeping the urlencoded path (and its assertions) intact for the common no-attachment case.
    const headers: Record<string, string> = { 'Authorization': this.authHeader };
    let body: FormData | string;

    if (hasAttachments) {
      const form = new FormData();
      form.append('from', args.from);
      for (const addr of Array.isArray(args.to) ? args.to : [args.to]) form.append('to', addr);
      form.append('subject', args.subject);
      form.append('html', args.html);
      if (args.replyTo) form.append('h:Reply-To', args.replyTo);
      for (const a of args.attachments!) {
        const bytes = base64ToBytes(a.content);
        form.append(
          'attachment',
          new Blob([bytes], { type: a.content_type ?? 'application/octet-stream' }),
          a.filename,
        );
      }
      // fetch sets the multipart Content-Type + boundary automatically — do not set it by hand.
      body = form;
    } else {
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
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = params.toString();
    }

    let res: Response;
    try {
      res = await fetch(
        `https://api.mailgun.net/v3/${this.creds.domain}/messages`,
        {
          method: 'POST',
          headers,
          body,
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

  /**
   * Verify a Mailgun webhook signature (HMAC-SHA256 hex).
   *
   * The POSTed JSON body carries `signature: { timestamp, token, signature }`.
   * We compute HMAC-SHA256(`ctx.secret`, `${timestamp}${token}`) as lowercase hex
   * and constant-time compare it to the body's `signature.signature`. Fails closed
   * on a missing signature object, an empty secret, or a stale timestamp (±300s).
   */
  async verifyWebhookSignature(ctx: EmailWebhookContext): Promise<boolean> {
    try {
      if (!ctx.secret) return false;
      const body = JSON.parse(ctx.rawBody) as {
        signature?: { timestamp?: string | number; token?: string; signature?: string };
      };
      const sigObj = body.signature;
      if (!sigObj || typeof sigObj.signature !== 'string' || typeof sigObj.token !== 'string') {
        return false;
      }
      const tsRaw = sigObj.timestamp;
      const tsSeconds = typeof tsRaw === 'number' ? tsRaw : Number(tsRaw);
      const now = ctx.nowMs ?? Date.now();
      if (!withinReplayWindow(tsSeconds, now)) return false;

      const keyBytes = new TextEncoder().encode(ctx.secret);
      const expected = bytesToHex(await hmacSha256(keyBytes, `${sigObj.timestamp}${sigObj.token}`));
      return constantTimeEquals(sigObj.signature, expected);
    } catch {
      return false;
    }
  }

  /**
   * Parse a Mailgun webhook body (`{ signature, 'event-data': {...} }`) into a
   * normalized event. `event-data.event` `failed`→bounced (hard when
   * `severity === 'permanent'`), `complained`→complaint, `delivered`→delivered.
   * Guards every access; returns `[]` on malformed input or absent recipient.
   */
  parseWebhookEvents(rawBody: string): NormalizedEmailEvent[] {
    try {
      const body = JSON.parse(rawBody) as {
        'event-data'?: {
          event?: string;
          severity?: string;
          recipient?: unknown;
          id?: string;
          timestamp?: number;
        };
      };
      const ev = body['event-data'];
      if (!ev) return [];
      const email = normalizeEmail(ev.recipient);
      if (!email) return [];

      const providerEventId = ev.id ?? '';
      const at = typeof ev.timestamp === 'number' ? ev.timestamp * 1000 : 0;

      if (ev.event === 'failed') {
        return [{ type: 'bounced', email, hardBounce: ev.severity === 'permanent', providerEventId, at }];
      }
      if (ev.event === 'complained') {
        return [{ type: 'complained', email, providerEventId, at }];
      }
      if (ev.event === 'delivered') {
        return [{ type: 'delivered', email, providerEventId, at }];
      }
      return [];
    } catch {
      return [];
    }
  }
}
