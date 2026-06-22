/**
 * A-16 — email/AI keys must come from the CANONICAL secrets store.
 *
 * Every Settings page writes keys via PUT/POST /api/admin/secrets into
 * `tenant_configs.secrets_enc` (ENV-name keys). The email/AI config
 * loader used to read the legacy camelCase `secrets` column, which no UI
 * writes anymore — so a tenant's saved Resend (own mode) and Gemini (BYOK)
 * keys never reached EmailService/AIService construction. This pins the
 * canonical read end-to-end: real AES-GCM encrypt → store → load → decrypt.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { createTestDb, setupSchema } from './db';
import { tenantConfigs, tenants } from '../../server/lib/db/schema';
import { encryptSecrets } from '../../server/lib/config-crypto';
import { loadTenantEmailConfig, type EmailServiceEnv } from '../../server/lib/email/build-email-service';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT_ID = 't-1';
const JWT_SECRET = 'x'.repeat(32);

const env = {
    DB: {} as never,
    TENANT_CACHE: undefined as never, // no KV in unit env — loader falls through to D1
    JWT_SECRET,
} as EmailServiceEnv;

describe('loadTenantEmailConfig — canonical secrets store', () => {
    beforeEach(async () => {
        const fix = createTestDb();
        await setupSchema(fix.sqlite);
        vi.mocked(drizzle).mockReturnValue(fix.db as never);
    });

    it('reads Resend + Gemini keys from secrets_enc (ENV-name keys)', async () => {
        const db = vi.mocked(drizzle)({} as never);
        await db.insert(tenants).values({
            id: TENANT_ID,
            name: 'Test Tenant',
            slug: 't-1',
            createdAt: new Date(),
        } as never);
        await db.insert(tenantConfigs).values({
            tenantId: TENANT_ID,
            secretsEnc: await encryptSecrets(
                { RESEND_API_KEY: 're_own_key', GEMINI_API_KEY: 'g_byok_key' },
                JWT_SECRET,
            ),
            updatedAt: new Date(),
        } as never);

        const cfg = await loadTenantEmailConfig(env, TENANT_ID);
        expect(cfg.dbSecrets.resendApiKey).toBe('re_own_key');
        expect(cfg.dbSecrets.geminiApiKey).toBe('g_byok_key');
    });

    it('returns empty secrets when the tenant has none stored', async () => {
        const cfg = await loadTenantEmailConfig(env, TENANT_ID);
        expect(cfg.dbSecrets).toEqual({});
    });
});
