import type { MessagingProvider } from './provider';
import { logger } from '../logger';

export interface TelnyxCreds {
    apiKey: string;
    from: string;
}

/**
 * TelnyxProvider — thin fetch-based adapter for the Telnyx Messaging v2 REST API.
 * Satisfies MessagingProvider for outbound send. No Telnyx SDK dependency.
 *
 * Inbound signature verification (Ed25519 webhooks) is NOT implemented here — BYO
 * Telnyx outbound ships now; inbound STOP/HELP parity is an explicit follow-up.
 * TODO(#196 Phase 2): Telnyx inbound (STOP/HELP) Ed25519 webhook verification —
 *   BYO Telnyx outbound ships now; inbound parity is a follow-up.
 */
export class TelnyxProvider implements MessagingProvider {
    constructor(private creds: TelnyxCreds) {}

    /**
     * Send an outbound SMS via POST https://api.telnyx.com/v2/messages.
     * Uses `from` (a Telnyx phone number or messaging profile ID) as the sender.
     * The `messagingServiceSid` arg is a Twilio concept — ignored here.
     */
    async sendMessage(args: {
        from?: string;
        to: string;
        body: string;
        messagingServiceSid?: string;
    }): Promise<{ ok: true } | { ok: false; error: string }> {
        const from = args.from ?? this.creds.from;
        const payload = { from, to: args.to, text: args.body };
        let res: Response;
        try {
            res = await fetch('https://api.telnyx.com/v2/messages', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.creds.apiKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify(payload),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Network error';
            logger.error('TelnyxProvider: fetch error', { to: args.to }, err instanceof Error ? err : undefined);
            return { ok: false, error: `Telnyx network error: ${message}` };
        }
        if (res.ok) return { ok: true };
        let errorText = `Telnyx ${res.status}`;
        try {
            const json = await res.json() as { errors?: Array<{ detail?: string }> } | null;
            const detail = json?.errors?.[0]?.detail;
            if (detail) errorText = detail;
        } catch { /* empty body — keep the default */ }
        logger.error('TelnyxProvider: send failed', { status: res.status, to: args.to });
        return { ok: false, error: errorText };
    }

    /**
     * Telnyx inbound webhooks use Ed25519 signatures — different from Twilio's HMAC-SHA1.
     * Full Ed25519 verification is deferred to a follow-up task.
     * TODO(#196 Phase 2): Telnyx inbound (STOP/HELP) Ed25519 webhook verification —
     *   BYO Telnyx outbound ships now; inbound parity is a follow-up.
     */
    validateInboundSignature(
        _authToken: string,
        _url: string,
        _params: Record<string, string>,
        _presented: string,
    ): Promise<boolean> {
        return Promise.resolve(false);
    }
}
