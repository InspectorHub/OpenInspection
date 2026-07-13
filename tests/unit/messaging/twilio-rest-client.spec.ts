// tests/unit/messaging/twilio-rest-client.spec.ts
//
// Per-operation contract tests for the fetch-based Twilio REST client that
// replaces the twilio-node SDK behind TwilioComplianceClient. Mocks global
// fetch and asserts exact METHOD, URL, auth header, and body encoding for
// every operation the compliance provider drives, plus response parsing and
// a non-2xx error path.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTwilioRestClient } from '../../../server/lib/messaging/twilio-rest-client';

const CREDS = { accountSid: 'ACmain', apiKeySid: 'SKkey', apiKeySecret: 'secret123' };
const BASIC_AUTH = `Basic ${btoa('SKkey:secret123')}`;

function mockFetchOnce(status: number, body: unknown, headers?: Record<string, string>) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

describe('createTwilioRestClient — generic request()', () => {
    afterEach(() => vi.restoreAllMocks());

    it('POSTs to an absolute URI with Basic auth + form-encoded body, and does NOT throw on non-2xx', async () => {
        const fetchMock = mockFetchOnce(400, { message: 'bad request' });
        const client = createTwilioRestClient(CREDS);
        const resp = await client.request({
            method: 'post',
            uri: 'https://trusthub.twilio.com/v1/CustomerProfiles',
            data: { FriendlyName: 'Acme', Email: 'a@b.com' },
        });
        expect(resp).toEqual({ statusCode: 400, body: { message: 'bad request' } });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://trusthub.twilio.com/v1/CustomerProfiles');
        expect(String(init.method).toUpperCase()).toBe('POST');
        expect((init.headers as Record<string, string>).Authorization).toBe(BASIC_AUTH);
        expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
        expect(init.body).toBe('FriendlyName=Acme&Email=a%40b.com');
    });

    it('passes through a 2xx body unchanged', async () => {
        mockFetchOnce(201, { sid: 'BUx', status: 'PENDING' });
        const client = createTwilioRestClient(CREDS);
        const resp = await client.request({
            method: 'post',
            uri: 'https://messaging.twilio.com/v1/Tollfree/Verifications',
            data: { TollfreePhoneNumberSid: 'PN1' },
        });
        expect(resp).toEqual({ statusCode: 201, body: { sid: 'BUx', status: 'PENDING' } });
    });
});

describe('createTwilioRestClient — messaging.v1.brandRegistrations', () => {
    afterEach(() => vi.restoreAllMocks());

    it('create() POSTs to /v1/a2p/BrandRegistrations with mapped form fields and returns sid+status', async () => {
        const fetchMock = mockFetchOnce(201, { sid: 'BNx', status: 'PENDING' });
        const client = createTwilioRestClient(CREDS);
        const out = await client.messaging.v1.brandRegistrations.create({
            customerProfileBundleSid: 'BUx',
            a2PProfileBundleSid: 'BUy',
            brandType: 'SOLE_PROPRIETOR',
        });
        expect(out).toEqual({ sid: 'BNx', status: 'PENDING' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://messaging.twilio.com/v1/a2p/BrandRegistrations');
        expect(String(init.method).toUpperCase()).toBe('POST');
        expect((init.headers as Record<string, string>).Authorization).toBe(BASIC_AUTH);
        expect(init.body).toContain('CustomerProfileBundleSid=BUx');
        expect(init.body).toContain('A2PProfileBundleSid=BUy');
        expect(init.body).toContain('BrandType=SOLE_PROPRIETOR');
    });

    it('create() throws with the Twilio error message on a non-2xx response', async () => {
        mockFetchOnce(400, { message: 'Bundle not approved' });
        const client = createTwilioRestClient(CREDS);
        await expect(
            client.messaging.v1.brandRegistrations.create({
                customerProfileBundleSid: 'BUx', a2PProfileBundleSid: 'BUy', brandType: 'SOLE_PROPRIETOR',
            }),
        ).rejects.toThrow('Bundle not approved');
    });

    it('list() GETs /v1/a2p/BrandRegistrations and maps the data array to sid+status', async () => {
        const fetchMock = mockFetchOnce(200, { data: [{ sid: 'BN1', status: 'APPROVED' }] });
        const client = createTwilioRestClient(CREDS);
        const out = await client.messaging.v1.brandRegistrations.list();
        expect(out).toEqual([{ sid: 'BN1', status: 'APPROVED' }]);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://messaging.twilio.com/v1/a2p/BrandRegistrations');
        expect(String(init.method).toUpperCase()).toBe('GET');
    });
});

describe('createTwilioRestClient — messaging.v1.services', () => {
    afterEach(() => vi.restoreAllMocks());

    it('create() POSTs to /v1/Services with FriendlyName and returns sid', async () => {
        const fetchMock = mockFetchOnce(201, { sid: 'MGx' });
        const client = createTwilioRestClient(CREDS);
        const out = await client.messaging.v1.services.create({ friendlyName: 'Acme Inspections' });
        expect(out).toEqual({ sid: 'MGx' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://messaging.twilio.com/v1/Services');
        expect(init.body).toContain('FriendlyName=Acme+Inspections');
    });

    it('create() throws on non-2xx', async () => {
        mockFetchOnce(400, { message: 'FriendlyName is required' });
        const client = createTwilioRestClient(CREDS);
        await expect(client.messaging.v1.services.create({ friendlyName: '' })).rejects.toThrow('FriendlyName is required');
    });

    it('(sid).phoneNumbers.create() POSTs PhoneNumberSid to /v1/Services/{sid}/PhoneNumbers', async () => {
        const fetchMock = mockFetchOnce(201, { sid: 'ASx' });
        const client = createTwilioRestClient(CREDS);
        const out = await client.messaging.v1.services('MG3').phoneNumbers.create({ phoneNumberSid: 'PN5' });
        expect(out).toEqual({ sid: 'ASx' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://messaging.twilio.com/v1/Services/MG3/PhoneNumbers');
        expect(init.body).toContain('PhoneNumberSid=PN5');
    });

    it('(sid).phoneNumbers.create() throws on non-2xx', async () => {
        mockFetchOnce(404, { message: 'Phone number not found' });
        const client = createTwilioRestClient(CREDS);
        await expect(
            client.messaging.v1.services('MG3').phoneNumbers.create({ phoneNumberSid: 'PN_BAD' }),
        ).rejects.toThrow('Phone number not found');
    });
});

describe('createTwilioRestClient — messaging.v1.tollfreeVerifications', () => {
    afterEach(() => vi.restoreAllMocks());

    it('list() GETs /v1/Tollfree/Verifications and maps the verifications array', async () => {
        const fetchMock = mockFetchOnce(200, { verifications: [{ sid: 'HH1', status: 'TWILIO_APPROVED' }] });
        const client = createTwilioRestClient(CREDS);
        const out = await client.messaging.v1.tollfreeVerifications.list();
        expect(out).toEqual([{ sid: 'HH1', status: 'TWILIO_APPROVED' }]);
        const [url] = fetchMock.mock.calls[0];
        expect(url).toBe('https://messaging.twilio.com/v1/Tollfree/Verifications');
    });
});

describe('createTwilioRestClient — availablePhoneNumbers', () => {
    afterEach(() => vi.restoreAllMocks());

    it('local.list() GETs AvailablePhoneNumbers/{country}/Local.json with AreaCode', async () => {
        const fetchMock = mockFetchOnce(200, { available_phone_numbers: [{ phone_number: '+15125550001' }] });
        const client = createTwilioRestClient(CREDS);
        const out = await client.availablePhoneNumbers('US').local.list({ areaCode: '512' });
        expect(out).toEqual([{ phoneNumber: '+15125550001' }]);
        const [url] = fetchMock.mock.calls[0];
        expect(url).toContain('api.twilio.com/2010-04-01/Accounts/ACmain/AvailablePhoneNumbers/US/Local.json');
        expect(url).toContain('AreaCode=512');
    });

    it('tollFree.list() GETs AvailablePhoneNumbers/{country}/TollFree.json', async () => {
        const fetchMock = mockFetchOnce(200, { available_phone_numbers: [{ phone_number: '+18005550001' }] });
        const client = createTwilioRestClient(CREDS);
        const out = await client.availablePhoneNumbers('US').tollFree.list();
        expect(out).toEqual([{ phoneNumber: '+18005550001' }]);
        const [url] = fetchMock.mock.calls[0];
        expect(url).toContain('AvailablePhoneNumbers/US/TollFree.json');
        expect(url).not.toContain('AreaCode');
    });
});

describe('createTwilioRestClient — incomingPhoneNumbers', () => {
    afterEach(() => vi.restoreAllMocks());

    it('create() POSTs PhoneNumber to IncomingPhoneNumbers.json and returns sid+phoneNumber', async () => {
        const fetchMock = mockFetchOnce(201, { sid: 'PN9', phone_number: '+18005550001' });
        const client = createTwilioRestClient(CREDS);
        const out = await client.incomingPhoneNumbers.create({ phoneNumber: '+18005550001' });
        expect(out).toEqual({ sid: 'PN9', phoneNumber: '+18005550001' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACmain/IncomingPhoneNumbers.json');
        expect(init.body).toContain('PhoneNumber=%2B18005550001');
    });

    it('create() throws on non-2xx', async () => {
        mockFetchOnce(400, { message: 'Phone number unavailable' });
        const client = createTwilioRestClient(CREDS);
        await expect(client.incomingPhoneNumbers.create({ phoneNumber: '+18005550001' })).rejects.toThrow('Phone number unavailable');
    });
});
