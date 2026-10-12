import { logger } from '../../logger';
import type { EmailFailureKind, EmailQuotaWindow, EmailProvider, EmailSendArgs, EmailSendUsage, EmailWebhookContext, NormalizedEmailEvent } from '../provider';
import {
  base64ToBytes,
  bytesToBase64,
  constantTimeEquals,
  hmacSha256,
  normalizeEmail,
  withinReplayWindow,
} from '../webhook-crypto';

/**
 * A real `Response` always has headers; hand-rolled fetch doubles often do not.
 * Reading a header must never turn such a response into a thrown TypeError.
 */
function headerValue(headers: Headers | undefined, name: string): string | null {
    return typeof headers?.get === 'function' ? headers.get(name) : null;
}

/** Strict non-negative integer parse; anything else (absent, garbage, negative, fractional) is undefined. */
function parseCount(raw: string | null): number | undefined {
    if (raw === null || !/^[0-9]+$/.test(raw.trim())) return undefined;
    const n = Number(raw.trim());
    return Number.isSafeInteger(n) ? n : undefined;
}

/**
 * Read Resend's quota headers: `x-resend-daily-quota` (emails used today; only
 * sent for accounts with a daily cap) and `x-resend-monthly-quota` (emails used
 * this month). Returns undefined when neither carries a valid reading.
 */
function readUsage(headers: Headers | undefined): EmailSendUsage | undefined {
    const dailyUsed = parseCount(headerValue(headers, 'x-resend-daily-quota'));
    const monthlyUsed = parseCount(headerValue(headers, 'x-resend-monthly-quota'));
    if (dailyUsed === undefined && monthlyUsed === undefined) return undefined;
    return {
        ...(dailyUsed !== undefined ? { dailyUsed } : {}),
        ...(monthlyUsed !== undefined ? { monthlyUsed } : {}),
    };
}

/** Parse `retry-after` as integer seconds in [0, 86400]; anything else is undefined. */
function readRetryAfterSeconds(headers: Headers | undefined): number | undefined {
    const n = parseCount(headerValue(headers, 'retry-after'));
    return n !== undefined && n <= 86400 ? n : undefined;
}

/** Name field of a Resend JSON error body, or undefined when the body is absent/unparseable. */
async function readErrorName(res: Response): Promise<string | undefined> {
    const body = (await res.json().catch(() => null)) as { name?: unknown } | null;
    return typeof body?.name === 'string' ? body.name : undefined;
}

/**
 * Classify a Resend non-2xx response into one of the `EmailFailureKind`
 * buckets. The mapping is derived from Resend's published error reference
 * (resend.com/docs/api-reference/errors).
 *
 * Classification priority:
 *  1. Suppressed — 403 validation_error whose message mentions "suppressed".
 *     Resend uses the same (name=validation_error, status=403) shape for domain
 *     errors too, so the message must be checked.
 *  2. Sender-domain — any other 403 validation_error (unverified domain, test
 *     key restricted to own address, domain already registered on another team).
 *  3. Quota — 429 daily_quota_exceeded | monthly_quota_exceeded.
 *  4. Rate-limited — 429 rate_limit_exceeded (request rate, not a quota).
 *  5. Transient — everything else: 5xx, lock/conflict, network.
 *
 * Any Resend error not covered by (1)–(4) is treated as transient because
 * retrying is the safest default — the operator can always check the logs.
 */
export function classifyResendError(
    status: number,
    name: string | undefined,
    message: string,
): EmailFailureKind {
    if (status === 403 && name === 'validation_error') {
        // Suppression messages always contain the word "suppressed".
        if (/suppressed/i.test(message)) return 'suppressed';
        // Remaining 403 validation_errors are domain / key scope problems.
        return 'sender_domain';
    }
    if (status === 429) {
        if (name === 'daily_quota_exceeded' || name === 'monthly_quota_exceeded') {
            return 'quota_exceeded';
        }
        // rate_limit_exceeded → back off and retry; any other 429 stays transient
        return name === 'rate_limit_exceeded' ? 'rate_limited' : 'transient';
    }
    // 4xx config errors (suspended key, missing key, etc.) are not recoverable
    // by the recipient changing anything — treat as transient so the operator
    // sees a delivery failure log, not a user-facing actionable error.
    return 'transient';
}

/** Which quota a Resend 429 error name refers to, or undefined when it is neither. */
export function quotaWindowFor(name: string | undefined): EmailQuotaWindow | undefined {
    if (name === 'daily_quota_exceeded') return 'daily';
    return name === 'monthly_quota_exceeded' ? 'monthly' : undefined;
}

/**
 * ResendProvider — thin fetch-based adapter over the Resend REST API.
 * Satisfies EmailProvider for send + credential validation.
 * No Resend SDK dependency — plain fetch only.
 */
export class ResendProvider implements EmailProvider {
  constructor(private creds: { apiKey: string }) {}

  async sendEmail(
    args: EmailSendArgs,
  ): Promise<
    | { ok: true; id?: string; usage?: EmailSendUsage }
    | { ok: false; error: string; kind: EmailFailureKind; retryAfterSeconds?: number; quotaWindow?: EmailQuotaWindow; usage?: EmailSendUsage }
  > {
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
      return { ok: false, error: message, kind: 'transient' };
    }

    const usage = readUsage(res.headers);

    if (res.ok) {
      let json: { id?: string } | null = null;
      try { json = (await res.json()) as { id?: string }; } catch { /* empty body */ }
      return { ok: true, ...(json?.id ? { id: json.id } : {}), ...(usage ? { usage } : {}) };
    }

    // Non-2xx — parse the body once, then classify.
    let errName: string | undefined;
    let errMsg: string;
    try {
      const body = (await res.json()) as { message?: string; name?: string } | null;
      errName = body?.name;
      errMsg  = body?.message ?? body?.name ?? `Resend ${res.status}`;
    } catch {
      errMsg = `Resend ${res.status}`;
    }

    const kind = classifyResendError(res.status, errName, errMsg);
    const failure = { status: res.status, kind, error: errMsg };
    // The kind goes in the message too: log alert rules can match message text but
    // not the data object. A used-up quota needs a human; a suppressed recipient is
    // expected and must not read as an error.
    if (kind === 'quota_exceeded') logger.alert('email-quota-exceeded', '[email] ResendProvider delivery failed (quota_exceeded)', failure);
    else if (kind === 'suppressed') logger.warn('[email] ResendProvider delivery failed (suppressed)', failure);
    else logger.error(`[email] ResendProvider delivery failed (${kind})`, failure);
    const retryAfterSeconds = kind === 'rate_limited' ? readRetryAfterSeconds(res.headers) : undefined;
    const quotaWindow = kind === 'quota_exceeded' ? quotaWindowFor(errName) : undefined;
    return {
      ok: false, error: errMsg, kind,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      ...(quotaWindow ? { quotaWindow } : {}),
      ...(usage ? { usage } : {}),
    };
  }

  async validateCredentials(): Promise<{ ok: true; restricted?: true } | { ok: false; error: string }> {
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
    // A send-only key is valid, but Resend refuses it on non-send endpoints.
    if (res.status === 401 && (await readErrorName(res)) === 'restricted_api_key') {
      return { ok: true, restricted: true };
    }
    return { ok: false, error: `Resend ${res.status}` };
  }

  /**
   * Auth-only key probe used by Settings "save" / "test connection".
   * POSTs an EMPTY send body: bad key → 401/403; valid key (incl. sending-only
   * restricted keys that 401 on GET /domains) → 422. No email is ever sent.
   * Lives on the provider so route handlers never hand-roll Resend URLs
   * (`lint:provider-helpers`).
   *
   * `reachable` is true when an HTTP response was received. On a network
   * failure `valid` stays true (a save is never blocked on provider uptime)
   * and `reachable` is false; callers that report a verdict must check it.
   */
  async probeApiKey(): Promise<{ valid: boolean; status: number | null; reachable: boolean }> {
    let res: Response | null;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.creds.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
    } catch {
      return { valid: true, status: null, reachable: false }; // network failure → don't block save on Resend uptime
    }
    if (res.status === 401 || res.status === 403) return { valid: false, status: res.status, reachable: true };
    return { valid: true, status: res.status, reachable: true };
  }

  /**
   * List the sending domains visible to this key (GET /domains) and count the
   * verified ones. A send-only key is rejected by Resend with 401
   * `restricted_api_key` and reports `reason: 'restricted'`.
   */
  async listDomains(): Promise<
    | { ok: true; total: number; verified: number; domains: Array<{ name: string; status: string }> }
    | { ok: false; reason: 'restricted' | 'unreachable' | 'error'; status: number | null }
  > {
    let res: Response;
    try {
      res = await fetch('https://api.resend.com/domains', {
        headers: { 'Authorization': `Bearer ${this.creds.apiKey}` },
      });
    } catch {
      return { ok: false, reason: 'unreachable', status: null };
    }
    if (!res.ok) {
      if (res.status === 401 && (await readErrorName(res)) === 'restricted_api_key') {
        return { ok: false, reason: 'restricted', status: res.status };
      }
      return { ok: false, reason: 'error', status: res.status };
    }
    const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
    const data: unknown[] = Array.isArray(body?.data) ? body.data : [];
    const verified = data.filter((d) => {
      const status = (d as { status?: unknown } | null)?.status;
      return typeof status === 'string' && status.toLowerCase() === 'verified';
    }).length;
    const domains = data.flatMap((d) => {
      const row = d as { name?: unknown; status?: unknown } | null;
      return typeof row?.name === 'string'
        ? [{ name: row.name.toLowerCase(), status: typeof row.status === 'string' ? row.status.toLowerCase() : 'unknown' }]
        : [];
    });
    return { ok: true, total: data.length, verified, domains };
  }

  /** Count of verified domains visible to this key (0 when the key cannot list). */
  async countVerifiedDomains(): Promise<number> {
    const result = await this.listDomains();
    return result.ok ? result.verified : 0;
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
