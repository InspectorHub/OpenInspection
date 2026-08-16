import { describe, it, expect, vi } from 'vitest';
import { integrationSecretsMiddleware } from '../../../server/lib/middleware/integration-secrets';

vi.mock('../../../server/lib/secrets-cache', () => ({
    loadTenantSecrets: vi.fn(async () => ({
        RESEND_API_KEY: 're_tenant_a',
        STRIPE_SECRET_KEY: 'sk_test_tenant_a',
    })),
}));

/**
 * The middleware must never write a tenant's secrets onto the `env` object it
 * was handed.
 *
 * The runtime reuses one `env` per isolate — pinned in
 * `tests/workers/env-mutation-crosses-requests.spec.ts` — so an in-place write
 * outlives the request that made it. The next tenant then inherits it for every
 * key they have not stored themselves, because `env` is no longer empty and the
 * env-wins rule resolves to the previous tenant's value.
 *
 * `integration-secrets-precedence.spec.ts` covers which value wins. It says
 * nothing about WHICH OBJECT is written, which is how this went unexamined:
 * the pure function is correct and the caller was not.
 */
type MutableEnv = Record<string, unknown>;

function fakeContext(env: MutableEnv) {
    const ctx = {
        env,
        req: { path: '/api/anything' },
        get: (k: string) => (k === 'tenantId' ? 'tenant-a' : undefined),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ctx as any;
}

describe('integrationSecretsMiddleware does not mutate the env it is given', () => {
    it('leaves the original object untouched', async () => {
        const original: MutableEnv = { DB: {}, TENANT_CACHE: {}, JWT_SECRET: 'k' };
        const c = fakeContext(original);

        await integrationSecretsMiddleware(c, async () => {});

        // The object the runtime owns must carry none of tenant A's secrets.
        expect(original.RESEND_API_KEY).toBeUndefined();
        expect(original.STRIPE_SECRET_KEY).toBeUndefined();
    });

    it('gives the request a different object that does carry them', async () => {
        // The positive control. Without it, a middleware that silently stopped
        // resolving secrets at all would pass the assertion above.
        const original: MutableEnv = { DB: {}, TENANT_CACHE: {}, JWT_SECRET: 'k' };
        const c = fakeContext(original);

        await integrationSecretsMiddleware(c, async () => {});

        expect(c.env).not.toBe(original);
        expect(c.env.RESEND_API_KEY).toBe('re_tenant_a');
        expect(c.env.STRIPE_SECRET_KEY).toBe('sk_test_tenant_a');
    });

    it('keeps the bindings as the same references', async () => {
        // A shallow copy is deliberate: DB, KV and R2 must stay the very objects
        // the runtime handed us. A deep clone here would break every query.
        const db = { name: 'DB' };
        const kv = { name: 'KV' };
        const original: MutableEnv = { DB: db, TENANT_CACHE: kv, JWT_SECRET: 'k' };
        const c = fakeContext(original);

        await integrationSecretsMiddleware(c, async () => {});

        expect(c.env.DB).toBe(db);
        expect(c.env.TENANT_CACHE).toBe(kv);
    });
});
