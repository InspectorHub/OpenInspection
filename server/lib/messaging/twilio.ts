import type { InboundSignatureContext, MessagingProvider } from './provider';

export interface TwilioCreds {
    sid: string;
    token: string;
    from: string;
    /**
     * API Key SID for the managed-pool send path. When present, Basic-auth uses
     * authSid as the USERNAME instead of the Account SID (sid). The REST path
     * always uses sid (the Account SID). Omit for own/platform credential sets.
     */
    authSid?: string;
    /**
     * Messaging Service SID provisioned during TCR/TFV compliance registration.
     * Used by the managed-pool send path instead of a From number.
     */
    messagingServiceSid?: string;
}

/**
 * TwilioClient — thin fetch-based adapter over the Twilio REST API.
 * Satisfies MessagingProvider for send + inbound-signature validation.
 * Uses basic-auth over HTTPS; no Twilio SDK dependency.
 *
 * The `request()` method is a general entry point for all Twilio REST surfaces
 * (messages, tollfree, trusthub, …) — later tasks will call it directly for
 * compliance registration endpoints without adding SDK dependencies.
 *
 * API-key auth (managed-pool path): when `authSid` is supplied the Basic-auth
 * USERNAME is authSid (the API Key SID) and the password is `token` (the API
 * Key Secret). The REST path still uses `sid` (the master Account SID). This is
 * byte-compatible with the Twilio API-key authentication scheme described at
 * https://www.twilio.com/docs/iam/keys/api-key. Existing callers that omit
 * authSid behave exactly as before.
 */
export class TwilioClient implements MessagingProvider {
    constructor(private creds: { sid: string; token: string; authSid?: string }) {}

    private authHeader(): string {
        // Managed path: authSid (API Key SID) is the Basic-auth username.
        // Own/platform path: sid (Account SID) is the username, unchanged.
        return `Basic ${btoa(`${this.creds.authSid ?? this.creds.sid}:${this.creds.token}`)}`;
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
        }): Promise<{ ok: true; id?: string } | { ok: false; error: string }> => {
            const form: Record<string, string> = { To: args.to, Body: args.body };
            if (args.messagingServiceSid) form.MessagingServiceSid = args.messagingServiceSid;
            else form.From = args.from;
            const r = await this.request('POST', 'api', `/2010-04-01/Accounts/${this.creds.sid}/Messages.json`, form);
            if (r.ok) {
                // Twilio returns the message resource with `sid` — the correlation
                // id for later StatusCallback delivery events.
                const sid = (r.json as { sid?: string } | null)?.sid;
                return sid ? { ok: true, id: sid } : { ok: true };
            }
            const msg = (r.json as { message?: string } | null)?.message ?? `Twilio ${r.status}`;
            return { ok: false, error: msg };
        },
    };

    // -------------------------------------------------------------------------
    // Managed-ISV provisioning write surfaces.
    // NOTE: The form-field names below (e.g. TollfreePhoneNumberSid, BrandType)
    // are the drift surface — Twilio API field names evolve; keep all of them
    // isolated in this one file so a single audit catches all changes.
    // -------------------------------------------------------------------------

    /** Helper: throw with Twilio's error message when a request is not ok. */
    private async throwIfError(r: { ok: boolean; status: number; json: unknown }): Promise<void> {
        if (!r.ok) {
            const msg =
                (r.json as { message?: string } | null)?.message ?? `Twilio ${r.status}`;
            throw new Error(msg);
        }
    }

    tollfree = {
        list: async (): Promise<Array<{ sid: string; status: string; phoneNumber: string }>> => {
            const r = await this.request('GET', 'messaging', '/v1/Tollfree/Verifications');
            const v = (r.json as { verifications?: Array<{ sid: string; status: string; tollfree_phone_number_sid?: string }> } | null)?.verifications ?? [];
            return v.map((x) => ({ sid: x.sid, status: x.status, phoneNumber: x.tollfree_phone_number_sid ?? '' }));
        },

        create: async (args: {
            tollfreePhoneNumberSid: string;
            useCaseDescription: string;
            messagingServiceSid: string;
            notificationEmail: string;
            useCaseSummary: string;
            productionMessageSample: string;
            optInType: string;
            optInImageUrls?: string[];
        }): Promise<{ sid: string; status: string }> => {
            const form: Record<string, string> = {
                TollfreePhoneNumberSid: args.tollfreePhoneNumberSid,
                UseCaseDescription: args.useCaseDescription,
                MessagingServiceSid: args.messagingServiceSid,
                NotificationEmail: args.notificationEmail,
                UseCaseSummary: args.useCaseSummary,
                ProductionMessageSample: args.productionMessageSample,
                OptInType: args.optInType,
            };
            if (args.optInImageUrls) {
                args.optInImageUrls.forEach((u, i) => { form[`OptInImageUrls[${i}]`] = u; });
            }
            const r = await this.request('POST', 'messaging', '/v1/Tollfree/Verifications', form);
            await this.throwIfError(r);
            const j = r.json as { sid: string; status: string };
            return { sid: j.sid, status: j.status };
        },
    };

    trusthub = {
        createSecondaryProfile: async (args: {
            friendlyName: string;
            email: string;
            isvRegisteringForSelfOrSubaccounts: string;
            statusCallbackUrl?: string;
        }): Promise<{ sid: string; status?: string }> => {
            const form: Record<string, string> = {
                FriendlyName: args.friendlyName,
                Email: args.email,
                IsvRegisteringForSelfOrSubaccounts: args.isvRegisteringForSelfOrSubaccounts,
            };
            if (args.statusCallbackUrl) form.StatusCallbackUrl = args.statusCallbackUrl;
            const r = await this.request('POST', 'trusthub', '/v1/CustomerProfiles', form);
            await this.throwIfError(r);
            const j = r.json as { sid: string; status?: string };
            const result: { sid: string; status?: string } = { sid: j.sid };
            if (j.status !== undefined) result.status = j.status;
            return result;
        },
    };

    brands = {
        list: async (): Promise<Array<{ sid: string; status: string }>> => {
            const r = await this.request('GET', 'messaging', '/v1/a2p/BrandRegistrations');
            const b = (r.json as { data?: Array<{ sid: string; status: string }> } | null)?.data ?? [];
            return b.map((x) => ({ sid: x.sid, status: x.status }));
        },

        createSoleProprietor: async (args: {
            customerProfileBundleSid: string;
            a2pProfileBundleSid: string;
            brandType: string;
        }): Promise<{ sid: string; status: string }> => {
            const form: Record<string, string> = {
                CustomerProfileBundleSid: args.customerProfileBundleSid,
                A2PProfileBundleSid: args.a2pProfileBundleSid,
                BrandType: args.brandType,
            };
            const r = await this.request('POST', 'messaging', '/v1/a2p/BrandRegistrations', form);
            await this.throwIfError(r);
            const j = r.json as { sid: string; status: string };
            return { sid: j.sid, status: j.status };
        },
    };

    campaigns = {
        create: async (args: {
            messagingServiceSid: string;
            brandRegistrationSid: string;
            description: string;
            messageFlow: string;
            messageSamples: string[];
            usAppToPersonUsecase: string;
            hasEmbeddedLinks: boolean;
            hasEmbeddedPhone: boolean;
        }): Promise<{ sid: string; status: string }> => {
            const form: Record<string, string> = {
                BrandRegistrationSid: args.brandRegistrationSid,
                Description: args.description,
                MessageFlow: args.messageFlow,
                UsAppToPersonUsecase: args.usAppToPersonUsecase,
                HasEmbeddedLinks: String(args.hasEmbeddedLinks),
                HasEmbeddedPhone: String(args.hasEmbeddedPhone),
            };
            args.messageSamples.forEach((s, i) => { form[`MessageSamples[${i}]`] = s; });
            const r = await this.request(
                'POST',
                'messaging',
                `/v1/Services/${args.messagingServiceSid}/Compliance/Usa2p`,
                form,
            );
            await this.throwIfError(r);
            const j = r.json as { sid: string; status: string };
            return { sid: j.sid, status: j.status };
        },
    };

    messagingServices = {
        create: async (args: { friendlyName: string }): Promise<{ sid: string }> => {
            const r = await this.request('POST', 'messaging', '/v1/Services', {
                FriendlyName: args.friendlyName,
            });
            await this.throwIfError(r);
            const j = r.json as { sid: string };
            return { sid: j.sid };
        },

        attachSender: async (messagingServiceSid: string, phoneNumberSid: string): Promise<{ sid: string }> => {
            const r = await this.request(
                'POST',
                'messaging',
                `/v1/Services/${messagingServiceSid}/PhoneNumbers`,
                { PhoneNumberSid: phoneNumberSid },
            );
            await this.throwIfError(r);
            const j = r.json as { sid?: string };
            // A 2xx with no sid is not a valid attach result — surface it rather
            // than propagate an empty string into the persisted provisioning row.
            if (!j.sid) throw new Error('Twilio attachSender returned no sid');
            return { sid: j.sid };
        },

        /**
         * Associates compliance with a messaging service.
         * - TFV path (tfvSid): POSTs to the tollfree verification to link the messaging service.
         * - 10DLC path (campaignSid): no-op — the campaign is already created under the
         *   messaging service via campaigns.create; no additional API call is needed.
         */
        attachCompliance: async (
            messagingServiceSid: string,
            opts: { campaignSid?: string; tfvSid?: string },
        ): Promise<Record<string, never>> => {
            if (opts.tfvSid) {
                const r = await this.request(
                    'POST',
                    'messaging',
                    `/v1/Tollfree/Verifications/${opts.tfvSid}`,
                    { MessagingServiceSid: messagingServiceSid },
                );
                await this.throwIfError(r);
            }
            return {};
        },
    };

    numbers = {
        /**
         * Search for available US phone numbers.
         * - 'tollfree' → AvailablePhoneNumbers/US/TollFree.json (no AreaCode support from Twilio)
         * - 'local'    → AvailablePhoneNumbers/US/Local.json (10DLC sole-prop needs a local DID)
         * areaCode is passed as the AreaCode query param when provided (primarily useful for local).
         */
        search: async (kind: 'tollfree' | 'local', areaCode?: string): Promise<Array<{ phoneNumber: string }>> => {
            const catalog = kind === 'local' ? 'Local' : 'TollFree';
            const base = `/2010-04-01/Accounts/${this.creds.sid}/AvailablePhoneNumbers/US/${catalog}.json`;
            const path = areaCode ? `${base}?AreaCode=${encodeURIComponent(areaCode)}` : base;
            const r = await this.request('GET', 'api', path);
            const items =
                (r.json as { available_phone_numbers?: Array<{ phone_number: string }> } | null)
                    ?.available_phone_numbers ?? [];
            return items.map((x) => ({ phoneNumber: x.phone_number }));
        },

        buy: async (phoneNumber: string): Promise<{ sid: string; phoneNumber: string }> => {
            const r = await this.request(
                'POST',
                'api',
                `/2010-04-01/Accounts/${this.creds.sid}/IncomingPhoneNumbers.json`,
                { PhoneNumber: phoneNumber },
            );
            await this.throwIfError(r);
            const j = r.json as { sid: string; phone_number: string };
            return { sid: j.sid, phoneNumber: j.phone_number };
        },
    };

    /** Implements MessagingProvider.sendMessage — delegates to messages.create. */
    sendMessage(args: {
        from?: string;
        to: string;
        body: string;
        messagingServiceSid?: string;
    }): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
        const createArgs: { from: string; to: string; body: string; messagingServiceSid?: string } = {
            from: args.from ?? '',
            to: args.to,
            body: args.body,
        };
        if (args.messagingServiceSid !== undefined) createArgs.messagingServiceSid = args.messagingServiceSid;
        return this.messages.create(createArgs);
    }

    /**
     * Implements MessagingProvider.validateInboundSignature — thin wrapper over
     * validateTwilioSignature. Reads the auth token from `ctx.secret` and the
     * presented HMAC from the lower-cased `x-twilio-signature` header; the
     * underlying computation is byte-identical to the legacy 4-arg call.
     */
    validateInboundSignature(ctx: InboundSignatureContext): Promise<boolean> {
        return validateTwilioSignature(ctx.secret, ctx.url, ctx.params, ctx.headers['x-twilio-signature'] ?? '');
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
