import { describe, it, expect } from 'vitest';
import type { InboundSignatureContext } from '../../../server/lib/messaging/provider';
import { TwilioClient, validateTwilioSignature, signParams } from '../../../server/lib/messaging/twilio';
import { TelnyxProvider, verifyTelnyxSignature } from '../../../server/lib/messaging/telnyx';

/**
 * Inbound signature verification through the ctx-based `validateInboundSignature`
 * interface. No live carrier — every payload is signed with a synthetic key and
 * verified with its public half.
 */

function bytesToBase64(bytes: Uint8Array): string {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
}

describe('Twilio validateInboundSignature (ctx form)', () => {
    const url = 'https://app.example.com/api/public/sms/inbound';
    const params = { From: '+15551234567', Body: 'STOP' };
    const authToken = 'authtoken';

    it('accepts a correctly-signed ctx and rejects a tampered one', async () => {
        const good = await signParams(authToken, url, params);
        const provider = new TwilioClient({ sid: 'ACx', token: authToken });

        const goodCtx: InboundSignatureContext = {
            url,
            rawBody: '',
            params,
            headers: { 'x-twilio-signature': good },
            secret: authToken,
        };
        expect(await provider.validateInboundSignature(goodCtx)).toBe(true);

        const badCtx: InboundSignatureContext = { ...goodCtx, headers: { 'x-twilio-signature': 'wrong' } };
        expect(await provider.validateInboundSignature(badCtx)).toBe(false);
    });

    it('returns false when the signature header is missing', async () => {
        const provider = new TwilioClient({ sid: 'ACx', token: authToken });
        const ctx: InboundSignatureContext = { url, rawBody: '', params, headers: {}, secret: authToken };
        expect(await provider.validateInboundSignature(ctx)).toBe(false);
    });

    it('ctx-based verdict is byte-identical to the legacy 4-arg validateTwilioSignature (valid + tampered)', async () => {
        const good = await signParams(authToken, url, params);
        const provider = new TwilioClient({ sid: 'ACx', token: authToken });

        for (const presented of [good, 'wrong']) {
            const ctx: InboundSignatureContext = {
                url,
                rawBody: '',
                params,
                headers: { 'x-twilio-signature': presented },
                secret: authToken,
            };
            const ctxResult = await provider.validateInboundSignature(ctx);
            const legacyResult = await validateTwilioSignature(authToken, url, params, presented);
            expect(ctxResult).toBe(legacyResult);
        }
    });
});

describe('Telnyx validateInboundSignature (Ed25519)', () => {
    const body = 'From=%2B15551234567&Body=STOP';

    /** Generate a keypair and return the base64 public key + a signer over `${ts}|${body}`. */
    async function makeKeypair() {
        const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
        const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
        const publicKeyB64 = bytesToBase64(rawPub);
        const sign = async (ts: string, rawBody: string): Promise<string> => {
            const data = new TextEncoder().encode(`${ts}|${rawBody}`);
            const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, data));
            return bytesToBase64(sig);
        };
        return { publicKeyB64, sign };
    }

    function ctxFor(opts: {
        publicKeyB64: string;
        ts: string;
        sig: string;
        rawBody?: string;
        nowMs?: number;
        omitSig?: boolean;
    }): InboundSignatureContext {
        const headers: Record<string, string> = { 'telnyx-timestamp': opts.ts };
        if (!opts.omitSig) headers['telnyx-signature-ed25519'] = opts.sig;
        return {
            url: 'https://app.example.com/api/public/sms/inbound',
            rawBody: opts.rawBody ?? body,
            params: {},
            headers,
            secret: opts.publicKeyB64,
            nowMs: opts.nowMs,
        };
    }

    it('accepts a freshly-signed ts|body against the matching public key', async () => {
        const { publicKeyB64, sign } = await makeKeypair();
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = await sign(ts, body);
        const provider = new TelnyxProvider({ apiKey: 'k', from: '+1999' });
        expect(await provider.validateInboundSignature(ctxFor({ publicKeyB64, ts, sig, nowMs: Number(ts) * 1000 }))).toBe(true);
    });

    it('rejects a signature made with a different key', async () => {
        const signer = await makeKeypair();
        const other = await makeKeypair();
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = await signer.sign(ts, body);
        const provider = new TelnyxProvider({ apiKey: 'k', from: '+1999' });
        // Verify with the OTHER public key.
        expect(
            await provider.validateInboundSignature(ctxFor({ publicKeyB64: other.publicKeyB64, ts, sig, nowMs: Number(ts) * 1000 })),
        ).toBe(false);
    });

    it('rejects a stale timestamp (now is 600s past the signed ts)', async () => {
        const { publicKeyB64, sign } = await makeKeypair();
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = await sign(ts, body);
        const provider = new TelnyxProvider({ apiKey: 'k', from: '+1999' });
        const nowMs = Number(ts) * 1000 + 600_000;
        expect(await provider.validateInboundSignature(ctxFor({ publicKeyB64, ts, sig, nowMs }))).toBe(false);
    });

    it('rejects when the telnyx-signature-ed25519 header is missing', async () => {
        const { publicKeyB64, sign } = await makeKeypair();
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = await sign(ts, body);
        const provider = new TelnyxProvider({ apiKey: 'k', from: '+1999' });
        expect(
            await provider.validateInboundSignature(ctxFor({ publicKeyB64, ts, sig, omitSig: true, nowMs: Number(ts) * 1000 })),
        ).toBe(false);
    });

    it('returns false (no throw) on a malformed base64 public key', async () => {
        const { sign } = await makeKeypair();
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = await sign(ts, body);
        const provider = new TelnyxProvider({ apiKey: 'k', from: '+1999' });
        expect(
            await provider.validateInboundSignature(ctxFor({ publicKeyB64: 'not!!base64!!', ts, sig, nowMs: Number(ts) * 1000 })),
        ).toBe(false);
    });

    it('verifyTelnyxSignature fails closed on empty timestamp', async () => {
        const { publicKeyB64, sign } = await makeKeypair();
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = await sign(ts, body);
        expect(await verifyTelnyxSignature(publicKeyB64, '', body, sig, Number(ts) * 1000)).toBe(false);
    });
});
