/**
 * Characterization of how the existing per-service resolvers pick a credential
 * SOURCE today, with no stored source choice. Written before the resolvers were
 * wired to the unified resolver; every case here must keep passing afterwards,
 * except the single case marked DEFECT, whose expectation was changed in the
 * same commit as the fix (the review lists it as a defect).
 *
 * AI is pinned by tests/unit/ai/resolve-provider.spec.ts, and the pure SMS
 * selector by tests/unit/messaging/resolve-twilio.spec.ts. This file pins the
 * parts that were not: the email assembly, the SMS loaders, the video provider
 * and the QuickBooks credential merge.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { sealSecrets } from '../../../server/lib/config-crypto';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import { assembleTenantEmailService, type LoadedEmailConfig, type EmailServiceEnv } from '../../../server/lib/email/build-email-service';
import { loadProviderForTenant, type TwilioLoaderEnv } from '../../../server/lib/sms/resolve-twilio';
import { resolveVideoProvider } from '../../../server/services/video/resolve';
import { resolveQboCredentialsForTenant } from '../../../server/services/qbo/resolve-credentials';
import { getDeploymentProfile } from '../../../server/lib/deployment-profile';

const T = '00000000-0000-0000-0000-0000000000aa';
const JWT_SECRET = 'secret32chars_aaaaaaaaaaaaaaaaaa';

let db: BetterSQLite3Database<typeof schema>;

beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db;
    await setupSchema(fix.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({ id: T, slug: 'co', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function seedConfig(opts: {
    secrets?: Record<string, string>;
    smsMode?: 'platform' | 'own' | 'managed_shared' | 'managed_dedicated';
    smsByoProvider?: 'twilio' | 'telnyx';
    videoMode?: 'r2' | 'stream';
    integrationConfig?: Record<string, unknown>;
}) {
    const sealed = opts.secrets ? await sealSecrets(opts.secrets, T, JWT_SECRET) : null;
    await db.insert(schema.tenantConfigs).values({
        tenantId: T,
        ...(sealed ? { secretsEnc: sealed.blob, dekEnc: sealed.dekEnc } : {}),
        ...(opts.smsMode ? { smsMode: opts.smsMode } : {}),
        ...(opts.smsByoProvider ? { smsByoProvider: opts.smsByoProvider } : {}),
        ...(opts.videoMode ? { videoMode: opts.videoMode } : {}),
        ...(opts.integrationConfig ? { integrationConfig: JSON.stringify(opts.integrationConfig) } : {}),
        createdAt: new Date(), updatedAt: new Date(),
    } as never);
}

// ─── Email ────────────────────────────────────────────────────────────────────

const identity = (mode: 'platform' | 'own', senderEmail: string | null) => ({
    mode, senderEmail, replyTo: null, senderDisplayName: null, pointOfContact: 'company' as const, companyName: null,
});
const baseEmailEnv = (extra: Partial<EmailServiceEnv> = {}): EmailServiceEnv => ({
    DB: {} as never, TENANT_CACHE: {} as never, JWT_SECRET,
    RESEND_API_KEY: 're_deployment', SENDER_EMAIL: 'noreply@deployment.test', ...extra,
});

async function sendAndCapture(env: EmailServiceEnv, cfg: LoadedEmailConfig): Promise<{ url: string; init: string } | null> {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'm1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await assembleTenantEmailService(env, cfg).sendEmail(['to@x.test'], 'Subject', '<p>hi</p>');
    const call = fetchMock.mock.calls[0] as unknown as [string, unknown] | undefined;
    return call ? { url: String(call[0]), init: JSON.stringify(call[1]) } : null;
}

describe('email source today', () => {
    it.each([['standalone', {}], ['hosted', { APP_MODE: 'saas' }]])('%s, platform mode: sends on the deployment key and sender', async (_n, extra) => {
        const sent = await sendAndCapture(baseEmailEnv(extra), { emailIdentity: identity('platform', null), dbSecrets: {} });
        expect(sent?.url).toContain('resend.com');
        expect(sent?.init).toContain('re_deployment');
        expect(sent?.init).toContain('noreply@deployment.test');
    });

    it('platform mode with no deployment key falls back to the company stored Resend key', async () => {
        const sent = await sendAndCapture(baseEmailEnv({ RESEND_API_KEY: '' }), { emailIdentity: identity('platform', 'me@co.test'), dbSecrets: { resendApiKey: 're_company' } });
        expect(sent?.init).toContain('re_company');
    });

    it.each([['standalone', {}], ['hosted', { APP_MODE: 'saas' }]])('%s, own mode with complete keys: sends on the company key and sender', async (_n, extra) => {
        const sent = await sendAndCapture(baseEmailEnv(extra), { emailIdentity: identity('own', 'me@co.test'), dbSecrets: { resendApiKey: 're_company' } });
        expect(sent?.init).toContain('re_company');
        expect(sent?.init).not.toContain('re_deployment');
        expect(sent?.init).toContain('me@co.test');
    });

    it('standalone, own mode with incomplete keys: falls back to the operator env (the operator own account)', async () => {
        const sent = await sendAndCapture(baseEmailEnv(), { emailIdentity: identity('own', 'me@co.test'), dbSecrets: {}, emailByoProvider: 'sendgrid' });
        expect(sent?.url).toContain('resend.com');
        expect(sent?.init).toContain('re_deployment');
    });

    it('hosted, own mode with incomplete keys never sends on the deployment account', async () => {
        // DEFECT fixed (review item 2): this used to fall back silently to the
        // deployment's Resend key and sender, a cost leak. Now nothing is sent.
        const sent = await sendAndCapture(baseEmailEnv({ APP_MODE: 'saas' }), { emailIdentity: identity('own', 'me@co.test'), dbSecrets: {}, emailByoProvider: 'sendgrid' });
        expect(sent).toBeNull();
    });
});

// ─── SMS loaders ──────────────────────────────────────────────────────────────

const TWILIO_OWN = { TWILIO_ACCOUNT_SID: 'ACown', TWILIO_AUTH_TOKEN: 'own-tok', TWILIO_FROM_NUMBER: '+15550001111' };
const smsEnv = (extra: Partial<TwilioLoaderEnv> = {}): TwilioLoaderEnv => ({
    DB: {} as never, TENANT_CACHE: undefined as never, JWT_SECRET, ...extra,
});
const TWILIO_DEP = { TWILIO_ACCOUNT_SID: 'ACdep', TWILIO_AUTH_TOKEN: 'dep-tok', TWILIO_FROM_NUMBER: '+15559998888' };

// better-sqlite3 answers `.get()` synchronously while D1 returns a promise, and
// the loaders chain `.catch` onto it. This wrapper gives the real query builder
// D1's shape without stubbing any query.
function d1Shaped<T extends object>(target: T): T {
    return new Proxy(target, {
        get(t, prop) {
            const v = (t as Record<string | symbol, unknown>)[prop];
            if (prop === 'get' && typeof v === 'function') return (...a: unknown[]) => Promise.resolve((v as (...x: unknown[]) => unknown).apply(t, a));
            if (typeof v !== 'function') return v;
            return (...a: unknown[]) => {
                const out = (v as (...x: unknown[]) => unknown).apply(t, a);
                return out && typeof out === 'object' ? d1Shaped(out as object) : out;
            };
        },
    });
}

describe('sms loader today (no stored source choice)', () => {
    beforeEach(() => { (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(d1Shaped(db)); });
    it('own mode with complete keys: the company number', async () => {
        await seedConfig({ smsMode: 'own', secrets: TWILIO_OWN });
        const r = await loadProviderForTenant(smsEnv(TWILIO_DEP), T);
        expect(r?.from).toBe('+15550001111');
    });

    it('own mode with incomplete keys: falls back to the deployment number', async () => {
        await seedConfig({ smsMode: 'own', secrets: { TWILIO_ACCOUNT_SID: 'ACown' } });
        const r = await loadProviderForTenant(smsEnv(TWILIO_DEP), T);
        expect(r?.from).toBe('+15559998888');
    });

    it('platform mode (the column default): the deployment number, even when the company has keys', async () => {
        await seedConfig({ secrets: TWILIO_OWN });
        const r = await loadProviderForTenant(smsEnv(TWILIO_DEP), T);
        expect(r?.from).toBe('+15559998888');
    });

    it('platform mode with no deployment keys: the company keys as the last resort', async () => {
        await seedConfig({ secrets: TWILIO_OWN });
        const r = await loadProviderForTenant(smsEnv(), T);
        expect(r?.from).toBe('+15550001111');
    });

    it('nothing anywhere: null', async () => {
        await seedConfig({});
        expect(await loadProviderForTenant(smsEnv(), T)).toBeNull();
    });

    it('telnyx needs own mode and both keys', async () => {
        await seedConfig({ smsMode: 'own', smsByoProvider: 'telnyx', secrets: { TELNYX_API_KEY: 'k', TELNYX_FROM_NUMBER: '+15550002222' } });
        expect(await loadProviderForTenant(smsEnv(), T)).not.toBeNull();
        // control: the same keys in platform mode are refused
        await db.delete(schema.tenantConfigs);
        await seedConfig({ smsMode: 'platform', smsByoProvider: 'telnyx', secrets: { TELNYX_API_KEY: 'k', TELNYX_FROM_NUMBER: '+15550002222' } });
        expect(await loadProviderForTenant(smsEnv(), T)).toBeNull();
    });
});

// ─── Video ────────────────────────────────────────────────────────────────────

function videoCtx(profileEnv: { APP_MODE?: string }, env: Record<string, unknown> = {}) {
    return { env: { ...env }, var: { profile: getDeploymentProfile(profileEnv) } } as never;
}

describe('video provider today', () => {
    it('hosted: free and trialling tenants get R2, paid tenants get Stream with the deployment subdomain', async () => {
        const hosted = (env: Record<string, unknown> = {}) => videoCtx({ APP_MODE: 'saas' }, { STREAM: {}, STREAM_CUSTOMER_SUBDOMAIN: 'customer-dep', ...env });
        expect(await resolveVideoProvider(hosted(), T, db as never)).toMatchObject({ provider: 'r2' });
        await db.update(schema.tenants).set({ tier: 'pro', status: 'trial' });
        expect(await resolveVideoProvider(hosted(), T, db as never)).toMatchObject({ provider: 'r2' });
        await db.update(schema.tenants).set({ tier: 'pro', status: 'active' });
        expect(await resolveVideoProvider(hosted(), T, db as never)).toEqual({ provider: 'stream', streamSubdomain: 'customer-dep', streamBindingPresent: true });
    });

    it('self-host: R2 by default, Stream with the stored subdomain when the operator chose it', async () => {
        await seedConfig({});
        expect(await resolveVideoProvider(videoCtx({}), T, db as never)).toMatchObject({ provider: 'r2', streamSubdomain: null });
        await db.delete(schema.tenantConfigs);
        await seedConfig({ videoMode: 'stream', integrationConfig: { streamCustomerSubdomain: 'customer-own' } });
        expect(await resolveVideoProvider(videoCtx({}, { STREAM: {} }), T, db as never))
            .toEqual({ provider: 'stream', streamSubdomain: 'customer-own', streamBindingPresent: true });
    });
});

// ─── QuickBooks app credentials ───────────────────────────────────────────────

const qboEnv = (extra: Record<string, string> = {}) => ({ DB: {} as D1Database, JWT_SECRET, ...extra });

describe('quickbooks credentials today', () => {
    it('the deployment app wins over the company app', async () => {
        await seedConfig({ secrets: { QBO_CLIENT_ID: 'own-id', QBO_CLIENT_SECRET: 'own-secret' } });
        const r = await resolveQboCredentialsForTenant(qboEnv({ QBO_CLIENT_ID: 'dep-id', QBO_CLIENT_SECRET: 'dep-secret' }), T);
        expect(r.credentials).toMatchObject({ clientId: 'dep-id', clientSecret: 'dep-secret' });
    });

    it('the company app fills in where the deployment has none, key by key', async () => {
        await seedConfig({ secrets: { QBO_CLIENT_ID: 'own-id', QBO_CLIENT_SECRET: 'own-secret' } });
        expect((await resolveQboCredentialsForTenant(qboEnv(), T)).credentials).toMatchObject({ clientId: 'own-id', clientSecret: 'own-secret' });
        const mixed = await resolveQboCredentialsForTenant(qboEnv({ QBO_CLIENT_ID: 'dep-id' }), T);
        expect(mixed.credentials).toMatchObject({ clientId: 'dep-id', clientSecret: 'own-secret' });
    });

    it('neither: no credentials, naming what is missing', async () => {
        await seedConfig({});
        expect(await resolveQboCredentialsForTenant(qboEnv(), T)).toEqual({ credentials: null, missing: ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET'] });
    });
});
