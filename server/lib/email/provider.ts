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

export interface EmailProvider {
  /**
   * Send a transactional email.
   * Returns `{ ok: true; id? }` on success; `{ ok: false; error }` on failure.
   * Implementations MUST NOT throw — errors are surfaced via the result shape.
   */
  sendEmail(args: EmailSendArgs): Promise<{ ok: true; id?: string } | { ok: false; error: string }>;

  /**
   * Optional lightweight credential check (e.g. a GET /domains call).
   * Used by Settings "validate on save" flows — Task 6.
   */
  validateCredentials?(): Promise<{ ok: true } | { ok: false; error: string }>;
}
