/**
 * A hosted company that saved a COMPLETE own SMS account while its stored mode is
 * still a retired one (`platform`, the column default, or no config row at all;
 * or `managed_shared`) is on its own account everywhere: the source resolver, the
 * send gate, the provider loader and the settings label. Incomplete keys stay
 * "not configured", and a retired mode never borrows the deployment's account.
 *
 * Each negative case sits beside a positive control that flips one input.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { sealSecrets } from '../../../server/lib/config-crypto';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import {
    loadProviderForTenant, loadTwilioForTenant, resolveTwilioSourceForTenant, type TwilioLoaderEnv,
} from '../../../server/lib/sms/resolve-twilio';
import { managedSendAllowed } from '../../../server/lib/sms/managed-send-gate';
import { integrationSources } from '../../../server/lib/integrations/source-overview';
import { resolveIntegrationSource } from '../../../server/lib/integrations/sources';
import { SAAS_PROFILE, STANDALONE_PROFILE } from '../../../server/lib/deployment-profile';

const T = '00000000-0000-0000-0000-0000000000cc';
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
afterEach(() => vi.restoreAllMocks());

const OWN = { TWILIO_ACCOUNT_SID: 'ACown', TWILIO_AUTH_TOKEN: 'own-tok', TWILIO_FROM_NUMBER: '+15550001111' };
const PARTIAL = { TWILIO_ACCOUNT_SID: 'ACown', TWILIO_AUTH_TOKEN: 'own-tok' };
const DEP = { TWILIO_ACCOUNT_SID: 'ACdep', TWILIO_AUTH_TOKEN: 'dep-tok', TWILIO_FROM_NUMBER: '+15559998888' };
const API_KEY = { TWILIO_API_KEY_SID: 'SKdep', TWILIO_API_KEY_SECRET: 'sec' };
const smsEnv = (extra: Partial<TwilioLoaderEnv> = {}): TwilioLoaderEnv =>
    ({ DB: {} as never, TENANT_CACHE: undefined as never, JWT_SECRET, APP_MODE: 'saas', ...DEP, ...extra });

async function seed(opts: { secrets?: Record<string, string>; smsMode?: 'platform' | 'own' | 'managed_shared' | 'managed_dedicated' }) {
    const sealed = opts.secrets ? await sealSecrets(opts.secrets, T, JWT_SECRET) : null;
    await db.insert(schema.tenantConfigs).values({
        tenantId: T,
        ...(sealed ? { secretsEnc: sealed.blob, dekEnc: sealed.dekEnc } : {}),
        ...(opts.smsMode ? { smsMode: opts.smsMode } : {}),
        createdAt: new Date(), updatedAt: new Date(),
    } as never);
}
async function seedRegistration(status: 'approved' | 'profile_pending', resourceSid: string | null) {
    const now = new Date();
    await db.insert(schema.messagingCompliance).values({
        tenantId: T, mode: 'managed_dedicated', complianceStatus: status, messagingResourceSid: resourceSid, createdAt: now, updatedAt: now,
    } as never);
}

// ─── The source and the card ─────────────────────────────────────────────────

describe('source resolver: a retired legacy mode with a complete own account', () => {
    const ownSecrets = OWN;
    it.each(['platform', 'managed_shared'] as const)('hosted + %s + complete keys resolves to own and reads as connected', (smsMode) => {
        const company = { legacy: { smsMode }, ownSecrets };
        expect(resolveIntegrationSource('sms', SAAS_PROFILE, company, {})).toMatchObject({ source: 'own', credentialsPresent: true });
        expect(integrationSources(SAAS_PROFILE, company, {}).find((r) => r.service === 'sms')).toMatchObject({ current: 'own', state: 'connected' });
    });

    it('a company with no config row at all and complete keys is the same', () => {
        expect(resolveIntegrationSource('sms', SAAS_PROFILE, { ownSecrets }, {})).toMatchObject({ source: 'own' });
    });

    it('control: incomplete keys stay not configured (attention, since half were entered)', () => {
        const company = { legacy: { smsMode: 'platform' as const }, ownSecrets: PARTIAL };
        expect(resolveIntegrationSource('sms', SAAS_PROFILE, company, {})).toMatchObject({ source: 'unavailable' });
        expect(integrationSources(SAAS_PROFILE, company, {}).find((r) => r.service === 'sms')).toMatchObject({ current: 'unavailable', state: 'not_connected' });
    });

    it('control: managed_shared without keys stays unusable', () => {
        expect(resolveIntegrationSource('sms', SAAS_PROFILE, { legacy: { smsMode: 'managed_shared' } }, {})).toMatchObject({ source: 'unavailable' });
    });

    it('control: a registered number is not turned into own by keys it also holds', () => {
        const r = resolveIntegrationSource('sms', SAAS_PROFILE, { legacy: { smsMode: 'managed_dedicated' }, ownSecrets, dedicatedNumberReady: false }, {});
        expect(r).toMatchObject({ source: 'unavailable', reason: 'dedicated_not_ready' });
    });
});

// ─── The send gate ───────────────────────────────────────────────────────────

describe('send gate: a retired mode with a complete own account', () => {
    const gateEnv = (extra: object = {}) => ({ APP_MODE: 'saas', DB: {} as D1Database, JWT_SECRET, ...extra });

    it.each(['platform', 'managed_shared'] as const)('hosted + %s + complete keys is allowed and sends as own', async (mode) => {
        await seed({ smsMode: mode, secrets: OWN });
        expect(await managedSendAllowed(db as never, gateEnv(), T, mode)).toEqual({ allowed: true, resolvedMode: 'own' });
    });

    it('control: incomplete keys are refused as not configured', async () => {
        await seed({ smsMode: 'platform', secrets: PARTIAL });
        expect(await managedSendAllowed(db as never, gateEnv(), T, 'platform')).toEqual({ allowed: false, reason: 'sms not configured' });
    });

    it('control: managed_shared with no keys is refused', async () => {
        await seed({ smsMode: 'managed_shared' });
        expect(await managedSendAllowed(db as never, gateEnv(), T, 'managed_shared')).toEqual({ allowed: false, reason: 'sms not configured' });
    });

    it('without the bindings to open the keys it fails closed, even if the keys would be complete', async () => {
        await seed({ smsMode: 'platform', secrets: OWN });
        expect(await managedSendAllowed(db as never, { APP_MODE: 'saas' }, T, 'platform')).toEqual({ allowed: false, reason: 'sms not configured' });
    });
});

// ─── The provider loader ─────────────────────────────────────────────────────

describe('provider loader: legacy mode, own account and the deployment account', () => {
    it.each(['platform', 'managed_shared'] as const)('hosted + %s + complete keys sends from the company number', async (smsMode) => {
        await seed({ smsMode, secrets: OWN });
        expect((await loadProviderForTenant(smsEnv(), T))?.from).toBe('+15550001111');
        expect((await loadTwilioForTenant(smsEnv(), T))?.sid).toBe('ACown');
    });

    it('hosted + platform + incomplete keys is null even though the deployment has a full account', async () => {
        await seed({ smsMode: 'platform', secrets: PARTIAL });
        expect(await loadProviderForTenant(smsEnv(), T)).toBeNull();
        expect(await loadTwilioForTenant(smsEnv(), T)).toBeNull();
    });

    it('hosted + own with partial keys does NOT fall back to the deployment credentials', async () => {
        await seed({ smsMode: 'own', secrets: PARTIAL });
        expect(await loadProviderForTenant(smsEnv(), T)).toBeNull();
        expect(await loadTwilioForTenant(smsEnv(), T)).toBeNull();
    });

    it('control: self-hosted + own with partial keys still falls back to the operator env', async () => {
        await seed({ smsMode: 'own', secrets: PARTIAL });
        expect((await loadProviderForTenant(smsEnv({ APP_MODE: 'standalone' }), T))?.from).toBe('+15559998888');
        expect((await loadTwilioForTenant(smsEnv({ APP_MODE: 'standalone' }), T))?.sid).toBe('ACdep');
    });

    it('hosted + managed_dedicated with an incomplete bag is null; it never falls through to deployment or own credentials', async () => {
        // Own keys complete AND a full deployment account, but no Messaging Service SID: no bag.
        await seed({ smsMode: 'managed_dedicated', secrets: OWN });
        expect(await loadProviderForTenant(smsEnv(API_KEY), T)).toBeNull();
        expect(await loadTwilioForTenant(smsEnv(API_KEY), T)).toBeNull();
    });

    it('control: the same company with a Messaging Service and the API key pair resolves the dedicated send', async () => {
        await seed({ smsMode: 'managed_dedicated', secrets: OWN });
        await seedRegistration('approved', 'MGdedicated');
        const r = await loadProviderForTenant(smsEnv(API_KEY), T);
        expect(r?.messagingServiceSid).toBe('MGdedicated');
    });

    it('hosted + managed_dedicated without the API key pair is null (the cron used to drop the pair)', async () => {
        await seed({ smsMode: 'managed_dedicated' });
        await seedRegistration('approved', 'MGdedicated');
        expect(await loadProviderForTenant(smsEnv(), T)).toBeNull();
    });
});

describe('settings label', () => {
    it('hosted legacy platform with complete keys is labelled own; incomplete is none', async () => {
        const tenant = { TWILIO_ACCOUNT_SID: 'ACown', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+1555' };
        expect(await resolveTwilioSourceForTenant(smsEnv(), T, 'platform', tenant, DEP)).toBe('own');
        expect(await resolveTwilioSourceForTenant(smsEnv(), T, 'platform', { TWILIO_ACCOUNT_SID: 'ACown' }, DEP)).toBe('none');
    });

    it('hosted own with partial keys is none, not the deployment account; self-hosted keeps the label', async () => {
        const partial = { TWILIO_ACCOUNT_SID: 'ACown' };
        expect(await resolveTwilioSourceForTenant(smsEnv(), T, 'own', partial, DEP)).toBe('none');
        expect(await resolveTwilioSourceForTenant(smsEnv({ APP_MODE: 'standalone' }), T, 'own', partial, DEP)).toBe('platform');
        expect(STANDALONE_PROFILE.hasManagedCompliance).toBe(false);
    });
});

// ─── A number that is approved but cannot be signed for ─────────────────────

describe('registered number the deployment cannot send on', () => {
    const base = { legacy: { smsMode: 'managed_dedicated' as const }, dedicatedNumberReady: true };

    it('is not connected: attention with its own reason', () => {
        const company = { ...base, deploymentSmsSendReady: false };
        expect(resolveIntegrationSource('sms', SAAS_PROFILE, company, {})).toMatchObject({ source: 'unavailable', reason: 'dedicated_unavailable' });
        expect(integrationSources(SAAS_PROFILE, company, {}).find((r) => r.service === 'sms')).toMatchObject({ state: 'attention' });
    });

    it('control: with the deployment credentials present it is connected as before', () => {
        expect(resolveIntegrationSource('sms', SAAS_PROFILE, { ...base, deploymentSmsSendReady: true }, {}))
            .toMatchObject({ source: 'own', reason: 'dedicated_number' });
    });
});
