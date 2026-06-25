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
     * Returns `{ ok: true }` on success; `{ ok: false; error: string }` on provider failure.
     */
    sendMessage(args: {
        from?: string;
        to: string;
        body: string;
        messagingServiceSid?: string;
    }): Promise<{ ok: true } | { ok: false; error: string }>;

    /**
     * Validate an inbound webhook signature from the provider.
     * Returns `true` only when the signature matches; always returns `false` when
     * `presented` is empty or does not match the computed value.
     */
    validateInboundSignature(
        authToken: string,
        url: string,
        params: Record<string, string>,
        presented: string,
    ): Promise<boolean>;
}
