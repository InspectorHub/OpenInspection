// server/lib/messaging/telnyx-rest-client.ts
//
// Fetch-based Telnyx REST client that satisfies TelnyxComplianceClient — the
// compliance provider's minimal structural interface (server/lib/messaging/
// providers/telnyx-compliance.ts). Replaces the `telnyx` (Stainless) SDK
// entirely so the Worker bundle stays under the Workers Free 3 MiB gzip
// limit.
//
// Auth: `Authorization: Bearer <apiKey>`. Base: https://api.telnyx.com/v2.
// Bodies: JSON. Responses: JSON, wrapped `{ data: {...} }` per Telnyx's v2
// convention.
//
// UNWRAP SURFACE (pinned against the doc comments in telnyx-compliance.ts,
// themselves pinned from node_modules/telnyx's generated types): brand
// create/retrieve/externalVetting.order, campaign retrieve/campaignBuilder
// submit, phoneNumberCampaigns.create, and the toll-free verification
// request create/retrieve are FLAT in the shape the provider reads — this
// client unwraps `.data` for those. messagingProfiles.create,
// availablePhoneNumbers.list, and numberOrders.create stay WRAPPED (the
// provider reads `.data.*` itself) — this client returns the envelope as-is.

import type { TelnyxComplianceClient } from './providers/telnyx-compliance';

const BASE = 'https://api.telnyx.com/v2';

interface TelnyxFetchResult { status: number; json: unknown }

async function telnyxFetch(apiKey: string, method: string, path: string, body?: unknown): Promise<TelnyxFetchResult> {
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
    }
    const res = await fetch(`${BASE}${path}`, init);
    let json: unknown = null;
    try { json = await res.json(); } catch { /* empty/non-JSON body */ }
    return { status: res.status, json };
}

/** Surface Telnyx's error detail on a non-2xx (mirrors telnyx.ts's send-path error mapping). */
function throwIfError(r: TelnyxFetchResult): void {
    if (r.status < 200 || r.status >= 300) {
        const detail = (r.json as { errors?: Array<{ detail?: string }> } | null)?.errors?.[0]?.detail;
        throw new Error(detail ?? `Telnyx ${r.status}`);
    }
}

/** Unwrap `{ data: {...} }` into the flat shape the provider reads. */
function unwrap<T>(r: TelnyxFetchResult): T {
    throwIfError(r);
    const body = r.json as { data?: unknown } | null;
    return (body?.data ?? body ?? {}) as T;
}

/** Keep the `{ data: ... }` envelope intact (the provider reads `.data.*` itself). */
function wrapped<T>(r: TelnyxFetchResult): T {
    throwIfError(r);
    return (r.json ?? {}) as T;
}

/**
 * Serialize a Telnyx `filter` object into bracket-notation query params:
 * `filter[key]=value` for scalars, `filter[key][]=item` repeated per array
 * element (matches Telnyx's documented list-filter query convention).
 */
function filterQuery(filter: Record<string, unknown>): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filter)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) {
            for (const item of v) params.append(`filter[${k}][]`, String(item));
        } else {
            params.append(`filter[${k}]`, String(v));
        }
    }
    return params.toString();
}

/** Build a TelnyxComplianceClient bound to the given managed-ISV API key. */
export function createTelnyxRestClient(apiKey: string): TelnyxComplianceClient {
    return {
        messaging10dlc: {
            brand: {
                async create(body) {
                    return unwrap(await telnyxFetch(apiKey, 'POST', '/10dlc/brand', body));
                },
                externalVetting: {
                    async order(brandID, body) {
                        return unwrap(await telnyxFetch(apiKey, 'POST', `/10dlc/brand/${brandID}/externalVetting`, body));
                    },
                },
                async retrieve(brandID) {
                    return unwrap(await telnyxFetch(apiKey, 'GET', `/10dlc/brand/${brandID}`));
                },
            },
            campaign: {
                async retrieve(campaignID) {
                    return unwrap(await telnyxFetch(apiKey, 'GET', `/10dlc/campaign/${campaignID}`));
                },
            },
            campaignBuilder: {
                async submit(body) {
                    return unwrap(await telnyxFetch(apiKey, 'POST', '/10dlc/campaignBuilder', body));
                },
            },
            phoneNumberCampaigns: {
                async create(body) {
                    return unwrap(await telnyxFetch(apiKey, 'POST', '/10dlc/phoneNumberCampaigns', body));
                },
            },
        },

        messagingProfiles: {
            async create(body) {
                return wrapped(await telnyxFetch(apiKey, 'POST', '/messaging_profiles', body));
            },
        },

        availablePhoneNumbers: {
            async list(query) {
                const qs = filterQuery(query.filter);
                return wrapped(await telnyxFetch(apiKey, 'GET', `/available_phone_numbers?${qs}`));
            },
        },

        numberOrders: {
            async create(body) {
                return wrapped(await telnyxFetch(apiKey, 'POST', '/number_orders', body));
            },
        },

        messagingTollfree: {
            verification: {
                requests: {
                    async create(body) {
                        return unwrap(await telnyxFetch(apiKey, 'POST', '/messaging_tollfree/verification/requests', body));
                    },
                    async retrieve(id) {
                        return unwrap(await telnyxFetch(apiKey, 'GET', `/messaging_tollfree/verification/requests/${id}`));
                    },
                },
            },
        },
    };
}
