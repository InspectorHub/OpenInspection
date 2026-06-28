import { logger } from '../../logger';
import type { EmailProvider, EmailSendArgs, EmailWebhookContext, NormalizedEmailEvent } from '../provider';
import {
  base64ToBytes,
  bytesToBase64,
  constantTimeEquals,
  hmacSha256,
  normalizeEmail,
  withinReplayWindow,
} from '../webhook-crypto';

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

  /**
   * Verify a Resend (Svix) webhook signature.
   *
   * Svix signs `${svix-id}.${svix-timestamp}.${rawBody}` with HMAC-SHA256 using
   * the bytes of the `whsec_<base64>` signing secret (after the `whsec_` prefix),
   * and presents the base64 signature in `svix-signature` as a space-separated
   * list of `v1,<base64sig>` entries. Any one match → true. Fails closed.
   */
  async verifyWebhookSignature(ctx: EmailWebhookContext): Promise<boolean> {
    try {
      if (!ctx.secret) return false;
      const svixId = ctx.headers['svix-id'];
      const svixTimestamp = ctx.headers['svix-timestamp'];
      const svixSignature = ctx.headers['svix-signature'];
      if (!svixId || !svixTimestamp || !svixSignature) return false;

      const now = ctx.nowMs ?? Date.now();
      if (!withinReplayWindow(Number(svixTimestamp), now)) return false;

      const secretBody = ctx.secret.startsWith('whsec_') ? ctx.secret.slice('whsec_'.length) : ctx.secret;
      const keyBytes = base64ToBytes(secretBody);
      const expected = bytesToBase64(await hmacSha256(keyBytes, `${svixId}.${svixTimestamp}.${ctx.rawBody}`));

      // The header is a space-separated list of `<version>,<base64sig>` entries;
      // compare against each `v1,` signature in constant time (any match → true).
      let matched = false;
      for (const entry of svixSignature.split(' ')) {
        const comma = entry.indexOf(',');
        if (comma < 0) continue;
        const version = entry.slice(0, comma);
        if (version !== 'v1') continue;
        const sig = entry.slice(comma + 1);
        if (constantTimeEquals(sig, expected)) matched = true;
      }
      return matched;
    } catch {
      return false;
    }
  }

  /**
   * Parse a Resend webhook body (`{ type, data, created_at }`) into a single
   * normalized event. Guards every access; returns `[]` on malformed input or an
   * absent recipient email.
   */
  parseWebhookEvents(rawBody: string): NormalizedEmailEvent[] {
    try {
      const body = JSON.parse(rawBody) as {
        type?: string;
        created_at?: string;
        data?: { email_id?: string; to?: unknown; bounce?: { type?: string } };
      };
      const type = body.type;
      const data = body.data ?? {};
      const email = normalizeEmail(data.to);
      if (!email) return [];

      const providerEventId = `${data.email_id ?? ''}:${type ?? ''}`;
      const at = body.created_at ? Date.parse(body.created_at) || 0 : 0;

      if (type === 'email.bounced') {
        const hardBounce = /permanent|hard/i.test(data.bounce?.type ?? '');
        return [{ type: 'bounced', email, hardBounce, providerEventId, at }];
      }
      if (type === 'email.complained') {
        return [{ type: 'complained', email, providerEventId, at }];
      }
      if (type === 'email.delivered') {
        return [{ type: 'delivered', email, providerEventId, at }];
      }
      return [];
    } catch {
      return [];
    }
  }
}
