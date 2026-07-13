// tests/unit/messaging/telnyx-rest-client.spec.ts
//
// Per-operation contract tests for the fetch-based Telnyx REST client that
// replaces the `telnyx` SDK behind TelnyxComplianceClient. Mocks global fetch
// and asserts exact METHOD, URL, auth header, and JSON body for every
// operation the compliance provider drives, plus response (un)wrapping and a
// non-2xx error path.
//
// Telnyx wraps most v2 responses in `{ data: {...} }`. Per the pinned SDK
// shapes documented in telnyx-compliance.ts, brand/campaign/phoneNumberCampaigns/
// tollfree-verification-request responses are FLAT (the client unwraps
// `.data`), while messagingProfiles.create / availablePhoneNumbers.list /
// numberOrders.create stay WRAPPED (the client returns the envelope as-is).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTelnyxRestClient } from '../../../server/lib/messaging/telnyx-rest-client';

const API_KEY = 'KEY0123456789';
const BEARER = `Bearer ${API_KEY}`;

function mockFetchOnce(status: number, body: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

describe('createTelnyxRestClient — messaging10dlc.brand', () => {
    afterEach(() => vi.restoreAllMocks());

    it('create() POSTs JSON to /v2/10dlc/brand with Bearer auth and unwraps .data (flat)', async () => {
        const fetchMock = mockFetchOnce(201, { data: { brandId: 'BR1', identityStatus: 'UNVERIFIED' } });
        const client = createTelnyxRestClient(API_KEY);
        const out = await client.messaging10dlc.brand.create({ country: 'US', displayName: 'Acme' });
        expect(out).toEqual({ brandId: 'BR1', identityStatus: 'UNVERIFIED' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.telnyx.com/v2/10dlc/brand');
        expect(String(init.method).toUpperCase()).toBe('POST');
        expect((init.headers as Record<string, string>).Authorization).toBe(BEARER);
        expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
        expect(JSON.parse(init.body as string)).toEqual({ country: 'US', displayName: 'Acme' });
    });

    it('create() throws with the Telnyx error detail on a non-2xx response', async () => {
        mockFetchOnce(422, { errors: [{ detail: 'Missing EIN' }] });
        const client = createTelnyxRestClient(API_KEY);
        await expect(client.messaging10dlc.brand.create({ country: 'US' })).rejects.toThrow('Missing EIN');
    });

    it('retrieve() GETs /v2/10dlc/brand/{id} and unwraps .data', async () => {
        const fetchMock = mockFetchOnce(200, { data: { brandId: 'BR1', identityStatus: 'VERIFIED', failureReasons: null } });
        const client = createTelnyxRestClient(API_KEY);
        const out = await client.messaging10dlc.brand.retrieve('BR1');
        expect(out).toEqual({ brandId: 'BR1', identityStatus: 'VERIFIED', failureReasons: null });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.telnyx.com/v2/10dlc/brand/BR1');
        expect(String(init.method).toUpperCase()).toBe('GET');
    });

    it('externalVetting.order() POSTs to /v2/10dlc/brand/{id}/externalVetting and unwraps .data', async () => {
        const fetchMock = mockFetchOnce(201, { data: { vettingId: 'VET1' } });
        const client = createTelnyxRestClient(API_KEY);
        const out = await client.messaging10dlc.brand.externalVetting.order('BR1', { evpId: 'AEGIS', vettingClass: 'STANDARD' });
        expect(out).toEqual({ vettingId: 'VET1' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.telnyx.com/v2/10dlc/brand/BR1/externalVetting');
        expect(JSON.parse(init.body as string)).toEqual({ evpId: 'AEGIS', vettingClass: 'STANDARD' });
    });
});

describe('createTelnyxRestClient — messaging10dlc.campaign / campaignBuilder', () => {
    afterEach(() => vi.restoreAllMocks());

    it('campaignBuilder.submit() POSTs to /v2/10dlc/campaignBuilder and unwraps .data', async () => {
        const fetchMock = mockFetchOnce(201, { data: { campaignId: 'CAMP1', campaignStatus: 'TCR_PENDING' } });
        const client = createTelnyxRestClient(API_KEY);
        const out = await client.messaging10dlc.campaignBuilder.submit({ brandId: 'BR1', usecase: 'AGENTS_FRANCHISES' });
        expect(out).toEqual({ campaignId: 'CAMP1', campaignStatus: 'TCR_PENDING' });
        const [url] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.telnyx.com/v2/10dlc/campaignBuilder');
    });

    it('campaignBuilder.submit() throws on non-2xx', async () => {
        mockFetchOnce(400, { errors: [{ detail: 'Brand not approved' }] });
        const client = createTelnyxRestClient(API_KEY);
        await expect(client.messaging10dlc.campaignBuilder.submit({ brandId: 'BR_BAD' })).rejects.toThrow('Brand not approved');
    });

    it('campaign.retrieve() GETs /v2/10dlc/campaign/{id} and unwraps .data', async () => {
        const fetchMock = mockFetchOnce(200, { data: { campaignId: 'CAMP1', campaignStatus: 'MNO_PROVISIONED', failureReasons: null } });
        const client = createTelnyxRestClient(API_KEY);
        const out = await client.messaging10dlc.campaign.retrieve('CAMP1');
        expect(out).toEqual({ campaignId: 'CAMP1', campaignStatus: 'MNO_PROVISIONED', failureReasons: null });
        const [url] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.telnyx.com/v2/10dlc/campaign/CAMP1');
    });
});

describe('createTelnyxRestClient — messaging10dlc.phoneNumberCampaigns', () => {
    afterEach(() => vi.restoreAllMocks());

    it('create() POSTs to /v2/10dlc/phoneNumberCampaigns and unwraps .data', async () => {
        const fetchMock = mockFetchOnce(201, { data: { phoneNumber: '+15551110000', assignmentStatus: 'PENDING_ASSIGNMENT' } });
        const client = createTelnyxRestClient(API_KEY);
        const out = await client.messaging10dlc.phoneNumberCampaigns.create({ campaignId: 'CAMP1', phoneNumber: '+15551110000' });
        expect(out).toEqual({ phoneNumber: '+15551110000', assignmentStatus: 'PENDING_ASSIGNMENT' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.telnyx.com/v2/10dlc/phoneNumberCampaigns');
        expect(JSON.parse(init.body as string)).toEqual({ campaignId: 'CAMP1', phoneNumber: '+15551110000' });
    });

    it('create() throws on non-2xx', async () => {
        mockFetchOnce(400, { errors: [{ detail: 'assign failed' }] });
        const client = createTelnyxRestClient(API_KEY);
        await expect(
            client.messaging10dlc.phoneNumberCampaigns.create({ campaignId: 'CAMP1', phoneNumber: '+1' }),
        ).rejects.toThrow('assign failed');
    });
});

describe('createTelnyxRestClient — messagingProfiles (data-wrapped)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('create() POSTs to /v2/messaging_profiles and returns the envelope with .data intact', async () => {
        const fetchMock = mockFetchOnce(201, { data: { id: 'MP1' } });
        const client = createTelnyxRestClient(API_KEY);
        const out = await client.messagingProfiles.create({ name: 'Acme', whitelisted_destinations: ['US'] });
        expect(out).toEqual({ data: { id: 'MP1' } });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.telnyx.com/v2/messaging_profiles');
        expect(JSON.parse(init.body as string)).toEqual({ name: 'Acme', whitelisted_destinations: ['US'] });
    });
});

describe('createTelnyxRestClient — availablePhoneNumbers (data-wrapped, bracket filter query)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('list() GETs /v2/available_phone_numbers with bracket-notation filter params', async () => {
        const fetchMock = mockFetchOnce(200, { data: [{ phone_number: '+15551110000' }] });
        const client = createTelnyxRestClient(API_KEY);
        const out = await client.availablePhoneNumbers.list({
            filter: { country_code: 'US', features: ['SMS'], limit: 1, national_destination_code: '512' },
        });
        expect(out).toEqual({ data: [{ phone_number: '+15551110000' }] });
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(init.method).toUpperCase()).toBe('GET');
        expect(url).toContain('https://api.telnyx.com/v2/available_phone_numbers?');
        expect(url).toContain('filter%5Bcountry_code%5D=US');
        expect(url).toContain('filter%5Bfeatures%5D%5B%5D=SMS');
        expect(url).toContain('filter%5Blimit%5D=1');
        expect(url).toContain('filter%5Bnational_destination_code%5D=512');
    });

    it('list() omits keys that are not provided in the filter', async () => {
        const fetchMock = mockFetchOnce(200, { data: [] });
        const client = createTelnyxRestClient(API_KEY);
        await client.availablePhoneNumbers.list({ filter: { country_code: 'US', phone_number_type: 'toll_free', features: ['SMS'], limit: 1 } });
        const [url] = fetchMock.mock.calls[0];
        expect(url).not.toContain('national_destination_code');
        expect(url).toContain('filter%5Bphone_number_type%5D=toll_free');
    });
});

describe('createTelnyxRestClient — numberOrders (data-wrapped)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('create() POSTs to /v2/number_orders and returns the envelope with .data intact', async () => {
        const fetchMock = mockFetchOnce(201, {
            data: { id: 'ORD1', phone_numbers: [{ id: 'PNUM1', phone_number: '+15551110000' }] },
        });
        const client = createTelnyxRestClient(API_KEY);
        const out = await client.numberOrders.create({
            phone_numbers: [{ phone_number: '+15551110000' }],
            messaging_profile_id: 'MP1',
        });
        expect(out).toEqual({ data: { id: 'ORD1', phone_numbers: [{ id: 'PNUM1', phone_number: '+15551110000' }] } });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.telnyx.com/v2/number_orders');
        expect(JSON.parse(init.body as string)).toEqual({
            phone_numbers: [{ phone_number: '+15551110000' }],
            messaging_profile_id: 'MP1',
        });
    });

    it('create() throws on non-2xx', async () => {
        mockFetchOnce(400, { errors: [{ detail: 'No inventory' }] });
        const client = createTelnyxRestClient(API_KEY);
        await expect(client.numberOrders.create({ phone_numbers: [{ phone_number: '+1' }] })).rejects.toThrow('No inventory');
    });
});

describe('createTelnyxRestClient — messagingTollfree.verification.requests (flat)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('create() POSTs to /v2/messaging_tollfree/verification/requests and unwraps .data', async () => {
        const fetchMock = mockFetchOnce(201, {
            data: { id: 'TFV_DB_ID', verificationRequestId: 'TFV_REQ1', verificationStatus: 'In Progress' },
        });
        const client = createTelnyxRestClient(API_KEY);
        const out = await client.messagingTollfree.verification.requests.create({ businessName: 'Acme' });
        expect(out).toEqual({ id: 'TFV_DB_ID', verificationRequestId: 'TFV_REQ1', verificationStatus: 'In Progress' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.telnyx.com/v2/messaging_tollfree/verification/requests');
        expect(String(init.method).toUpperCase()).toBe('POST');
    });

    it('create() throws on non-2xx', async () => {
        mockFetchOnce(422, { errors: [{ detail: 'Invalid phone number' }] });
        const client = createTelnyxRestClient(API_KEY);
        await expect(client.messagingTollfree.verification.requests.create({ businessName: 'x' })).rejects.toThrow('Invalid phone number');
    });

    it('retrieve() GETs /v2/messaging_tollfree/verification/requests/{id} and unwraps .data', async () => {
        const fetchMock = mockFetchOnce(200, { data: { id: 'TFV_DB_ID', verificationStatus: 'Verified', reason: null } });
        const client = createTelnyxRestClient(API_KEY);
        const out = await client.messagingTollfree.verification.requests.retrieve('TFV_DB_ID');
        expect(out).toEqual({ id: 'TFV_DB_ID', verificationStatus: 'Verified', reason: null });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.telnyx.com/v2/messaging_tollfree/verification/requests/TFV_DB_ID');
        expect(String(init.method).toUpperCase()).toBe('GET');
    });
});

describe('createTelnyxRestClient — error path without a JSON error body', () => {
    afterEach(() => vi.restoreAllMocks());

    it('falls back to a generic "Telnyx {status}" message when the error body has no detail', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
        const client = createTelnyxRestClient(API_KEY);
        await expect(client.messaging10dlc.brand.create({ country: 'US' })).rejects.toThrow('Telnyx 500');
    });
});
