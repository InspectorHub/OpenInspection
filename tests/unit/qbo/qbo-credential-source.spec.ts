/**
 * Where each QuickBooks setting comes from, and nothing else.
 *
 * The settings page needs to tell an operator "this value is set on the
 * deployment" apart from "this value is stored for this company" apart from
 * "nothing is set". The answer is derived from the same precedence rule the
 * request middleware applies (`applyIntegrationSecrets`), so a second copy of
 * that rule cannot drift. And it is only ever the ORIGIN: no value, no mask and
 * no length of one may appear in what this returns.
 */
import { describe, it, expect } from 'vitest';
import { applyIntegrationSecrets } from '../../../server/lib/middleware/integration-secrets';
import { describeCredentialSource } from '../../../server/services/qbo/credential-source';

describe('applyIntegrationSecrets reports which keys it took from the stored values', () => {
    it('names the keys filled from the tenant and not the ones the environment already held', () => {
        const env: Record<string, string | undefined> = { QBO_CLIENT_ID: 'from-env', QBO_CLIENT_SECRET: '' };

        const applied = applyIntegrationSecrets(env, {
            QBO_CLIENT_ID: 'stored-id',
            QBO_CLIENT_SECRET: 'stored-secret',
        });

        expect(applied).toEqual(['QBO_CLIENT_SECRET']);
        expect(env.QBO_CLIENT_ID).toBe('from-env');
        expect(env.QBO_CLIENT_SECRET).toBe('stored-secret');
    });

    it('names nothing when the tenant stored nothing (positive control for the case above)', () => {
        const env: Record<string, string | undefined> = { QBO_CLIENT_ID: 'from-env' };

        expect(applyIntegrationSecrets(env, {})).toEqual([]);
    });

    it('does not count a stored value that equals the deployment value as filled from the tenant', () => {
        // The deployment wins when it holds a value, whatever the company stored.
        const env: Record<string, string | undefined> = { QBO_CLIENT_ID: 'same' };

        expect(applyIntegrationSecrets(env, { QBO_CLIENT_ID: 'same' })).toEqual([]);
        // Positive control: a different value in the same place is still not filled.
        expect(applyIntegrationSecrets({ QBO_CLIENT_ID: 'same' }, { QBO_CLIENT_ID: 'other' })).toEqual([]);
    });

    it('treats a blank environment value as empty, as the merge does', () => {
        const env: Record<string, string | undefined> = { QBO_ENV: '   ' };

        expect(applyIntegrationSecrets(env, { QBO_ENV: 'sandbox' })).toEqual(['QBO_ENV']);
    });
});

describe('describeCredentialSource', () => {
    const merged = {
        QBO_CLIENT_ID: 'id-value',
        QBO_CLIENT_SECRET: 'secret-value',
        QBO_WEBHOOK_SECRET: 'webhook-value',
        QBO_ENV: 'sandbox',
    };

    it('says env for a value the environment holds and the tenant did not supply', () => {
        expect(describeCredentialSource(merged, [])).toEqual({
            clientId: 'env', clientSecret: 'env', webhookToken: 'env', environment: 'env',
        });
    });

    it('says tenant for exactly the keys that were filled from the stored values', () => {
        const source = describeCredentialSource(merged, ['QBO_CLIENT_SECRET', 'QBO_ENV']);

        expect(source).toEqual({
            clientId: 'env', clientSecret: 'tenant', webhookToken: 'env', environment: 'tenant',
        });
    });

    it('says missing for a value nobody supplied, including a blank one', () => {
        const source = describeCredentialSource(
            { QBO_CLIENT_ID: '', QBO_CLIENT_SECRET: undefined, QBO_WEBHOOK_SECRET: '  ', QBO_ENV: undefined },
            [],
        );

        expect(source).toEqual({
            clientId: 'missing', clientSecret: 'missing', webhookToken: 'missing', environment: 'missing',
        });
    });

    it('returns only origins: no value, mask or length appears anywhere in the result', () => {
        const source = describeCredentialSource(merged, ['QBO_CLIENT_ID']);
        const text = JSON.stringify(source);

        expect(Object.values(source).every((v) => v === 'env' || v === 'tenant' || v === 'missing')).toBe(true);
        for (const secret of Object.values(merged)) expect(text).not.toContain(secret);
        expect(text).not.toMatch(/\d/);
        expect(text).not.toContain('*');
    });
});
