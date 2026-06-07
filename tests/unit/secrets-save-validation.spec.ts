import { describe, it, expect } from 'vitest';
import { validateStripeKeyFormats } from '../../server/api/secrets';

describe('validateStripeKeyFormats', () => {
    it('accepts well-formed keys and ignores absent ones', () => {
        expect(validateStripeKeyFormats({ STRIPE_PUBLISHABLE_KEY: 'pk_test_abc' })).toBeNull();
        expect(validateStripeKeyFormats({ STRIPE_SECRET_KEY: 'sk_live_abc' })).toBeNull();
        expect(validateStripeKeyFormats({ STRIPE_SECRET_KEY: 'rk_test_abc' })).toBeNull();
        expect(validateStripeKeyFormats({ STRIPE_WEBHOOK_SECRET: 'whsec_abc' })).toBeNull();
        expect(validateStripeKeyFormats({ RESEND_API_KEY: 'anything' })).toBeNull();
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
