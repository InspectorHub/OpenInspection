import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendTwilioSms } from '../../../server/lib/sms/send-sms';

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

// validateTwilioSignature (re-exported from server/lib/messaging/twilio) is
// covered — including a byte-identical-to-legacy check — in validate-inbound.spec.ts.
