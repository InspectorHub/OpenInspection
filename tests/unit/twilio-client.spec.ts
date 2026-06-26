import { describe, it, expect, vi, afterEach } from 'vitest';
import { TwilioClient } from '../../server/lib/messaging/twilio';

describe('TwilioClient.messages.create', () => {
    afterEach(() => vi.restoreAllMocks());

    it('POSTs to the Account Messages endpoint with basic auth + form body', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sid: 'SM1' }), { status: 201 }));
        vi.stubGlobal('fetch', fetchMock);
        const client = new TwilioClient({ sid: 'AC123', token: 'tok' });

        const res = await client.messages.create({ from: '+15550000000', to: '+15551112222', body: 'hi' });

        expect(res).toEqual({ ok: true });
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
});

describe('TwilioClient.tollfree', () => {
    afterEach(() => vi.restoreAllMocks());

    it('tollfree.list returns verifications from the messaging API', async () => {
        const body = JSON.stringify({ verifications: [{ sid: 'HH1', status: 'TWILIO_APPROVED', tollfree_phone_number_sid: 'PN1' }] });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
        const out = await new TwilioClient({ sid: 'AC1', token: 't' }).tollfree.list();
        expect(out[0]).toMatchObject({ sid: 'HH1', status: 'TWILIO_APPROVED' });
    });
});
