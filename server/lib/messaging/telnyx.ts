import type { InboundSignatureContext, MessagingProvider } from './provider';
import { logger } from '../logger';

export interface TelnyxCreds {
    apiKey: string;
    from: string;
}

/**
 * TelnyxProvider — thin fetch-based adapter for the Telnyx Messaging v2 REST API.
 * Satisfies MessagingProvider for outbound send + inbound Ed25519 signature
 * verification. No Telnyx SDK dependency.
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
    }): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
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
            // Never log the recipient phone (no PII in logs).
            logger.error('TelnyxProvider: fetch error', {}, err instanceof Error ? err : undefined);
            return { ok: false, error: `Telnyx network error: ${message}` };
        }
        if (res.ok) {
            // Telnyx returns the created message under `data.id` — the correlation
            // id for later delivery-receipt (message.finalized) webhooks.
            let id: string | undefined;
            try {
                const json = await res.json() as { data?: { id?: string } } | null;
                id = json?.data?.id;
            } catch { /* empty/unparseable body — succeed without an id */ }
            return id ? { ok: true, id } : { ok: true };
        }
        let errorText = `Telnyx ${res.status}`;
        try {
            const json = await res.json() as { errors?: Array<{ detail?: string }> } | null;
            const detail = json?.errors?.[0]?.detail;
            if (detail) errorText = detail;
        } catch { /* empty body — keep the default */ }
        // Never log the recipient phone (no PII in logs) — status/error only.
        logger.error('TelnyxProvider: send failed', { status: res.status });
        return { ok: false, error: errorText };
    }

    /**
     * Implements MessagingProvider.validateInboundSignature for Telnyx Ed25519
     * webhooks. Reads the base64 signature + unix-seconds timestamp from the
     * lower-cased Telnyx headers and verifies against the base64 public key in
     * `ctx.secret`. Fails closed (`false`) on any error — see verifyTelnyxSignature.
     */
    validateInboundSignature(ctx: InboundSignatureContext): Promise<boolean> {
        return verifyTelnyxSignature(
            ctx.secret,
            ctx.headers['telnyx-timestamp'] ?? '',
            ctx.rawBody,
            ctx.headers['telnyx-signature-ed25519'] ?? '',
            ctx.nowMs,
        );
    }
}

/** Decode a standard base64 string to raw bytes. Throws on malformed input. */
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
    const bin = atob(b64);
    const bytes = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

/**
 * Verify a Telnyx inbound webhook Ed25519 signature.
 *
 * Telnyx signs `` `${timestamp}|${rawBody}` `` (timestamp is unix SECONDS) with its
 * Ed25519 private key and presents the base64 signature in the
 * `telnyx-signature-ed25519` header. The matching base64 public key is supplied
 * out-of-band (platform env or tenant BYO secret).
 *
 * Fails closed (`false`, never throws) on: missing/empty timestamp or signature;
 * timestamp more than ±300s from `nowMs` (anti-replay); malformed base64 key or
 * signature; or any verification failure.
 */
export async function verifyTelnyxSignature(
    publicKeyB64: string,
    timestamp: string,
    rawBody: string,
    signatureB64: string,
    nowMs?: number,
): Promise<boolean> {
    try {
        if (!timestamp || !signatureB64) return false;
        const tsSeconds = Number(timestamp);
        if (!Number.isFinite(tsSeconds)) return false;
        const now = nowMs ?? Date.now();
        if (Math.abs(now - tsSeconds * 1000) > 300_000) return false;

        const rawKey = base64ToBytes(publicKeyB64);
        const sig = base64ToBytes(signatureB64);
        const key = await crypto.subtle.importKey('raw', rawKey, { name: 'Ed25519' }, false, ['verify']);
        const data = new TextEncoder().encode(`${timestamp}|${rawBody}`);
        return await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, data);
    } catch {
        return false;
    }
}
