/**
 * The existing per-service resolvers, once a company has stored an explicit
 * source choice. Each negative case ("never uses the deployment account") sits
 * beside a positive control that flips one input.
 *
 * What a company with NO stored choice gets is pinned separately in
 * source-characterization.spec.ts and must not change.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { sealSecrets } from '../../../server/lib/config-crypto';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import { assembleTenantEmailService, loadTenantEmailConfig, type LoadedEmailConfig, type EmailServiceEnv } from '../../../server/lib/email/build-email-service';
import { loadProviderForTenant, type TwilioLoaderEnv } from '../../../server/lib/sms/resolve-twilio';
import { resolveVideoProvider } from '../../../server/services/video/resolve';
import { resolveQboCredentialsForTenant } from '../../../server/services/qbo/resolve-credentials';
import { resolveAi, isRefusal } from '../../../server/lib/ai/resolve-provider';
import { AI_REFUSAL_REASON } from '../../../server/lib/ai/refusal-reason';
import { getDeploymentProfile, SAAS_PROFILE, STANDALONE_PROFILE } from '../../../server/lib/deployment-profile';
import { resolveIntegrationSource } from '../../../server/lib/integrations/sources';

const T = '00000000-0000-0000-0000-0000000000bb';
const JWT_SECRET = 'secret32chars_aaaaaaaaaaaaaaaaaa';
let db: BetterSQLite3Database<typeof schema>;

function d1Shaped<X extends object>(target: X): X {
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

beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db;
    await setupSchema(fix.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(d1Shaped(db));
    await db.insert(schema.tenants).values({ id: T, slug: 'co', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function seedConfig(opts: { secrets?: Record<string, string>; sources?: Record<string, string>; smsMode?: 'platform' | 'own'; smsByoProvider?: 'telnyx' }) {
    const sealed = opts.secrets ? await sealSecrets(opts.secrets, T, JWT_SECRET) : null;
    await db.insert(schema.tenantConfigs).values({
        tenantId: T,
        ...(sealed ? { secretsEnc: sealed.blob, dekEnc: sealed.dekEnc } : {}),
        ...(opts.smsMode ? { smsMode: opts.smsMode } : {}),
        ...(opts.smsByoProvider ? { smsByoProvider: opts.smsByoProvider } : {}),
        ...(opts.sources ? { integrationConfig: JSON.stringify({ integrationSources: opts.sources }) } : {}),
        createdAt: new Date(), updatedAt: new Date(),
    } as never);
}

// ─── Email ────────────────────────────────────────────────────────────────────

const identity = (mode: 'platform' | 'own', senderEmail: string | null) => ({
    mode, senderEmail, replyTo: null, senderDisplayName: null, pointOfContact: 'company' as const, companyName: null,
});
const emailEnv = (extra: Partial<EmailServiceEnv> = {}): EmailServiceEnv => ({
    DB: {} as never, TENANT_CACHE: {} as never, JWT_SECRET,
    RESEND_API_KEY: 're_deployment', SENDER_EMAIL: 'noreply@deployment.test', APP_MODE: 'saas', ...extra,
});
async function sentWith(env: EmailServiceEnv, cfg: LoadedEmailConfig): Promise<string | null> {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'm' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await assembleTenantEmailService(env, cfg).sendEmail(['to@x.test'], 'S', '<p>x</p>');
    const call = fetchMock.mock.calls[0] as unknown as [string, unknown] | undefined;
    return call ? JSON.stringify(call[1]) : null;
}

describe('email with an explicit source', () => {
    // The legacy column says platform on purpose: the stored choice must win over it.
    const own = (secrets: LoadedEmailConfig['dbSecrets']): LoadedEmailConfig =>
        ({ emailIdentity: identity('platform', 'me@co.test'), dbSecrets: secrets, integrationSources: { email: 'own' } });

    it('own sends on the company key even though the legacy mode says platform', async () => {
        const sent = await sentWith(emailEnv(), own({ resendApiKey: 're_company' }));
        expect(sent).toContain('re_company');
        expect(sent).not.toContain('re_deployment');
    });

    it('own with no company key sends nothing; it never borrows the deployment key', async () => {
        expect(await sentWith(emailEnv(), own({}))).toBeNull();
    });

    const provided = (secrets: LoadedEmailConfig['dbSecrets']): LoadedEmailConfig =>
        ({ emailIdentity: identity('own', 'me@co.test'), dbSecrets: secrets, integrationSources: { email: 'provided' } });

    it('provided sends on the deployment key even though the legacy mode says own and the company has a key', async () => {
        const sent = await sentWith(emailEnv(), provided({ resendApiKey: 're_company' }));
        expect(sent).toContain('re_deployment');
        expect(sent).not.toContain('re_company');
    });

    it('provided never sends on the company key when the deployment has none (control above: deployment key present)', async () => {
        expect(await sentWith(emailEnv({ RESEND_API_KEY: '' }), provided({ resendApiKey: 're_company' }))).toBeNull();
    });

    it('provided does not send on a company key that a request-scoped env merge copied into RESEND_API_KEY', async () => {
        expect(await sentWith(emailEnv({ RESEND_API_KEY: 're_company' }), provided({ resendApiKey: 're_company' }))).toBeNull();
    });

    it('standalone with a stored provided choice sends nothing: that source is not offered there', async () => {
        const cfg = { ...provided({}), };
        expect(await sentWith(emailEnv({ APP_MODE: 'standalone' }), cfg)).toBeNull();
        // control: the same config with no stored choice sends on the operator env
        expect(await sentWith(emailEnv({ APP_MODE: 'standalone' }), { ...cfg, integrationSources: undefined })).toContain('re_deployment');
    });

    it('the stored choice is read from integration_config by the tenant email loader', async () => {
        await seedConfig({ sources: { email: 'own', sms: 'platform' } });
        const loaded = await loadTenantEmailConfig({ ...emailEnv(), DB: {} as never }, T);
        expect(loaded.integrationSources).toEqual({ email: 'own' });
        // control: a company with no choice loads none
        await db.delete(schema.tenantConfigs);
        await seedConfig({});
        expect((await loadTenantEmailConfig({ ...emailEnv(), DB: {} as never }, T)).integrationSources).toEqual({});
    });
});

// ─── SMS ──────────────────────────────────────────────────────────────────────

const OWN = { TWILIO_ACCOUNT_SID: 'ACown', TWILIO_AUTH_TOKEN: 'own-tok', TWILIO_FROM_NUMBER: '+15550001111' };
const DEP = { TWILIO_ACCOUNT_SID: 'ACdep', TWILIO_AUTH_TOKEN: 'dep-tok', TWILIO_FROM_NUMBER: '+15559998888' };
const MANAGED = { TWILIO_API_KEY_SID: 'SKdep', TWILIO_API_KEY_SECRET: 'sec', TWILIO_SHARED_MESSAGING_SERVICE_SID: 'MGdep' };
const smsEnv = (extra: Partial<TwilioLoaderEnv> = {}): TwilioLoaderEnv =>
    ({ DB: {} as never, TENANT_CACHE: undefined as never, JWT_SECRET, APP_MODE: 'saas', ...DEP, ...extra });

describe('sms with an explicit source', () => {
    it('hosted own uses the company number and ignores the legacy platform mode', async () => {
        await seedConfig({ sources: { sms: 'own' }, secrets: OWN });
        expect((await loadProviderForTenant(smsEnv(), T))?.from).toBe('+15550001111');
    });

    it('hosted own with incomplete company keys returns nothing even though the deployment has a number', async () => {
        await seedConfig({ sources: { sms: 'own' }, secrets: { TWILIO_ACCOUNT_SID: 'ACown' } });
        expect(await loadProviderForTenant(smsEnv(), T)).toBeNull();
    });

    it('hosted provided is held back while the flag is off, with a complete shared pool', async () => {
        await seedConfig({ sources: { sms: 'provided' }, secrets: OWN });
        expect(await loadProviderForTenant(smsEnv(MANAGED), T)).toBeNull();
    });

    it('hosted provided with the flag on uses the shared pool, never the company keys (control for the line above)', async () => {
        await seedConfig({ sources: { sms: 'provided' }, secrets: OWN });
        const r = await loadProviderForTenant(smsEnv({ ...MANAGED, SMS_MANAGED_SHARED_ENABLED: 'true' }), T);
        expect(r?.messagingServiceSid).toBe('MGdep');
        expect(r?.from).toBeNull();
    });

    it('hosted own telnyx needs the telnyx keys, and a stored choice makes mode irrelevant', async () => {
        await seedConfig({ sources: { sms: 'own' }, smsByoProvider: 'telnyx', secrets: { TELNYX_API_KEY: 'k', TELNYX_FROM_NUMBER: '+15550002222' } });
        expect(await loadProviderForTenant(smsEnv(), T)).not.toBeNull();
    });

    it('standalone own keeps the operator env as the fallback; a stored provided choice is not offered', async () => {
        await seedConfig({ sources: { sms: 'own' } });
        expect((await loadProviderForTenant(smsEnv({ APP_MODE: 'standalone' }), T))?.from).toBe('+15559998888');
        await db.delete(schema.tenantConfigs);
        await seedConfig({ sources: { sms: 'provided' } });
        expect(await loadProviderForTenant(smsEnv({ APP_MODE: 'standalone' }), T)).toBeNull();
    });
});

// ─── AI ───────────────────────────────────────────────────────────────────────

describe('ai with an explicit source', () => {
    const base = { aiEnabled: true, managedKey: 'platform-key', model: 'm', defaultBaseUrl: 'https://api.example.test/v1', managedEntitled: true, underCap: true };

    it('own with no key is refused as not configured and never uses the managed key', () => {
        const r = resolveAi({ ...base, profile: SAAS_PROFILE, tenantKey: null, sourceChoice: 'own' });
        expect(isRefusal(r) && r.refused).toBe(AI_REFUSAL_REASON.NOT_CONFIGURED);
        // control: no stored choice, same inputs, resolves to managed
        expect(resolveAi({ ...base, profile: SAAS_PROFILE, tenantKey: null })).toMatchObject({ source: 'managed' });
    });

    it('own with a key uses it', () => {
        expect(resolveAi({ ...base, profile: SAAS_PROFILE, tenantKey: 'k', sourceChoice: 'own' })).toMatchObject({ source: 'byo' });
    });

    it('provided ignores a stored company key (control: with no choice the key wins)', () => {
        expect(resolveAi({ ...base, profile: SAAS_PROFILE, tenantKey: 'k', sourceChoice: 'provided' })).toMatchObject({ source: 'managed' });
        expect(resolveAi({ ...base, profile: SAAS_PROFILE, tenantKey: 'k' })).toMatchObject({ source: 'byo' });
    });

    it('provided on a standalone deployment has no managed path', () => {
        const r = resolveAi({ ...base, profile: STANDALONE_PROFILE, tenantKey: 'k', sourceChoice: 'provided' });
        expect(isRefusal(r) && r.refused).toBe(AI_REFUSAL_REASON.UNAVAILABLE_HERE);
    });
});

// ─── Video ────────────────────────────────────────────────────────────────────

describe('video', () => {
    it('the provider branch and the unified resolver agree on whose video it is, on both profiles', async () => {
        const hostedProfile = getDeploymentProfile({ APP_MODE: 'saas' });
        const hosted = await resolveVideoProvider({ env: { STREAM: {} }, var: { profile: hostedProfile } } as never, T, db as never);
        expect(hosted.provider === 'r2' || hosted.provider === 'stream').toBe(true);
        expect(resolveIntegrationSource('video', hostedProfile, {}, {})).toMatchObject({ source: 'provided' });
        // The hosted resolver chose from the deployment's plan gate; the self-hosted one from the operator's setting.
        const selfProfile = getDeploymentProfile({});
        await seedConfig({});
        const self = await resolveVideoProvider({ env: {}, var: { profile: selfProfile } } as never, T, db as never);
        expect(self.provider).toBe('r2');
        expect(resolveIntegrationSource('video', selfProfile, { legacy: { videoMode: 'r2' } }, {})).toMatchObject({ source: 'own' });
    });
});

// ─── QuickBooks ───────────────────────────────────────────────────────────────

const qbo = (extra: Record<string, string> = {}) => ({ DB: {} as D1Database, JWT_SECRET, APP_MODE: 'saas', ...extra });
const QBO_DEP = { QBO_CLIENT_ID: 'dep-id', QBO_CLIENT_SECRET: 'dep-secret' };
const QBO_OWN = { QBO_CLIENT_ID: 'own-id', QBO_CLIENT_SECRET: 'own-secret' };

describe('quickbooks credentials with an explicit source', () => {
    it('hosted own uses only the company app, even when the deployment has one', async () => {
        await seedConfig({ secrets: QBO_OWN });
        const r = await resolveQboCredentialsForTenant(qbo(QBO_DEP), T, { quickbooks: 'own' });
        expect(r.credentials).toMatchObject({ clientId: 'own-id', clientSecret: 'own-secret' });
        // control: the same row with no stored choice gives the deployment app
        expect((await resolveQboCredentialsForTenant(qbo(QBO_DEP), T)).credentials).toMatchObject({ clientId: 'dep-id' });
    });

    it('hosted own with no company app never falls back to the deployment app', async () => {
        await seedConfig({});
        expect(await resolveQboCredentialsForTenant(qbo(QBO_DEP), T, { quickbooks: 'own' }))
            .toEqual({ credentials: null, missing: ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET'] });
    });

    it('hosted provided uses only the deployment app, even when the company has one', async () => {
        await seedConfig({ secrets: QBO_OWN });
        expect((await resolveQboCredentialsForTenant(qbo(QBO_DEP), T, { quickbooks: 'provided' })).credentials)
            .toMatchObject({ clientId: 'dep-id', clientSecret: 'dep-secret' });
        // control: with no deployment app it resolves to nothing rather than to the company app
        expect((await resolveQboCredentialsForTenant(qbo(), T, { quickbooks: 'provided' })).credentials).toBeNull();
    });

    it('standalone own still merges the operator env; a stored provided choice is not offered', async () => {
        await seedConfig({ secrets: { QBO_CLIENT_SECRET: 'own-secret' } });
        expect((await resolveQboCredentialsForTenant(qbo({ APP_MODE: 'standalone', QBO_CLIENT_ID: 'op-id' }), T, { quickbooks: 'own' })).credentials)
            .toMatchObject({ clientId: 'op-id', clientSecret: 'own-secret' });
        expect((await resolveQboCredentialsForTenant(qbo({ APP_MODE: 'standalone', ...QBO_DEP }), T, { quickbooks: 'provided' })).credentials).toBeNull();
    });
});
