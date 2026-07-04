import { describe, it, expect } from 'vitest';
import { applyIntegrationSecrets } from '../../../server/lib/middleware/integration-secrets';

// A-8: per-key precedence when merging a tenant's decrypted DB secrets into
// the Worker env. Stripe (Connect) is strictly per-tenant → DB wins. All other
// integration keys are platform-shared → env wins, DB is the self-host fallback.
describe('applyIntegrationSecrets — A-8 precedence', () => {
    it('Stripe keys: tenant DB value WINS over a populated platform env', () => {
        const env: Record<string, string | undefined> = {
            STRIPE_SECRET_KEY: 'sk_platform_DO_NOT_USE',
            STRIPE_WEBHOOK_SECRET: 'whsec_platform',
            STRIPE_PUBLISHABLE_KEY: 'pk_platform',
        };
        applyIntegrationSecrets(env, {
            STRIPE_SECRET_KEY: 'sk_tenant',
            STRIPE_WEBHOOK_SECRET: 'whsec_tenant',
            STRIPE_PUBLISHABLE_KEY: 'pk_tenant',
        });
        // The tenant's own Stripe account must never be hijacked by platform env.
        expect(env.STRIPE_SECRET_KEY).toBe('sk_tenant');
        expect(env.STRIPE_WEBHOOK_SECRET).toBe('whsec_tenant');
        expect(env.STRIPE_PUBLISHABLE_KEY).toBe('pk_tenant');
    });

    it('platform-shared keys: env WINS over DB when env is populated', () => {
        const env: Record<string, string | undefined> = {
            GOOGLE_PLACES_API_KEY: 'places_platform',
            TURNSTILE_SECRET_KEY: 'turnstile_platform',
            ESTATED_API_KEY: 'estated_platform',
        };
        applyIntegrationSecrets(env, {
            GOOGLE_PLACES_API_KEY: 'places_tenant',
            TURNSTILE_SECRET_KEY: 'turnstile_tenant',
            ESTATED_API_KEY: 'estated_tenant',
        });
        expect(env.GOOGLE_PLACES_API_KEY).toBe('places_platform');
        expect(env.TURNSTILE_SECRET_KEY).toBe('turnstile_platform');
        expect(env.ESTATED_API_KEY).toBe('estated_platform');
    });

    it('platform-shared keys: DB fills in when env is empty/whitespace/undefined', () => {
        const env: Record<string, string | undefined> = {
            GOOGLE_PLACES_API_KEY: '',
            ESTATED_API_KEY: '   ',
            // QBO_CLIENT_ID undefined
        };
        applyIntegrationSecrets(env, {
            GOOGLE_PLACES_API_KEY: 'places_tenant',
            ESTATED_API_KEY: 'estated_tenant',
            QBO_CLIENT_ID: 'qbo_tenant',
        });
        expect(env.GOOGLE_PLACES_API_KEY).toBe('places_tenant');
        expect(env.ESTATED_API_KEY).toBe('estated_tenant');
        expect(env.QBO_CLIENT_ID).toBe('qbo_tenant');
    });

    it('empty DB values are ignored (do not clobber a populated env)', () => {
        const env: Record<string, string | undefined> = { RESEND_API_KEY: 're_platform' };
        applyIntegrationSecrets(env, { RESEND_API_KEY: '' });
        expect(env.RESEND_API_KEY).toBe('re_platform');
    });

    it('keys outside the allowlist are never merged', () => {
        const env: Record<string, string | undefined> = {};
        applyIntegrationSecrets(env, { SOME_RANDOM_KEY: 'x', JWT_SECRET: 'should_not_leak' } as Record<string, string>);
        expect(env.SOME_RANDOM_KEY).toBeUndefined();
        expect(env.JWT_SECRET).toBeUndefined();
    });
});
