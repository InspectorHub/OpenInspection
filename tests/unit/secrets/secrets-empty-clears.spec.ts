/**
 * `PUT/POST /api/admin/secrets` -- what an explicit empty string means.
 *
 * The settings pages drop a blank field before they call the API, so a blank
 * field there still means "leave it as it is". On the wire, an explicit empty
 * (or whitespace-only) string is the opposite: "this key is not configured",
 * which is also what GET /secrets reports for an unset key. It used to be
 * skipped silently, so a key could never be removed through the API, and a
 * whitespace-only value cleared it -- two answers for the same intent.
 *
 * Clearing one Stripe key must leave the set INCOMPLETE (fail closed), so the
 * public booking page stops offering a payment.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { withBatch } from '../helpers/d1-binding';
import { saveSecretsImpl } from '../../../server/api/secrets';
import { openSecrets, sealSecrets } from '../../../server/lib/config-crypto';
import { INTEGRATION_SECRET_KEYS } from '../../../server/lib/secrets-catalog';
import { STRIPE_KEYS, countStripeKeys } from '../../../server/lib/integrations/stripe-keys';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT_A = '00000000-0000-0000-0000-00000000000a';
const TENANT_B = '00000000-0000-0000-0000-00000000000b';
const JWT_SECRET = 'test-secret';
const NOT_SELF_HOST = { envCredentialsAreCompanyOwn: false } as const;

describe('PUT/POST /api/admin/secrets -- an explicit empty string clears the key', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    const seen: Array<{ body: unknown; status: number }> = [];

    function ctx(tenantId: string) {
        return {
            get: (k: string) => (k === 'tenantId' ? tenantId : undefined),
            env: { DB: {} as D1Database, JWT_SECRET, TENANT_CACHE: undefined },
            req: { header: () => undefined },
            executionCtx: undefined,
            json: (body: unknown, status: number) => {
                seen.push({ body, status });
                return { body, status };
            },
        } as unknown as Context<HonoConfig>;
    }

    async function save(tenantId: string, body: Record<string, string>) {
        await saveSecretsImpl(ctx(tenantId), body);
        return seen[seen.length - 1];
    }

    async function stored(tenantId: string): Promise<Record<string, string>> {
        const row = await testDb.select().from(schema.tenantConfigs)
            .where(eq(schema.tenantConfigs.tenantId, tenantId)).get();
        if (!row?.secretsEnc) return {};
        return openSecrets(row.secretsEnc, row.dekEnc ?? null, tenantId, JWT_SECRET, undefined);
    }

    /** Seed a sealed blob directly, so no format gate or vendor probe is involved. */
    async function seed(tenantId: string, secrets: Record<string, string>) {
        const sealed = await sealSecrets(secrets, tenantId, JWT_SECRET, null, undefined);
        await testDb.update(schema.tenantConfigs)
            .set({ secretsEnc: sealed.blob, dekEnc: sealed.dekEnc })
            .where(eq(schema.tenantConfigs.tenantId, tenantId));
    }

    const fullSet = () => Object.fromEntries(INTEGRATION_SECRET_KEYS.map((k) => [k, `value-of-${k}`]));

    beforeEach(async () => {
        seen.length = 0;
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(withBatch(testDb, fix.sqlite));
        for (const [id, slug] of [[TENANT_A, 'acme'], [TENANT_B, 'beta']] as const) {
            await testDb.insert(schema.tenants).values({
                id, slug, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
            });
            await testDb.insert(schema.tenantConfigs).values({ tenantId: id, updatedAt: new Date() });
        }
        // Nothing here should reach a vendor; a stray probe must not pass silently.
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it.each(INTEGRATION_SECRET_KEYS.map((k) => [k]))('clears %s and leaves every other key untouched', async (key) => {
        await seed(TENANT_A, fullSet());

        const res = await save(TENANT_A, { [key]: '' });

        expect(res.status).toBe(200);
        const after = await stored(TENANT_A);
        expect(after).not.toHaveProperty(key);
        const expected = fullSet();
        delete expected[key];
        expect(after).toEqual(expected);
    });

    it('clearing a key that was never stored changes nothing and is not reported as cleared', async () => {
        await seed(TENANT_A, { TWILIO_AUTH_TOKEN: 'only' });

        // What a client does when it round-trips GET output: every unset key comes back as "".
        const res = await save(TENANT_A, { RESEND_API_KEY: '', MAILGUN_API_KEY: '' });

        expect(res.status).toBe(200);
        expect(await stored(TENANT_A)).toEqual({ TWILIO_AUTH_TOKEN: 'only' });
        const audit = await testDb.select().from(schema.auditLogs).all();
        const reported = JSON.stringify(audit.map((a) => a.metadata ?? ''));
        expect(reported).not.toContain('keysCleared');
    });

    it('treats a whitespace-only value the same as an empty one', async () => {
        await seed(TENANT_A, fullSet());
        await save(TENANT_A, { RESEND_API_KEY: '   ' });
        expect(await stored(TENANT_A)).not.toHaveProperty('RESEND_API_KEY');
    });

    it('leaves a key alone when it is omitted or masked', async () => {
        await seed(TENANT_A, fullSet());
        await save(TENANT_A, { TWILIO_AUTH_TOKEN: 'abcd••••••••9999' });
        expect(await stored(TENANT_A)).toEqual(fullSet());
    });

    it('clearing one Stripe key leaves the set incomplete; saving it again completes it', async () => {
        await seed(TENANT_A, {
            STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_PUBLISHABLE_KEY: 'pk_test_1', STRIPE_WEBHOOK_SECRET: 'whsec_1',
        });
        expect(countStripeKeys(await stored(TENANT_A), NOT_SELF_HOST, {})).toBe(STRIPE_KEYS.length);

        await save(TENANT_A, { STRIPE_WEBHOOK_SECRET: '' });
        expect(countStripeKeys(await stored(TENANT_A), NOT_SELF_HOST, {})).toBe(STRIPE_KEYS.length - 1);

        const res = await save(TENANT_A, { STRIPE_WEBHOOK_SECRET: 'whsec_2' });
        expect(res.status).toBe(200);
        expect((await stored(TENANT_A)).STRIPE_WEBHOOK_SECRET).toBe('whsec_2');
        expect(countStripeKeys(await stored(TENANT_A), NOT_SELF_HOST, {})).toBe(STRIPE_KEYS.length);
    });

    it('a non-empty value still saves, trimmed, alongside a cleared one', async () => {
        await seed(TENANT_A, { TWILIO_AUTH_TOKEN: 'old', POSTMARK_SERVER_TOKEN: 'keep' });
        await save(TENANT_A, { TWILIO_AUTH_TOKEN: '', MAILGUN_API_KEY: '  new-token \n' });
        expect(await stored(TENANT_A)).toEqual({ POSTMARK_SERVER_TOKEN: 'keep', MAILGUN_API_KEY: 'new-token' });
    });

    it('clearing the last key empties both sealed columns', async () => {
        await seed(TENANT_A, { TWILIO_AUTH_TOKEN: 'only' });
        await save(TENANT_A, { TWILIO_AUTH_TOKEN: '' });
        const row = await testDb.select().from(schema.tenantConfigs)
            .where(eq(schema.tenantConfigs.tenantId, TENANT_A)).get();
        expect(row?.secretsEnc).toBeNull();
        expect(row?.dekEnc).toBeNull();
    });

    it('is scoped to the caller tenant: another tenant\'s secrets are never touched', async () => {
        await seed(TENANT_A, fullSet());
        await seed(TENANT_B, fullSet());

        await save(TENANT_A, { TWILIO_AUTH_TOKEN: '' });

        expect(await stored(TENANT_A)).not.toHaveProperty('TWILIO_AUTH_TOKEN');
        expect(await stored(TENANT_B)).toEqual(fullSet());
    });
});
