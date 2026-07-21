import { logger } from '../../logger';
import type { EmailProvider, EmailSendArgs, EmailWebhookContext, NormalizedEmailEvent } from '../provider';
import { base64ToBytes, normalizeEmail, withinReplayWindow } from '../webhook-crypto';

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
    if (args.attachments && args.attachments.length > 0) {
      payload.attachments = args.attachments.map((a) => ({
        content: a.content,
        filename: a.filename,
        ...(a.content_type ? { type: a.content_type } : {}),
        disposition: 'attachment',
      }));
    }

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

  /**
   * Verify a SendGrid Event Webhook signature (ECDSA P-256 / SHA-256).
   *
   * SendGrid signs `${timestamp}${rawBody}` and presents the base64 signature in
   * `x-twilio-email-event-webhook-signature` plus the unix-seconds timestamp in
   * `x-twilio-email-event-webhook-timestamp`. `ctx.secret` is the base64
   * DER/SPKI P-256 public verification key. Fails closed.
   */
  async verifyWebhookSignature(ctx: EmailWebhookContext): Promise<boolean> {
    try {
      if (!ctx.secret) return false;
      const signatureB64 = ctx.headers['x-twilio-email-event-webhook-signature'];
      const timestamp = ctx.headers['x-twilio-email-event-webhook-timestamp'];
      if (!signatureB64 || !timestamp) return false;

      const now = ctx.nowMs ?? Date.now();
      if (!withinReplayWindow(Number(timestamp), now)) return false;

      const spki = base64ToBytes(ctx.secret);
      const sig = base64ToBytes(signatureB64);
      const key = await crypto.subtle.importKey(
        'spki',
        spki,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      );
      const data = new TextEncoder().encode(`${timestamp}${ctx.rawBody}`);
      return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, data);
    } catch {
      return false;
    }
  }

  /**
   * Parse a SendGrid webhook body (a JSON ARRAY of events) into normalized
   * events. Maps `bounce`→hard bounce, `dropped`/`blocked`/`deferred`→soft
   * bounce, `spamreport`→complaint, `delivered`→delivered; skips everything
   * else. Guards every access; returns `[]` on malformed input.
   */
  parseWebhookEvents(rawBody: string): NormalizedEmailEvent[] {
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!Array.isArray(parsed)) return [];
      const out: NormalizedEmailEvent[] = [];
      for (const raw of parsed) {
        const ev = raw as {
          event?: string;
          email?: unknown;
          sg_event_id?: string;
          timestamp?: number;
        };
        const email = normalizeEmail(ev.email);
        if (!email) continue;
        const providerEventId = ev.sg_event_id ?? '';
        const at = typeof ev.timestamp === 'number' ? ev.timestamp * 1000 : 0;

        switch (ev.event) {
          case 'bounce':
            out.push({ type: 'bounced', email, hardBounce: true, providerEventId, at });
            break;
          case 'dropped':
          case 'blocked':
          case 'deferred':
            out.push({ type: 'bounced', email, hardBounce: false, providerEventId, at });
            break;
          case 'spamreport':
            out.push({ type: 'complained', email, providerEventId, at });
            break;
          case 'delivered':
            out.push({ type: 'delivered', email, providerEventId, at });
            break;
          default:
            break;
        }
      }
      return out;
    } catch {
      return [];
    }
  }
}
