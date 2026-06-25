import type { MessagingProvider } from './provider';

export interface TwilioCreds { sid: string; token: string; from: string; }

/**
 * TwilioClient — thin fetch-based adapter over the Twilio REST API.
 * Satisfies MessagingProvider for send + inbound-signature validation.
 * Uses basic-auth over HTTPS; no Twilio SDK dependency.
 *
 * The `request()` method is a general entry point for all Twilio REST surfaces
 * (messages, tollfree, trusthub, …) — later tasks will call it directly for
 * compliance registration endpoints without adding SDK dependencies.
 */
export class TwilioClient implements MessagingProvider {
    constructor(private creds: { sid: string; token: string }) {}

    private authHeader(): string {
        return `Basic ${btoa(`${this.creds.sid}:${this.creds.token}`)}`;
    }

    /** One typed REST entry point for all Twilio surfaces (messages, tollfree, trusthub, …). */
    async request(
        method: string,
        subdomain: string,
        path: string,
        form?: Record<string, string>,
    ): Promise<{ ok: boolean; status: number; json: unknown }> {
        const init: RequestInit = { method, headers: { Authorization: this.authHeader() } };
        if (form) {
            (init.headers as Record<string, string>)['Content-Type'] = 'application/x-www-form-urlencoded';
            init.body = new URLSearchParams(form).toString();
        }
        const res = await fetch(`https://${subdomain}.twilio.com${path}`, init);
        let json: unknown = null;
        try { json = await res.json(); } catch { /* empty body */ }
        return { ok: res.ok, status: res.status, json };
    }

    messages = {
        create: async (args: {
            from: string;
            to: string;
            body: string;
            messagingServiceSid?: string;
        }): Promise<{ ok: true } | { ok: false; error: string }> => {
            const form: Record<string, string> = { To: args.to, Body: args.body };
            if (args.messagingServiceSid) form.MessagingServiceSid = args.messagingServiceSid;
            else form.From = args.from;
            const r = await this.request('POST', 'api', `/2010-04-01/Accounts/${this.creds.sid}/Messages.json`, form);
            if (r.ok) return { ok: true };
            const msg = (r.json as { message?: string } | null)?.message ?? `Twilio ${r.status}`;
            return { ok: false, error: msg };
        },
    };

    tollfree = {
        list: async (): Promise<Array<{ sid: string; status: string; phoneNumber: string }>> => {
            const r = await this.request('GET', 'messaging', '/v1/Tollfree/Verifications');
            const v = (r.json as { verifications?: Array<{ sid: string; status: string; tollfree_phone_number_sid?: string }> } | null)?.verifications ?? [];
            return v.map((x) => ({ sid: x.sid, status: x.status, phoneNumber: x.tollfree_phone_number_sid ?? '' }));
        },
    };

    brands = {
        list: async (): Promise<Array<{ sid: string; status: string }>> => {
            const r = await this.request('GET', 'messaging', '/v1/a2p/BrandRegistrations');
            const b = (r.json as { data?: Array<{ sid: string; status: string }> } | null)?.data ?? [];
            return b.map((x) => ({ sid: x.sid, status: x.status }));
        },
    };

    /** Implements MessagingProvider.sendMessage — delegates to messages.create. */
    sendMessage(args: {
        from?: string;
        to: string;
        body: string;
        messagingServiceSid?: string;
    }): Promise<{ ok: true } | { ok: false; error: string }> {
        const createArgs: { from: string; to: string; body: string; messagingServiceSid?: string } = {
            from: args.from ?? '',
            to: args.to,
            body: args.body,
        };
        if (args.messagingServiceSid !== undefined) createArgs.messagingServiceSid = args.messagingServiceSid;
        return this.messages.create(createArgs);
    }

    /** Implements MessagingProvider.validateInboundSignature — thin wrapper over validateTwilioSignature. */
    validateInboundSignature(
        authToken: string,
        url: string,
        params: Record<string, string>,
        presented: string,
    ): Promise<boolean> {
        return validateTwilioSignature(authToken, url, params, presented);
    }
}

/**
 * Twilio request signature = base64( HMAC-SHA1( authToken, URL + sorted(k+v) ) ).
 * See https://www.twilio.com/docs/usage/security#validating-requests
 *
 * Body is copied verbatim from send-sms.ts so existing signature tests remain green.
 */
export async function signParams(authToken: string, url: string, params: Record<string, string>): Promise<string> {
    const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function validateTwilioSignature(
    authToken: string,
    url: string,
    params: Record<string, string>,
    presented: string,
): Promise<boolean> {
    if (!presented) return false;
    const expected = await signParams(authToken, url, params);
    // constant-time-ish compare
    if (expected.length !== presented.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
    return diff === 0;
}
