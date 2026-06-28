import { describe, it, expect, afterEach, vi } from 'vitest';
import { TwilioClient } from '../../../server/lib/messaging/twilio';
import { TelnyxProvider } from '../../../server/lib/messaging/telnyx';

/**
 * WH-2 Task 1 — sendMessage returns the provider message id (additively) so a
 * later delivery-status callback can be correlated to the original send.
 * Twilio: the `sid` field; Telnyx: `data.id`. A success response lacking the id
 * still resolves `{ ok: true }` (id omitted) and never throws.
 */
describe('sendMessage returns the provider message id (WH-2)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('Twilio: returns { ok: true, id } from the response sid', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 }),
        ));
        const client = new TwilioClient({ sid: 'AC_test', token: 'tok' });
        const res = await client.sendMessage({ from: '+18005550199', to: '+15551230000', body: 'hi' });
        expect(res).toEqual({ ok: true, id: 'SM123' });
    });

    it('Twilio: success without a sid omits id', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 201 })));
        const client = new TwilioClient({ sid: 'AC_test', token: 'tok' });
        const res = await client.sendMessage({ from: '+18005550199', to: '+15551230000', body: 'hi' });
        expect(res).toEqual({ ok: true });
    });

    it('Twilio: failure path unchanged ({ ok: false, error })', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ message: 'bad number' }), { status: 400 }),
        ));
        const client = new TwilioClient({ sid: 'AC_test', token: 'tok' });
        const res = await client.sendMessage({ from: '+18005550199', to: '+1', body: 'hi' });
        expect(res).toEqual({ ok: false, error: 'bad number' });
    });

    it('Telnyx: returns { ok: true, id } from data.id', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ data: { id: 'tx_456' } }), { status: 200 }),
        ));
        const provider = new TelnyxProvider({ apiKey: 'KEY', from: '+18005550199' });
        const res = await provider.sendMessage({ to: '+15551230000', body: 'hi' });
        expect(res).toEqual({ ok: true, id: 'tx_456' });
    });

    it('Telnyx: success with an unparseable body still resolves { ok: true }', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
        const provider = new TelnyxProvider({ apiKey: 'KEY', from: '+18005550199' });
        const res = await provider.sendMessage({ to: '+15551230000', body: 'hi' });
        expect(res).toEqual({ ok: true });
    });

    it('Telnyx: failure path unchanged ({ ok: false, error })', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ errors: [{ detail: 'invalid to' }] }), { status: 422 }),
        ));
        const provider = new TelnyxProvider({ apiKey: 'KEY', from: '+18005550199' });
        const res = await provider.sendMessage({ to: '+1', body: 'hi' });
        expect(res).toEqual({ ok: false, error: 'invalid to' });
    });
});
