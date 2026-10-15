/**
 * The unified source resolver: for each integration service, whether a company
 * runs on the deployment's credentials ('provided') or its own ('own').
 *
 * Every negative assertion below ("own never falls back") is paired with a
 * positive control that flips exactly one input, so a resolver that simply
 * returns 'unavailable' for everything cannot pass.
 */
import { describe, it, expect } from 'vitest';
import { getDeploymentProfile } from '../../../server/lib/deployment-profile';
import {
    INTEGRATION_SERVICES,
    resolveIntegrationSource,
    offeredSources,
    type CompanyIntegrationConfig,
    type IntegrationEnv,
} from '../../../server/lib/integrations/sources';

const HOSTED = getDeploymentProfile({ APP_MODE: 'saas' });
const SELF = getDeploymentProfile({});

const FULL_RESEND: IntegrationEnv = { RESEND_API_KEY: 're_dep', SENDER_EMAIL: 'noreply@dep.test' };
const FULL_TWILIO_OWN = {
    TWILIO_ACCOUNT_SID: 'ACown', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM_NUMBER: '+15550001111',
};
const FULL_MANAGED_ENV: IntegrationEnv = {
    TWILIO_ACCOUNT_SID: 'ACdep', TWILIO_API_KEY_SID: 'SKdep', TWILIO_API_KEY_SECRET: 'sec',
    TWILIO_SHARED_MESSAGING_SERVICE_SID: 'MGdep',
};

const cfg = (c: CompanyIntegrationConfig = {}): CompanyIntegrationConfig => c;

describe('catalog', () => {
    it('covers email, sms, ai, video and quickbooks', () => {
        expect([...INTEGRATION_SERVICES].sort()).toEqual(['ai', 'email', 'quickbooks', 'sms', 'video']);
    });

    it('standalone profiles only ever offer own (control: hosted offers provided)', () => {
        for (const s of INTEGRATION_SERVICES) {
            expect(offeredSources(s, SELF, {})).toEqual(['own']);
        }
        expect(offeredSources('email', HOSTED, {})).toEqual(['provided', 'own']);
        expect(offeredSources('ai', HOSTED, {})).toEqual(['provided', 'own']);
        expect(offeredSources('quickbooks', HOSTED, {})).toEqual(['provided', 'own']);
    });

    it('email offers provided from its own capability, not from a quota capability', () => {
        expect(HOSTED.providesEmailSource).toBe(true);
        expect(SELF.providesEmailSource).toBe(false);
        // Flip each capability alone: only providesEmailSource moves the offer.
        expect(offeredSources('email', { ...HOSTED, hasUsageQuota: false }, {})).toEqual(['provided', 'own']);
        expect(offeredSources('email', { ...SELF, hasUsageQuota: true }, {})).toEqual(['own']);
        expect(offeredSources('email', { ...SELF, providesEmailSource: true }, {})).toEqual(['provided', 'own']);
    });

    it('hosted video has no own (control: standalone video is own only)', () => {
        expect(offeredSources('video', HOSTED, {})).toEqual(['provided']);
        expect(offeredSources('video', SELF, {})).toEqual(['own']);
    });

    it('hosted sms offers own only while the shared-number flag is off, provided too when it is on', () => {
        expect(offeredSources('sms', HOSTED, {})).toEqual(['own']);
        expect(offeredSources('sms', HOSTED, { SMS_MANAGED_SHARED_ENABLED: 'true' })).toEqual(['provided', 'own']);
    });
});

describe('email', () => {
    it('hosted, nothing stored: provided, and present only when the deployment key and sender exist', () => {
        expect(resolveIntegrationSource('email', HOSTED, cfg(), FULL_RESEND))
            .toMatchObject({ source: 'provided', credentialsPresent: true, choice: 'default' });
        expect(resolveIntegrationSource('email', HOSTED, cfg(), {}))
            .toMatchObject({ source: 'unavailable', reason: 'provided_not_configured', credentialsPresent: false });
    });

    it('hosted, legacy email_mode own with complete credentials: own', () => {
        const c = cfg({ legacy: { emailMode: 'own' }, senderEmail: 'me@co.test', ownSecrets: { RESEND_API_KEY: 're_own' } });
        expect(resolveIntegrationSource('email', HOSTED, c, FULL_RESEND))
            .toMatchObject({ source: 'own', credentialsPresent: true, reason: 'legacy_setting' });
    });

    it('explicit own with incomplete credentials never falls back to the deployment key', () => {
        const incomplete = cfg({ sources: { email: 'own' }, ownSecrets: {} });
        expect(resolveIntegrationSource('email', HOSTED, incomplete, FULL_RESEND))
            .toMatchObject({ source: 'unavailable', reason: 'own_credentials_incomplete', credentialsPresent: false, choice: 'explicit' });
        // control: the same choice with complete credentials resolves to own
        const complete = cfg({ sources: { email: 'own' }, senderEmail: 'me@co.test', ownSecrets: { RESEND_API_KEY: 're_own' } });
        expect(resolveIntegrationSource('email', HOSTED, complete, FULL_RESEND))
            .toMatchObject({ source: 'own', credentialsPresent: true, reason: 'explicit_choice' });
    });

    it('explicit own on a non-default provider needs that providers keys, not Resend', () => {
        const c = cfg({ sources: { email: 'own' }, emailByoProvider: 'mailgun', senderEmail: 'me@co.test', ownSecrets: { RESEND_API_KEY: 're_own', MAILGUN_API_KEY: 'k' } });
        expect(resolveIntegrationSource('email', HOSTED, c, {})).toMatchObject({ source: 'unavailable', reason: 'own_credentials_incomplete' });
        const done = cfg({ ...c, ownSecrets: { MAILGUN_API_KEY: 'k', MAILGUN_DOMAIN: 'mg.co.test' } });
        expect(resolveIntegrationSource('email', HOSTED, done, {})).toMatchObject({ source: 'own' });
    });

    it('explicit provided never reads the company stored credentials', () => {
        const c = cfg({ sources: { email: 'provided' }, senderEmail: 'me@co.test', ownSecrets: { RESEND_API_KEY: 're_own' } });
        expect(resolveIntegrationSource('email', HOSTED, c, {}))
            .toMatchObject({ source: 'unavailable', reason: 'provided_not_configured', credentialsPresent: false });
        // control: with the deployment key present it resolves, still without touching the company key
        expect(resolveIntegrationSource('email', HOSTED, c, FULL_RESEND))
            .toMatchObject({ source: 'provided', credentialsPresent: true, choice: 'explicit' });
    });

    it('standalone: explicit provided is not offered (control: unset resolves to own)', () => {
        expect(resolveIntegrationSource('email', SELF, cfg({ sources: { email: 'provided' } }), FULL_RESEND))
            .toMatchObject({ source: 'unavailable', reason: 'not_offered' });
        expect(resolveIntegrationSource('email', SELF, cfg(), FULL_RESEND))
            .toMatchObject({ source: 'own', credentialsPresent: true });
    });

    it('standalone: the operator env counts as the company own credentials; nothing at all does not', () => {
        expect(resolveIntegrationSource('email', SELF, cfg(), {})).toMatchObject({ source: 'unavailable', credentialsPresent: false });
        const saved = cfg({ ownSecrets: { RESEND_API_KEY: 're_own' }, senderEmail: 'me@co.test' });
        expect(resolveIntegrationSource('email', SELF, saved, {})).toMatchObject({ source: 'own', credentialsPresent: true });
    });
});

describe('sms', () => {
    it('hosted provided is held back while the flag is off, even with a complete shared pool', () => {
        for (const c of [cfg(), cfg({ sources: { sms: 'provided' } })]) {
            expect(resolveIntegrationSource('sms', HOSTED, c, FULL_MANAGED_ENV))
                .toMatchObject({ source: 'unavailable', reason: 'provider_confirmation_pending' });
        }
        // control: flag on + complete pool resolves; flag on + incomplete pool does not
        const on = { ...FULL_MANAGED_ENV, SMS_MANAGED_SHARED_ENABLED: 'true' };
        expect(resolveIntegrationSource('sms', HOSTED, cfg({ sources: { sms: 'provided' } }), on))
            .toMatchObject({ source: 'provided', credentialsPresent: true });
        expect(resolveIntegrationSource('sms', HOSTED, cfg({ sources: { sms: 'provided' } }), { SMS_MANAGED_SHARED_ENABLED: 'true' }))
            .toMatchObject({ source: 'unavailable', reason: 'provided_not_configured' });
    });

    it('the flag only turns on for an explicit true or 1', () => {
        for (const v of ['', 'false', '0', 'yes', undefined]) {
            expect(offeredSources('sms', HOSTED, { SMS_MANAGED_SHARED_ENABLED: v })).toEqual(['own']);
        }
        for (const v of ['true', '1']) {
            expect(offeredSources('sms', HOSTED, { SMS_MANAGED_SHARED_ENABLED: v })).toEqual(['provided', 'own']);
        }
    });

    it('hosted own works with the company Twilio keys and never borrows the deployment keys', () => {
        const dep: IntegrationEnv = { TWILIO_ACCOUNT_SID: 'ACdep', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+15559998888' };
        const missing = cfg({ sources: { sms: 'own' }, ownSecrets: { TWILIO_ACCOUNT_SID: 'ACown' } });
        expect(resolveIntegrationSource('sms', HOSTED, missing, dep))
            .toMatchObject({ source: 'unavailable', reason: 'own_credentials_incomplete' });
        expect(resolveIntegrationSource('sms', HOSTED, cfg({ sources: { sms: 'own' }, ownSecrets: FULL_TWILIO_OWN }), dep))
            .toMatchObject({ source: 'own', credentialsPresent: true });
    });

    it('telnyx own needs the telnyx keys', () => {
        const base = cfg({ sources: { sms: 'own' }, smsByoProvider: 'telnyx', ownSecrets: FULL_TWILIO_OWN });
        expect(resolveIntegrationSource('sms', HOSTED, base, {})).toMatchObject({ source: 'unavailable', reason: 'own_credentials_incomplete' });
        const ok = cfg({ ...base, ownSecrets: { TELNYX_API_KEY: 'k', TELNYX_FROM_NUMBER: '+15550002222' } });
        expect(resolveIntegrationSource('sms', HOSTED, ok, {})).toMatchObject({ source: 'own' });
    });

    it('hosted, nothing stored, legacy own: own; legacy platform or managed: provided (held back)', () => {
        const own = cfg({ legacy: { smsMode: 'own' }, ownSecrets: FULL_TWILIO_OWN });
        expect(resolveIntegrationSource('sms', HOSTED, own, {})).toMatchObject({ source: 'own', reason: 'legacy_setting' });
        for (const m of ['platform', 'managed_shared', 'managed_dedicated'] as const) {
            expect(resolveIntegrationSource('sms', HOSTED, cfg({ legacy: { smsMode: m } }), {}))
                .toMatchObject({ source: 'unavailable', reason: 'provider_confirmation_pending' });
        }
    });

    it('standalone: only own, with the operator env as fallback', () => {
        const env: IntegrationEnv = { TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+15550003333' };
        expect(resolveIntegrationSource('sms', SELF, cfg({ legacy: { smsMode: 'platform' } }), env))
            .toMatchObject({ source: 'own', credentialsPresent: true });
        expect(resolveIntegrationSource('sms', SELF, cfg({ sources: { sms: 'provided' } }), {}))
            .toMatchObject({ source: 'unavailable', reason: 'not_offered' });
    });
});

describe('ai', () => {
    it('hosted legacy: a stored key means own, otherwise provided', () => {
        const dep: IntegrationEnv = { AI_MANAGED_API_KEY: 'k' };
        expect(resolveIntegrationSource('ai', HOSTED, cfg({ ownSecrets: { GEMINI_API_KEY: 'g' } }), dep))
            .toMatchObject({ source: 'own', reason: 'legacy_setting' });
        expect(resolveIntegrationSource('ai', HOSTED, cfg(), dep)).toMatchObject({ source: 'provided', credentialsPresent: true });
    });

    it('explicit provided ignores the company key; explicit own never uses the deployment key', () => {
        const dep: IntegrationEnv = { AI_MANAGED_API_KEY: 'k' };
        const stored = { GEMINI_API_KEY: 'g' };
        expect(resolveIntegrationSource('ai', HOSTED, cfg({ sources: { ai: 'provided' }, ownSecrets: stored }), dep))
            .toMatchObject({ source: 'provided', choice: 'explicit' });
        expect(resolveIntegrationSource('ai', HOSTED, cfg({ sources: { ai: 'provided' }, ownSecrets: stored }), {}))
            .toMatchObject({ source: 'unavailable', reason: 'provided_not_configured' });
        expect(resolveIntegrationSource('ai', HOSTED, cfg({ sources: { ai: 'own' } }), dep))
            .toMatchObject({ source: 'unavailable', reason: 'own_credentials_incomplete' });
        expect(resolveIntegrationSource('ai', HOSTED, cfg({ sources: { ai: 'own' }, ownSecrets: stored }), dep))
            .toMatchObject({ source: 'own' });
    });

    it('a vertex service account counts as a deployment credential', () => {
        expect(resolveIntegrationSource('ai', HOSTED, cfg(), { AI_VERTEX_SERVICE_ACCOUNT: '{}' }))
            .toMatchObject({ source: 'provided', credentialsPresent: true });
    });
});

describe('video', () => {
    it('hosted: provided only. An explicit own is not offered (control: explicit provided resolves)', () => {
        expect(resolveIntegrationSource('video', HOSTED, cfg({ sources: { video: 'own' } }), {}))
            .toMatchObject({ source: 'unavailable', reason: 'not_offered' });
        expect(resolveIntegrationSource('video', HOSTED, cfg({ sources: { video: 'provided' } }), {}))
            .toMatchObject({ source: 'provided', credentialsPresent: true });
        expect(resolveIntegrationSource('video', HOSTED, cfg(), {})).toMatchObject({ source: 'provided' });
    });

    it('self-host: own is the operator binding and subdomain', () => {
        expect(resolveIntegrationSource('video', SELF, cfg({ legacy: { videoMode: 'r2' } }), {}))
            .toMatchObject({ source: 'own', credentialsPresent: true });
        const stream = cfg({ legacy: { videoMode: 'stream' }, streamSubdomain: 'customer-abc' });
        expect(resolveIntegrationSource('video', SELF, stream, {})).toMatchObject({ source: 'unavailable', reason: 'own_credentials_incomplete' });
        expect(resolveIntegrationSource('video', SELF, stream, { STREAM: {} })).toMatchObject({ source: 'own', credentialsPresent: true });
        expect(resolveIntegrationSource('video', SELF, cfg({ legacy: { videoMode: 'stream' } }), { STREAM: {} }))
            .toMatchObject({ source: 'unavailable', reason: 'own_credentials_incomplete' });
    });
});

describe('quickbooks app credentials', () => {
    const dep: IntegrationEnv = { QBO_CLIENT_ID: 'dep-id', QBO_CLIENT_SECRET: 'dep-secret' };
    const own = { QBO_CLIENT_ID: 'own-id', QBO_CLIENT_SECRET: 'own-secret' };

    it('hosted legacy: the deployment app wins when it exists, the company app fills in when it does not', () => {
        expect(resolveIntegrationSource('quickbooks', HOSTED, cfg({ ownSecrets: own }), dep))
            .toMatchObject({ source: 'provided', reason: 'legacy_setting' });
        expect(resolveIntegrationSource('quickbooks', HOSTED, cfg({ ownSecrets: own }), {}))
            .toMatchObject({ source: 'own', reason: 'legacy_setting' });
        expect(resolveIntegrationSource('quickbooks', HOSTED, cfg(), {}))
            .toMatchObject({ source: 'unavailable', reason: 'provided_not_configured' });
    });

    it('explicit own uses only the company pair, explicit provided only the deployment pair', () => {
        expect(resolveIntegrationSource('quickbooks', HOSTED, cfg({ sources: { quickbooks: 'own' } }), dep))
            .toMatchObject({ source: 'unavailable', reason: 'own_credentials_incomplete' });
        expect(resolveIntegrationSource('quickbooks', HOSTED, cfg({ sources: { quickbooks: 'own' }, ownSecrets: own }), dep))
            .toMatchObject({ source: 'own' });
        expect(resolveIntegrationSource('quickbooks', HOSTED, cfg({ sources: { quickbooks: 'provided' }, ownSecrets: own }), {}))
            .toMatchObject({ source: 'unavailable', reason: 'provided_not_configured' });
        expect(resolveIntegrationSource('quickbooks', HOSTED, cfg({ sources: { quickbooks: 'provided' }, ownSecrets: own }), dep))
            .toMatchObject({ source: 'provided' });
    });

    it('standalone: own, with each key taken from the env or the company row', () => {
        expect(resolveIntegrationSource('quickbooks', SELF, cfg({ ownSecrets: own }), {})).toMatchObject({ source: 'own', credentialsPresent: true });
        expect(resolveIntegrationSource('quickbooks', SELF, cfg({ ownSecrets: { QBO_CLIENT_ID: 'x' } }), { QBO_CLIENT_SECRET: 'y' }))
            .toMatchObject({ source: 'own', credentialsPresent: true });
        expect(resolveIntegrationSource('quickbooks', SELF, cfg(), {})).toMatchObject({ source: 'unavailable', credentialsPresent: false });
    });
});
