import { describe, it, expect, vi, afterEach } from 'vitest';
import { TwilioClient } from '../../server/lib/messaging/twilio';

describe('TwilioClient.messages.create', () => {
    afterEach(() => vi.restoreAllMocks());

    it('POSTs to the Account Messages endpoint with basic auth + form body', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sid: 'SM1' }), { status: 201 }));
        vi.stubGlobal('fetch', fetchMock);
        const client = new TwilioClient({ sid: 'AC123', token: 'tok' });

        const res = await client.messages.create({ from: '+15550000000', to: '+15551112222', body: 'hi' });

        // The provider message id (Twilio `sid`) is surfaced for delivery-status correlation (#wh2).
        expect(res).toEqual({ ok: true, id: 'SM1' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
        expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('AC123:tok')}`);
        expect(init.body).toContain('To=%2B15551112222');
        expect(init.body).toContain('From=%2B15550000000');
    });

    it('passes MessagingServiceSid instead of From when given', async () => {
        const fetchMock = vi.fn(async () => new Response('{}', { status: 201 }));
        vi.stubGlobal('fetch', fetchMock);
        await new TwilioClient({ sid: 'AC1', token: 't' }).messages.create({ from: '+1', to: '+15551112222', body: 'x', messagingServiceSid: 'MG9' });
        expect((fetchMock.mock.calls[0][1].body as string)).toContain('MessagingServiceSid=MG9');
    });

    it('uses API-key SID for Basic auth but accountSid in the path (managed-pool path)', async () => {
        // When authSid is supplied the Basic-auth USERNAME is the API Key SID, not the
        // Account SID. The REST path must still use the Account SID (ACmain).
        const fetchMock = vi.fn(async () => new Response('{}', { status: 201 }));
        vi.stubGlobal('fetch', fetchMock);
        await new TwilioClient({ sid: 'ACmain', authSid: 'SKkey', token: 'sec' })
            .messages.create({ from: '', to: '+15551112222', body: 'x', messagingServiceSid: 'MG1' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACmain/Messages.json');
        expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('SKkey:sec')}`);
    });

    it('without authSid, sid is the Basic-auth username (own/platform behavior unchanged)', async () => {
        // Regression: existing own/platform callers that omit authSid must behave exactly
        // as before — Account SID as username, auth token as password.
        const fetchMock = vi.fn(async () => new Response('{}', { status: 201 }));
        vi.stubGlobal('fetch', fetchMock);
        await new TwilioClient({ sid: 'ACmain', token: 'tok' })
            .messages.create({ from: '+1', to: '+15551112222', body: 'x' });
        const [, init] = fetchMock.mock.calls[0];
        expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('ACmain:tok')}`);
    });
});

describe('TwilioClient.tollfree', () => {
    afterEach(() => vi.restoreAllMocks());

    it('tollfree.list returns verifications from the messaging API', async () => {
        const body = JSON.stringify({ verifications: [{ sid: 'HH1', status: 'TWILIO_APPROVED', tollfree_phone_number_sid: 'PN1' }] });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
        const out = await new TwilioClient({ sid: 'AC1', token: 't' }).tollfree.list();
        expect(out[0]).toMatchObject({ sid: 'HH1', status: 'TWILIO_APPROVED' });
    });

    it('tollfree.create POSTs to Tollfree/Verifications and returns sid+status', async () => {
        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify({ sid: 'HV1', status: 'PENDING_REVIEW' }), { status: 201 }),
        );
        vi.stubGlobal('fetch', fetchMock);
        const r = await new TwilioClient({ sid: 'AC1', token: 't' }).tollfree.create({
            tollfreePhoneNumberSid: 'PN1',
            useCaseDescription: 'Inspection notifications',
            messagingServiceSid: 'MG1',
            notificationEmail: 'ops@example.com',
            useCaseSummary: 'Sending inspection reports',
            productionMessageSample: 'Your report is ready',
            optInType: 'VERBAL',
        });
        expect(r).toMatchObject({ sid: 'HV1', status: 'PENDING_REVIEW' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('messaging.twilio.com/v1/Tollfree/Verifications');
        expect(init.method).toBe('POST');
        expect(init.body).toContain('TollfreePhoneNumberSid=PN1');
    });

    it('tollfree.create throws with Twilio error message on non-ok response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () =>
            new Response(JSON.stringify({ message: 'Invalid phone number' }), { status: 400 }),
        ));
        await expect(
            new TwilioClient({ sid: 'AC1', token: 't' }).tollfree.create({
                tollfreePhoneNumberSid: 'PN_BAD',
                useCaseDescription: 'x',
                messagingServiceSid: 'MG1',
                notificationEmail: 'a@b.com',
                useCaseSummary: 'x',
                productionMessageSample: 'x',
                optInType: 'VERBAL',
            }),
        ).rejects.toThrow('Invalid phone number');
    });
});

describe('TwilioClient.trusthub', () => {
    afterEach(() => vi.restoreAllMocks());

    it('trusthub.createSecondaryProfile POSTs to trusthub CustomerProfiles and returns sid+status', async () => {
        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify({ sid: 'BU1', status: 'draft' }), { status: 201 }),
        );
        vi.stubGlobal('fetch', fetchMock);
        const r = await new TwilioClient({ sid: 'AC1', token: 't' }).trusthub.createSecondaryProfile({
            friendlyName: 'My Company Profile',
            email: 'compliance@example.com',
            isvRegisteringForSelfOrSubaccounts: 'true',
        });
        expect(r).toMatchObject({ sid: 'BU1', status: 'draft' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('trusthub.twilio.com/v1/CustomerProfiles');
        expect(init.method).toBe('POST');
        expect(init.body).toContain('FriendlyName=My+Company+Profile');
    });

    it('trusthub.createSecondaryProfile throws on non-ok response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () =>
            new Response(JSON.stringify({ message: 'Missing required field' }), { status: 422 }),
        ));
        await expect(
            new TwilioClient({ sid: 'AC1', token: 't' }).trusthub.createSecondaryProfile({
                friendlyName: 'x',
                email: 'x@x.com',
                isvRegisteringForSelfOrSubaccounts: 'false',
            }),
        ).rejects.toThrow('Missing required field');
    });
});

describe('TwilioClient.brands', () => {
    afterEach(() => vi.restoreAllMocks());

    it('brands.list GETs BrandRegistrations from messaging API', async () => {
        const body = JSON.stringify({ data: [{ sid: 'BN1', status: 'APPROVED' }] });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
        const out = await new TwilioClient({ sid: 'AC1', token: 't' }).brands.list();
        expect(out[0]).toMatchObject({ sid: 'BN1', status: 'APPROVED' });
    });

    it('brands.createSoleProprietor POSTs to a2p/BrandRegistrations and returns sid+status', async () => {
        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify({ sid: 'BNx', status: 'PENDING' }), { status: 201 }),
        );
        vi.stubGlobal('fetch', fetchMock);
        const r = await new TwilioClient({ sid: 'AC', authSid: 'SK', token: 's' })
            .brands.createSoleProprietor({
                customerProfileBundleSid: 'BUx',
                a2pProfileBundleSid: 'BUy',
                brandType: 'SOLE_PROPRIETOR',
            });
        expect(r).toMatchObject({ sid: 'BNx', status: 'PENDING' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('/v1/a2p/BrandRegistrations');
        expect(init.method).toBe('POST');
        expect(init.body).toContain('CustomerProfileBundleSid=BUx');
        expect(init.body).toContain('BrandType=SOLE_PROPRIETOR');
    });

    it('brands.createSoleProprietor throws on non-ok response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () =>
            new Response(JSON.stringify({ message: 'Bundle not approved' }), { status: 400 }),
        ));
        await expect(
            new TwilioClient({ sid: 'AC', token: 's' }).brands.createSoleProprietor({
                customerProfileBundleSid: 'BUx',
                a2pProfileBundleSid: 'BUy',
                brandType: 'SOLE_PROPRIETOR',
            }),
        ).rejects.toThrow('Bundle not approved');
    });
});

describe('TwilioClient.campaigns', () => {
    afterEach(() => vi.restoreAllMocks());

    it('campaigns.create POSTs to Services/{msSid}/Compliance/Usa2p and returns sid+status', async () => {
        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify({ sid: 'QE1', status: 'PENDING' }), { status: 201 }),
        );
        vi.stubGlobal('fetch', fetchMock);
        const r = await new TwilioClient({ sid: 'AC1', token: 't' }).campaigns.create({
            messagingServiceSid: 'MG1',
            brandRegistrationSid: 'BN1',
            description: 'Inspection notifications',
            messageFlow: 'Customers opt in at booking',
            messageSamples: ['Your inspection report is ready', 'Appointment confirmed for tomorrow'],
            usAppToPersonUsecase: 'NOTIFICATIONS',
            hasEmbeddedLinks: false,
            hasEmbeddedPhone: false,
        });
        expect(r).toMatchObject({ sid: 'QE1', status: 'PENDING' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('messaging.twilio.com/v1/Services/MG1/Compliance/Usa2p');
        expect(init.method).toBe('POST');
        expect(init.body).toContain('BrandRegistrationSid=BN1');
    });

    it('campaigns.create throws on non-ok response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () =>
            new Response(JSON.stringify({ message: 'Brand not approved' }), { status: 400 }),
        ));
        await expect(
            new TwilioClient({ sid: 'AC1', token: 't' }).campaigns.create({
                messagingServiceSid: 'MG1',
                brandRegistrationSid: 'BN_BAD',
                description: 'x',
                messageFlow: 'x',
                messageSamples: ['x'],
                usAppToPersonUsecase: 'NOTIFICATIONS',
                hasEmbeddedLinks: false,
                hasEmbeddedPhone: false,
            }),
        ).rejects.toThrow('Brand not approved');
    });
});

describe('TwilioClient.messagingServices', () => {
    afterEach(() => vi.restoreAllMocks());

    it('messagingServices.create POSTs to /v1/Services and returns sid', async () => {
        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify({ sid: 'MG2', friendly_name: 'Test Service' }), { status: 201 }),
        );
        vi.stubGlobal('fetch', fetchMock);
        const r = await new TwilioClient({ sid: 'AC1', token: 't' }).messagingServices.create({
            friendlyName: 'Test Service',
        });
        expect(r).toMatchObject({ sid: 'MG2' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('messaging.twilio.com/v1/Services');
        expect(init.method).toBe('POST');
        expect(init.body).toContain('FriendlyName=Test+Service');
    });

    it('messagingServices.create throws on non-ok response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () =>
            new Response(JSON.stringify({ message: 'FriendlyName is required' }), { status: 400 }),
        ));
        await expect(
            new TwilioClient({ sid: 'AC1', token: 't' }).messagingServices.create({ friendlyName: '' }),
        ).rejects.toThrow('FriendlyName is required');
    });

    it('messagingServices.attachSender POSTs PhoneNumberSid to Service PhoneNumbers', async () => {
        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify({ sid: 'PN2' }), { status: 201 }),
        );
        vi.stubGlobal('fetch', fetchMock);
        const r = await new TwilioClient({ sid: 'AC1', token: 't' })
            .messagingServices.attachSender('MG3', 'PN5');
        expect(r).toMatchObject({ sid: 'PN2' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('messaging.twilio.com/v1/Services/MG3/PhoneNumbers');
        expect(init.method).toBe('POST');
        expect(init.body).toContain('PhoneNumberSid=PN5');
    });

    it('messagingServices.attachSender throws on non-ok response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () =>
            new Response(JSON.stringify({ message: 'Phone number not found' }), { status: 404 }),
        ));
        await expect(
            new TwilioClient({ sid: 'AC1', token: 't' }).messagingServices.attachSender('MG3', 'PN_BAD'),
        ).rejects.toThrow('Phone number not found');
    });

    it('messagingServices.attachCompliance with tfvSid POSTs to the tollfree verification', async () => {
        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify({ sid: 'HV1' }), { status: 200 }),
        );
        vi.stubGlobal('fetch', fetchMock);
        const r = await new TwilioClient({ sid: 'AC1', token: 't' })
            .messagingServices.attachCompliance('MG3', { tfvSid: 'HV1' });
        expect(r).toMatchObject({});
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('messaging.twilio.com/v1/Tollfree/Verifications/HV1');
        expect(init.method).toBe('POST');
        expect(init.body).toContain('MessagingServiceSid=MG3');
    });

    it('messagingServices.attachCompliance with tfvSid throws on a non-ok response', async () => {
        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify({ message: 'bad tfv' }), { status: 400 }),
        );
        vi.stubGlobal('fetch', fetchMock);
        await expect(
            new TwilioClient({ sid: 'AC1', token: 't' })
                .messagingServices.attachCompliance('MG3', { tfvSid: 'HV1' }),
        ).rejects.toThrow('bad tfv');
    });

    it('messagingServices.attachCompliance with campaignSid is a no-op (campaign already linked)', async () => {
        // For 10DLC, the campaign is created under the messaging service in campaigns.create.
        // attachCompliance with campaignSid returns {} without a network call.
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const r = await new TwilioClient({ sid: 'AC1', token: 't' })
            .messagingServices.attachCompliance('MG3', { campaignSid: 'QE1' });
        expect(r).toMatchObject({});
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('TwilioClient.numbers', () => {
    afterEach(() => vi.restoreAllMocks());

    it("numbers.search('tollfree') GETs TollFree available numbers and maps to phoneNumber array", async () => {
        const body = JSON.stringify({
            available_phone_numbers: [
                { phone_number: '+18005550001' },
                { phone_number: '+18005550002' },
            ],
        });
        const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const r = await new TwilioClient({ sid: 'AC1', token: 't' }).numbers.search('tollfree');
        expect(r).toEqual([{ phoneNumber: '+18005550001' }, { phoneNumber: '+18005550002' }]);
        const [url] = fetchMock.mock.calls[0];
        expect(url).toContain('api.twilio.com/2010-04-01/Accounts/AC1/AvailablePhoneNumbers/US/TollFree.json');
        expect(url).not.toContain('Local');
    });

    it("numbers.search('local') GETs Local available numbers", async () => {
        const body = JSON.stringify({ available_phone_numbers: [{ phone_number: '+15125550001' }] });
        const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const r = await new TwilioClient({ sid: 'AC1', token: 't' }).numbers.search('local');
        expect(r).toEqual([{ phoneNumber: '+15125550001' }]);
        const [url] = fetchMock.mock.calls[0];
        expect(url).toContain('api.twilio.com/2010-04-01/Accounts/AC1/AvailablePhoneNumbers/US/Local.json');
        expect(url).not.toContain('TollFree');
    });

    it("numbers.search with areaCode passes AreaCode query param", async () => {
        const body = JSON.stringify({ available_phone_numbers: [{ phone_number: '+18005550003' }] });
        const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        await new TwilioClient({ sid: 'AC1', token: 't' }).numbers.search('tollfree', '800');
        const [url] = fetchMock.mock.calls[0];
        expect(url).toContain('AreaCode=800');
    });

    it("numbers.search('local') with areaCode passes AreaCode query param and uses Local catalog", async () => {
        const body = JSON.stringify({ available_phone_numbers: [{ phone_number: '+15125550004' }] });
        const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        await new TwilioClient({ sid: 'AC1', token: 't' }).numbers.search('local', '512');
        const [url] = fetchMock.mock.calls[0];
        expect(url).toContain('AvailablePhoneNumbers/US/Local.json');
        expect(url).toContain('AreaCode=512');
    });

    it('numbers.buy POSTs PhoneNumber to IncomingPhoneNumbers and returns sid+phoneNumber', async () => {
        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify({ sid: 'PN9', phone_number: '+18005550001' }), { status: 201 }),
        );
        vi.stubGlobal('fetch', fetchMock);
        const r = await new TwilioClient({ sid: 'AC1', token: 't' }).numbers.buy('+18005550001');
        expect(r).toMatchObject({ sid: 'PN9', phoneNumber: '+18005550001' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('api.twilio.com/2010-04-01/Accounts/AC1/IncomingPhoneNumbers.json');
        expect(init.method).toBe('POST');
        expect(init.body).toContain('PhoneNumber=%2B18005550001');
    });

    it('numbers.buy throws on non-ok response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () =>
            new Response(JSON.stringify({ message: 'Phone number unavailable' }), { status: 400 }),
        ));
        await expect(
            new TwilioClient({ sid: 'AC1', token: 't' }).numbers.buy('+18005550001'),
        ).rejects.toThrow('Phone number unavailable');
    });
});
