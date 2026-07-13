// server/lib/messaging/twilio-rest-client.ts
//
// Fetch-based Twilio REST client that satisfies TwilioComplianceClient — the
// compliance provider's minimal structural interface (server/lib/messaging/
// providers/twilio-compliance.ts). Replaces the twilio-node SDK entirely (no
// SDK import, no SDK types) so the Worker bundle drops the SDK's axios/
// node-http baggage and stays under the Workers Free 3 MiB gzip limit.
//
// DRIFT SURFACE — this file is the sole place Twilio field names / resource
// paths for the MANAGED-ISV compliance flow live. It mirrors the endpoint
// knowledge already proven in server/lib/messaging/twilio.ts's TwilioClient
// (the send-path fetch client, same auth scheme + REST surfaces), reshaped
// into the fluent `messaging.v1.X` / `availablePhoneNumbers(country)` shape
// twilio-compliance.ts's provider logic calls directly (unchanged).
//
// Auth: HTTP Basic, username = API Key SID, password = API Key Secret (the
// managed-ISV credential triple resolve-compliance-provider.ts reads).
// Bodies: application/x-www-form-urlencoded. Responses: JSON.

import type { TwilioComplianceClient } from './providers/twilio-compliance';

export interface TwilioRestClientCreds {
    /** Master Account SID — used in classic Account-API paths (numbers). */
    accountSid: string;
    /** API Key SID — Basic-auth username for all calls. */
    apiKeySid: string;
    /** API Key Secret — Basic-auth password for all calls. */
    apiKeySecret: string;
}

interface TwilioFetchResult { status: number; json: unknown }

async function twilioFetch(
    creds: TwilioRestClientCreds,
    method: string,
    url: string,
    data?: Record<string, string>,
): Promise<TwilioFetchResult> {
    const headers: Record<string, string> = {
        Authorization: `Basic ${btoa(`${creds.apiKeySid}:${creds.apiKeySecret}`)}`,
    };
    const init: RequestInit = { method, headers };
    if (data) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        init.body = new URLSearchParams(data).toString();
    }
    const res = await fetch(url, init);
    let json: unknown = null;
    try { json = await res.json(); } catch { /* empty/non-JSON body */ }
    return { status: res.status, json };
}

/** Surface Twilio's error message on a non-2xx (mirrors twilio.ts's throwIfError). */
function throwIfError(r: TwilioFetchResult): void {
    if (r.status < 200 || r.status >= 300) {
        const msg = (r.json as { message?: string } | null)?.message ?? `Twilio ${r.status}`;
        throw new Error(msg);
    }
}

const API = (accountSid: string) => `https://api.twilio.com/2010-04-01/Accounts/${accountSid}`;
const MESSAGING = 'https://messaging.twilio.com';

/**
 * Build a TwilioComplianceClient bound to the given managed-ISV credentials.
 * Every fluent method THROWS on a non-2xx response (mirroring twilio-node's
 * RestException behavior, which the provider's non-generic call sites rely
 * on). The generic `request()` method does NOT throw — the provider's own
 * `genericPost` checks `statusCode` itself, matching twilio-node's
 * `client.request()` (which never throws on error status).
 */
export function createTwilioRestClient(creds: TwilioRestClientCreds): TwilioComplianceClient {
    const { accountSid } = creds;

    const availableNumbersList = (country: string, catalog: 'Local' | 'TollFree') => ({
        async list(params?: { areaCode?: string; limit?: number }) {
            const url = new URL(`${API(accountSid)}/AvailablePhoneNumbers/${country}/${catalog}.json`);
            if (params?.areaCode) url.searchParams.set('AreaCode', params.areaCode);
            if (params?.limit) url.searchParams.set('PageSize', String(params.limit));
            const r = await twilioFetch(creds, 'GET', url.toString());
            throwIfError(r);
            const items = (r.json as { available_phone_numbers?: Array<{ phone_number: string }> } | null)
                ?.available_phone_numbers ?? [];
            return items.map((x) => ({ phoneNumber: x.phone_number }));
        },
    });

    return {
        async request(opts) {
            const r = await twilioFetch(creds, opts.method.toUpperCase(), opts.uri, opts.data);
            return { statusCode: r.status, body: r.json };
        },

        messaging: {
            v1: {
                brandRegistrations: {
                    async create(params) {
                        const r = await twilioFetch(creds, 'POST', `${MESSAGING}/v1/a2p/BrandRegistrations`, {
                            CustomerProfileBundleSid: params.customerProfileBundleSid,
                            A2PProfileBundleSid: params.a2PProfileBundleSid,
                            BrandType: params.brandType,
                        });
                        throwIfError(r);
                        const j = r.json as { sid: string; status: string };
                        return { sid: j.sid, status: j.status };
                    },
                    async list(params) {
                        const url = new URL(`${MESSAGING}/v1/a2p/BrandRegistrations`);
                        if (params?.limit) url.searchParams.set('PageSize', String(params.limit));
                        const r = await twilioFetch(creds, 'GET', url.toString());
                        throwIfError(r);
                        const items = (r.json as { data?: Array<{ sid: string; status: string }> } | null)?.data ?? [];
                        return items.map((x) => ({ sid: x.sid, status: x.status }));
                    },
                },

                services: Object.assign(
                    (sid: string) => ({
                        phoneNumbers: {
                            async create(params: { phoneNumberSid: string }) {
                                const r = await twilioFetch(
                                    creds, 'POST', `${MESSAGING}/v1/Services/${sid}/PhoneNumbers`,
                                    { PhoneNumberSid: params.phoneNumberSid },
                                );
                                throwIfError(r);
                                const j = r.json as { sid?: string };
                                return { sid: j.sid ?? '' };
                            },
                        },
                    }),
                    {
                        async create(params: { friendlyName: string }) {
                            const r = await twilioFetch(creds, 'POST', `${MESSAGING}/v1/Services`, {
                                FriendlyName: params.friendlyName,
                            });
                            throwIfError(r);
                            const j = r.json as { sid: string };
                            return { sid: j.sid };
                        },
                    },
                ),

                tollfreeVerifications: {
                    async list(params) {
                        const url = new URL(`${MESSAGING}/v1/Tollfree/Verifications`);
                        if (params?.limit) url.searchParams.set('PageSize', String(params.limit));
                        const r = await twilioFetch(creds, 'GET', url.toString());
                        throwIfError(r);
                        const items = (r.json as { verifications?: Array<{ sid: string; status: string }> } | null)
                            ?.verifications ?? [];
                        return items.map((x) => ({ sid: x.sid, status: x.status }));
                    },
                },
            },
        },

        availablePhoneNumbers(country: string) {
            return {
                local: availableNumbersList(country, 'Local'),
                tollFree: availableNumbersList(country, 'TollFree'),
            };
        },

        incomingPhoneNumbers: {
            async create(params: { phoneNumber: string }) {
                const r = await twilioFetch(
                    creds, 'POST', `${API(accountSid)}/IncomingPhoneNumbers.json`,
                    { PhoneNumber: params.phoneNumber },
                );
                throwIfError(r);
                const j = r.json as { sid: string; phone_number: string };
                return { sid: j.sid, phoneNumber: j.phone_number };
            },
        },
    };
}
