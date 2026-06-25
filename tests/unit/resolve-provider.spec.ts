import { describe, it, expect } from 'vitest';
import { resolveProvider } from '../../server/lib/messaging/resolve-provider';
import { TwilioClient } from '../../server/lib/messaging/twilio';
import { TelnyxProvider } from '../../server/lib/messaging/telnyx';

describe('resolveProvider', () => {
    const twilioCreds = { sid: 'ACabc123', token: 'tok', from: '+15550000001' };
    const telnyxCreds = { apiKey: 'KEY_abc123', from: '+15550000002' };

    it('returns a TwilioClient when byoProvider is null', () => {
        const provider = resolveProvider(null, twilioCreds);
        expect(provider).toBeInstanceOf(TwilioClient);
    });

    it('returns a TwilioClient when byoProvider is undefined', () => {
        const provider = resolveProvider(undefined, twilioCreds);
        expect(provider).toBeInstanceOf(TwilioClient);
    });

    it('returns a TwilioClient when byoProvider is "twilio"', () => {
        const provider = resolveProvider('twilio', twilioCreds);
        expect(provider).toBeInstanceOf(TwilioClient);
    });

    it('returns a TelnyxProvider when byoProvider is "telnyx"', () => {
        const provider = resolveProvider('telnyx', telnyxCreds);
        expect(provider).toBeInstanceOf(TelnyxProvider);
    });

    it('TwilioClient and TelnyxProvider both satisfy MessagingProvider (sendMessage + validateInboundSignature)', () => {
        const twilioProvider = resolveProvider('twilio', twilioCreds);
        const telnyxProvider = resolveProvider('telnyx', telnyxCreds);
        // Type-level: both have the MessagingProvider interface methods.
        expect(typeof twilioProvider.sendMessage).toBe('function');
        expect(typeof twilioProvider.validateInboundSignature).toBe('function');
        expect(typeof telnyxProvider.sendMessage).toBe('function');
        expect(typeof telnyxProvider.validateInboundSignature).toBe('function');
    });
});
