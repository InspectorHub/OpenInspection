/**
 * InboundSignatureContext — the single context object an inbound webhook handler
 * builds and hands to `validateInboundSignature`. Each provider reads exactly the
 * fields its signing scheme needs, so the interface stays provider-agnostic:
 *
 * - Twilio signs `url + sorted(params)` with HMAC-SHA1 and presents the result in
 *   the `x-twilio-signature` header; the `secret` is the account auth token.
 * - Telnyx signs `` `${timestamp}|${rawBody}` `` with Ed25519 and presents the
 *   base64 signature in `telnyx-signature-ed25519` plus a unix-seconds
 *   `telnyx-timestamp` header; the `secret` is the base64 Ed25519 public key.
 */
export interface InboundSignatureContext {
    /** Full signed URL (Twilio signs this concatenated with the sorted params). */
    url: string;
    /** EXACT raw request body (Telnyx signs `` `${timestamp}|${rawBody}` ``). */
    rawBody: string;
    /** Parsed form/JSON params (Twilio sorts and concatenates these). */
    params: Record<string, string>;
    /** LOWER-CASED header name -> value; each provider reads its own sig/timestamp header. */
    headers: Record<string, string>;
    /** Twilio: account auth token. Telnyx: base64 Ed25519 public key. */
    secret: string;
    /** Injectable clock for anti-replay tests (defaults to `Date.now()`). */
    nowMs?: number;
}

/**
 * MessagingProvider — the single contract that every SMS adapter satisfies.
 *
 * Current surface covers the send + inbound-signature operations shipped in Track L.
 * Managed-compliance methods (toll-free registration, brand, campaign, messaging service,
 * number provisioning, subaccount management) will extend this interface in a later plan.
 */
export interface MessagingProvider {
    /**
     * Send an outbound SMS message.
     * Supply either `from` (a Twilio phone number) or `messagingServiceSid` — not both.
     * Returns `{ ok: true; id? }` on success (`id` = the provider message id —
     * Twilio message SID / Telnyx message id — used to correlate later delivery-
     * status callbacks; omitted when the provider response lacks it). Returns
     * `{ ok: false; error: string }` on provider failure.
     */
    sendMessage(args: {
        from?: string;
        to: string;
        body: string;
        messagingServiceSid?: string;
    }): Promise<{ ok: true; id?: string } | { ok: false; error: string }>;

    /**
     * Validate an inbound webhook signature from the provider.
     * Reads only the fields its scheme needs from `ctx`. Returns `true` only when
     * the signature matches; fails closed to `false` on any missing/invalid input,
     * out-of-tolerance timestamp, or verification error — never throws.
     */
    validateInboundSignature(ctx: InboundSignatureContext): Promise<boolean>;
}
