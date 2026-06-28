import { logger } from '../../logger';
import type { EmailProvider, EmailSendArgs, EmailWebhookContext, NormalizedEmailEvent } from '../provider';
import { constantTimeEquals, normalizeEmail } from '../webhook-crypto';

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

  /**
   * Verify a Postmark webhook via a configured shared token (no HMAC). Postmark
   * is configured to call the receiver with `?token=<secret>` (or HTTP Basic),
   * so we constant-time compare the presented token against `ctx.secret`. An
   * empty configured secret fails closed. No anti-replay (idempotency carries it).
   */
  verifyWebhookSignature(ctx: EmailWebhookContext): Promise<boolean> {
    try {
      if (!ctx.secret) return Promise.resolve(false);
      // Prefer the query token; otherwise read the Basic-auth password.
      let presented = ctx.query?.token ?? '';
      if (!presented) {
        const auth = ctx.headers['authorization'] ?? '';
        if (auth.startsWith('Basic ')) {
          try {
            const decoded = atob(auth.slice('Basic '.length));
            const colon = decoded.indexOf(':');
            presented = colon >= 0 ? decoded.slice(colon + 1) : '';
          } catch {
            presented = '';
          }
        }
      }
      return Promise.resolve(constantTimeEquals(presented, ctx.secret));
    } catch {
      return Promise.resolve(false);
    }
  }

  /**
   * Parse a Postmark webhook body (a single object) into a normalized event.
   * `RecordType` `Bounce`→bounced, `SpamComplaint`→complaint, `Delivery`→delivered.
   * Guards every access; returns `[]` on malformed input or absent recipient.
   */
  parseWebhookEvents(rawBody: string): NormalizedEmailEvent[] {
    try {
      const body = JSON.parse(rawBody) as {
        RecordType?: string;
        Type?: string;
        Email?: unknown;
        Recipient?: unknown;
        ID?: number | string;
        MessageID?: string;
        BouncedAt?: string;
        DeliveredAt?: string;
        ReceivedAt?: string;
      };
      const email = normalizeEmail(body.Email) ?? normalizeEmail(body.Recipient);
      if (!email) return [];

      const providerEventId =
        body.ID !== undefined && body.ID !== null ? String(body.ID) : (body.MessageID ?? '');
      const stamp = body.BouncedAt ?? body.DeliveredAt ?? body.ReceivedAt;
      const at = stamp ? Date.parse(stamp) || 0 : 0;

      if (body.RecordType === 'Bounce') {
        const hard = new Set(['HardBounce', 'BadEmailAddress', 'SpamComplaint', 'Blocked']);
        const hardBounce = hard.has(body.Type ?? '');
        return [{ type: 'bounced', email, hardBounce, providerEventId, at }];
      }
      if (body.RecordType === 'SpamComplaint') {
        return [{ type: 'complained', email, providerEventId, at }];
      }
      if (body.RecordType === 'Delivery') {
        return [{ type: 'delivered', email, providerEventId, at }];
      }
      return [];
    } catch {
      return [];
    }
  }
}
