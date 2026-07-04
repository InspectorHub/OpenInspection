import { describe, it, expect } from 'vitest';
import { validateStripeKeyFormats } from '../../../server/api/secrets';

describe('validateStripeKeyFormats', () => {
    it('accepts well-formed keys and ignores absent ones', () => {
        expect(validateStripeKeyFormats({ STRIPE_PUBLISHABLE_KEY: 'pk_test_abc' })).toBeNull();
        expect(validateStripeKeyFormats({ STRIPE_SECRET_KEY: 'sk_live_abc' })).toBeNull();
        expect(validateStripeKeyFormats({ STRIPE_SECRET_KEY: 'rk_test_abc' })).toBeNull();
        expect(validateStripeKeyFormats({ STRIPE_WEBHOOK_SECRET: 'whsec_abc' })).toBeNull();
        expect(validateStripeKeyFormats({ QBO_CLIENT_SECRET: 'anything' })).toBeNull();
        expect(validateStripeKeyFormats({})).toBeNull();
    });

    it('rejects wrong-slot pastes with the offending field name', () => {
        expect(validateStripeKeyFormats({ STRIPE_PUBLISHABLE_KEY: 'sk_test_abc' }))
            .toEqual({ field: 'STRIPE_PUBLISHABLE_KEY', message: expect.stringContaining('pk_') });
        expect(validateStripeKeyFormats({ STRIPE_SECRET_KEY: 'pk_test_abc' }))
            .toEqual({ field: 'STRIPE_SECRET_KEY', message: expect.any(String) });
        expect(validateStripeKeyFormats({ STRIPE_WEBHOOK_SECRET: 'sk_test_abc' }))
            .toEqual({ field: 'STRIPE_WEBHOOK_SECRET', message: expect.any(String) });
    });

    it('skips masked (unchanged) values', () => {
        expect(validateStripeKeyFormats({ STRIPE_SECRET_KEY: 'sk_t••••••••Ab3d' })).toBeNull();
    });
});

describe('validateStripeKeyFormats — extended vendor prefixes', () => {
    it('accepts well-formed vendor keys', () => {
        expect(validateStripeKeyFormats({ RESEND_API_KEY: 're_abc123' })).toBeNull();
        expect(validateStripeKeyFormats({ GEMINI_API_KEY: 'AIzaSyExample' })).toBeNull();
        expect(validateStripeKeyFormats({ TURNSTILE_SECRET_KEY: '0xSecret' })).toBeNull();
        expect(validateStripeKeyFormats({ TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA' })).toBeNull();
        expect(validateStripeKeyFormats({ APP_BASE_URL: 'https://example.com' })).toBeNull();
    });

    it('rejects malformed vendor keys with the field name', () => {
        expect(validateStripeKeyFormats({ RESEND_API_KEY: 'sk_test_oops' }))
            .toEqual({ field: 'RESEND_API_KEY', message: expect.stringContaining('re_') });
        expect(validateStripeKeyFormats({ GEMINI_API_KEY: 'not-a-google-key' }))
            .toEqual({ field: 'GEMINI_API_KEY', message: expect.stringContaining('AIza') });
        expect(validateStripeKeyFormats({ TURNSTILE_SECRET_KEY: 'abc' }))
            .toEqual({ field: 'TURNSTILE_SECRET_KEY', message: expect.any(String) });
        expect(validateStripeKeyFormats({ APP_BASE_URL: 'example.com' }))
            .toEqual({ field: 'APP_BASE_URL', message: expect.stringContaining('http') });
    });

    it('keys without a stable prefix are not validated (OAuth ids, Places, Estated)', () => {
        expect(validateStripeKeyFormats({ QBO_CLIENT_ID: 'anything' })).toBeNull();
        expect(validateStripeKeyFormats({ GOOGLE_CLIENT_SECRET: 'anything' })).toBeNull();
        expect(validateStripeKeyFormats({ GOOGLE_PLACES_API_KEY: 'anything' })).toBeNull();
        expect(validateStripeKeyFormats({ ESTATED_API_KEY: 'anything' })).toBeNull();
    });
});
