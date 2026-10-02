/**
 * EmailProvider — the single contract that every email transport adapter satisfies.
 *
 * The interface is intentionally minimal: send + optional credential check.
 * Provider-specific features (e.g. batch sends, domain management) are NOT
 * part of this surface — extend via concrete adapters only.
 */

export interface EmailSendArgs {
  /** RFC 5322 "From" address, optionally formatted as "Name <addr>". */
  from: string;
  /** Recipient address(es). Resend accepts a single string or an array. */
  to: string | string[];
  subject: string;
  html: string;
  /** Optional reply-to address. Sent as `reply_to` in the Resend payload. */
  replyTo?: string;
  /** Optional plain-text fallback body. */
  text?: string;
  /** Optional base64-encoded file attachments (Resend attachment shape). */
  attachments?: Array<{ filename: string; content: string; content_type?: string }>;
}

/**
 * EmailWebhookContext — the single context object an inbound webhook handler
 * builds and hands to `verifyWebhookSignature`. Each provider reads exactly the
 * fields its signing scheme needs, so the interface stays provider-agnostic:
 *
 * - Resend (Svix): HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${rawBody}`;
 *   the `secret` is the `whsec_<base64>` signing secret.
 * - SendGrid: ECDSA P-256 over `${timestamp}${rawBody}`; the `secret` is the
 *   base64 DER/SPKI public verification key.
 * - Postmark: no HMAC — the `secret` is a shared token matched (constant-time)
 *   against `query.token` or the Basic-auth password in `headers.authorization`.
 * - Mailgun: HMAC-SHA256 hex over `${timestamp}${token}` read from the body's
 *   `signature` object; the `secret` is the signing key.
 */
export interface EmailWebhookContext {
  /** EXACT raw request body — every scheme signs raw bytes. */
  rawBody: string;
  /** LOWER-CASED header name -> value; each provider reads its own sig/timestamp header. */
  headers: Record<string, string>;
  /** The provider's webhook signing secret (see each scheme above). */
  secret: string;
  /** Parsed query params (Postmark's shared token may ride `?token=`). */
  query: Record<string, string>;
  /** Injectable clock for anti-replay tests (defaults to `Date.now()`). */
  nowMs?: number;
}

/**
 * NormalizedEmailEvent — the provider-agnostic shape `parseWebhookEvents`
 * produces. Only the three event classes the suppression pipeline cares about
 * are represented; everything else is dropped by the parser.
 */
export type NormalizedEmailEvent = {
  type: 'delivered' | 'bounced' | 'complained';
  /** Recipient address. */
  email: string;
  /** Only meaningful for `type === 'bounced'`: hard (permanent) vs soft (transient). */
  hardBounce?: boolean;
  /** Provider event id for idempotency dedup. */
  providerEventId: string;
  /** Event time in ms epoch (0 when the provider supplied none). */
  at: number;
};

/**
 * Structured failure kinds returned by `sendEmail`.
 *
 * `transient`      — provider-side fault (5xx, rate-limit, lock). Safe to
 *                    retry after a delay; no operator action required now.
 * `suppressed`     — Resend (or another provider) rejected the address because
 *                    it is on their suppression list. The send will keep failing
 *                    until the block clears; write it to `email_suppressions`
 *                    so we stop trying before the provider rejects it again.
 * `quota_exceeded` — daily or monthly send quota exhausted. Operator must
 *                    upgrade their plan or wait for the quota to reset.
 * `sender_domain`  — the `from` domain is unverified or the key is limited to
 *                    test sends. Operator must verify the domain in Resend.
 */
export type EmailFailureKind = 'transient' | 'suppressed' | 'quota_exceeded' | 'sender_domain';

export interface EmailProvider {
  /**
   * Send a transactional email.
   *
   * Returns `{ ok: true; id? }` on success.
   * Returns `{ ok: false; error; kind }` on failure — implementations MUST NOT
   * throw. `kind` lets callers branch on WHY delivery failed rather than
   * treating all failures identically.
   */
  sendEmail(args: EmailSendArgs): Promise<{ ok: true; id?: string } | { ok: false; error: string; kind: EmailFailureKind }>;

  /**
   * Optional lightweight credential check (e.g. a GET /domains call).
   * Used by Settings "validate on save" flows — Task 6.
   */
  validateCredentials?(): Promise<{ ok: true } | { ok: false; error: string }>;

  /**
   * Verify an inbound webhook signature using the provider's scheme. Reads only
   * the fields its scheme needs from `ctx`. Returns `true` only when the
   * signature matches; fails closed to `false` on any missing/invalid input,
   * out-of-tolerance timestamp, or verification error — never throws.
   */
  verifyWebhookSignature(ctx: EmailWebhookContext): Promise<boolean>;

  /**
   * Parse a verified webhook body into normalized events. Guards every access
   * and returns `[]` on malformed input — never throws. Events whose recipient
   * email is absent/non-string are dropped (no row with an empty email).
   */
  parseWebhookEvents(rawBody: string): NormalizedEmailEvent[];
}
