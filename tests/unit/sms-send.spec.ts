import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendTwilioSms, validateTwilioSignature } from '../../server/lib/sms/send-sms';

describe('sendTwilioSms', () => {
    beforeEach(() => vi.unstubAllGlobals());

    it('POSTs form-encoded to the account Messages endpoint with basic auth', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('{"sid":"SM1"}', { status: 201 }));
        vi.stubGlobal('fetch', fetchMock);
        const res = await sendTwilioSms({ sid: 'ACx', token: 'tok', from: '+1999' }, '+15551234567', 'Hello');
        expect(res.ok).toBe(true);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACx/Messages.json');
        expect(init.headers.Authorization).toBe(`Basic ${btoa('ACx:tok')}`);
        expect(init.body).toContain('To=%2B15551234567');
        expect(init.body).toContain('From=%2B1999');
        expect(init.body).toContain('Body=Hello');
    });

    it('returns ok=false + error text on non-2xx', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"bad"}', { status: 400 })));
        const res = await sendTwilioSms({ sid: 'ACx', token: 'tok', from: '+1999' }, '+1555', 'Hi');
        expect(res.ok).toBe(false);
        expect(res.error).toContain('bad');
    });
});

describe('validateTwilioSignature', () => {
    it('accepts a correctly-signed request and rejects a tampered one', async () => {
        const url = 'https://app.example.com/api/public/sms/inbound';
        const params = { From: '+15551234567', Body: 'STOP' };
        const { signParams } = await import('../../server/lib/sms/send-sms');
        const good = await signParams('authtoken', url, params);
        expect(await validateTwilioSignature('authtoken', url, params, good)).toBe(true);
        expect(await validateTwilioSignature('authtoken', url, params, 'wrong')).toBe(false);
    });
});
