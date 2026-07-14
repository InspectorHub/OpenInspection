import { describe, it, expect, beforeEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { createTestDb, setupSchema } from '../db';
import { tenantConfigs, tenants } from '../../../server/lib/db/schema';
import {
    resolveGoogleOAuthCredentials,
    loadGoogleOAuthMode,
    isGoogleOAuthConfigured,
} from '../../../server/lib/calendar/resolve-google-oauth';
import { loadTenantSecrets } from '../../../server/lib/secrets-cache';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

vi.mock('../../../server/lib/secrets-cache', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    loadTenantSecrets: vi.fn(),
}));

const TENANT = '00000000-0000-0000-0000-0000000000aa';
const JWT_SECRET = 'resolve-google-oauth-test-secret!!';

function makeKv() {
    const store = new Map<string, string>();
    return {
        get: async (k: string) => store.get(k) ?? null,
        put: async (k: string, v: string) => { store.set(k, v); },
        delete: async (k: string) => { store.delete(k); },
    } as unknown as KVNamespace;
}

async function makeDb(integrationConfig?: Record<string, unknown>) {
    const fix = createTestDb();
    await setupSchema(fix.sqlite);
    vi.mocked(drizzle).mockReturnValue(fix.db as never);
    if (integrationConfig) {
        await fix.db.insert(tenants).values({
            id: TENANT, name: 'Test', slug: 'test-tenant', createdAt: new Date(),
        } as never);
        await fix.db.insert(tenantConfigs).values({
            tenantId: TENANT,
            integrationConfig: JSON.stringify(integrationConfig),
            updatedAt: new Date(),
        } as never);
    }
    return {} as unknown as D1Database;
}

function baseEnv(overrides: Record<string, string | undefined> = {}) {
    return {
        DB: {} as D1Database,
        TENANT_CACHE: makeKv(),
        JWT_SECRET,
        GOOGLE_CLIENT_ID: undefined as string | undefined,
        GOOGLE_CLIENT_SECRET: undefined as string | undefined,
        ...overrides,
    };
}

describe('resolve-google-oauth', () => {
    beforeEach(() => {
        vi.mocked(loadTenantSecrets).mockReset().mockResolvedValue(null);
    });

    it('platform mode prefers Worker env over tenant secrets', async () => {
        vi.mocked(loadTenantSecrets).mockResolvedValue({
            GOOGLE_CLIENT_ID: 'tenant-client',
            GOOGLE_CLIENT_SECRET: 'tenant-secret',
        });
        const env = baseEnv({
            GOOGLE_CLIENT_ID: 'env-client',
            GOOGLE_CLIENT_SECRET: 'env-secret',
        });
        const creds = await resolveGoogleOAuthCredentials(env, TENANT, 'platform');
        expect(creds).toEqual({ clientId: 'env-client', clientSecret: 'env-secret' });
    });

    it('own mode prefers tenant secrets over Worker env', async () => {
        vi.mocked(loadTenantSecrets).mockResolvedValue({
            GOOGLE_CLIENT_ID: 'tenant-client',
            GOOGLE_CLIENT_SECRET: 'tenant-secret',
        });
        const env = baseEnv({
            GOOGLE_CLIENT_ID: 'env-client',
            GOOGLE_CLIENT_SECRET: 'env-secret',
        });
        const creds = await resolveGoogleOAuthCredentials(env, TENANT, 'own');
        expect(creds).toEqual({ clientId: 'tenant-client', clientSecret: 'tenant-secret' });
    });

    it('loadGoogleOAuthMode defaults to platform', async () => {
        const db = await makeDb({ appBaseUrl: 'https://example.com' });
        const env = { ...baseEnv(), DB: db };
        expect(await loadGoogleOAuthMode(env.DB, TENANT)).toBe('platform');
    });

    it('loadGoogleOAuthMode reads own from integration_config', async () => {
        const db = await makeDb({ googleOAuthMode: 'own' });
        expect(await loadGoogleOAuthMode(db, TENANT)).toBe('own');
    });

    it('isGoogleOAuthConfigured is true when env has creds', async () => {
        const env = baseEnv({
            GOOGLE_CLIENT_ID: 'env-client',
            GOOGLE_CLIENT_SECRET: 'env-secret',
        });
        expect(await isGoogleOAuthConfigured(env, TENANT)).toBe(true);
    });

    it('isGoogleOAuthConfigured is true when tenant secrets have creds', async () => {
        vi.mocked(loadTenantSecrets).mockResolvedValue({
            GOOGLE_CLIENT_ID: 'tenant-client',
            GOOGLE_CLIENT_SECRET: 'tenant-secret',
        });
        expect(await isGoogleOAuthConfigured(baseEnv(), TENANT)).toBe(true);
    });
});
