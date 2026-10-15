/**
 * The Integrations overview: one card per outside service, built from the
 * deployment profile, the deployment's own environment and what the company has
 * stored. Every status comes from data; nothing here is a constant.
 */
import { describe, it, expect } from 'vitest';
import { getDeploymentProfile } from '../../../server/lib/deployment-profile';
import {
    buildIntegrationOverview,
    type IntegrationCard,
    type OverviewInputs,
} from '../../../server/lib/integrations/overview';

const HOSTED = getDeploymentProfile({ APP_MODE: 'saas' });
const SELF = getDeploymentProfile({});

const DEPLOYMENT_ENV = {
    RESEND_API_KEY: 're_dep',
    SENDER_EMAIL: 'noreply@dep.test',
    AI_MANAGED_API_KEY: 'ai_dep',
    QBO_CLIENT_ID: 'qid',
    QBO_CLIENT_SECRET: 'qsecret',
    GOOGLE_CLIENT_ID: 'gid',
    GOOGLE_CLIENT_SECRET: 'gsecret',
    GOOGLE_PLACES_API_KEY: 'places_dep',
    ESTATED_API_KEY: 'estated_dep',
};

function inputs(over: Partial<OverviewInputs> = {}): OverviewInputs {
    return {
        profile: HOSTED,
        company: {},
        env: {},
        quickbooksConnected: false,
        calendarConnected: false,
        ...over,
    };
}
const card = (cards: IntegrationCard[], id: string): IntegrationCard => {
    const found = cards.find((c) => c.id === id);
    if (!found) throw new Error(`no card ${id}`);
    return found;
};

describe('card list shape', () => {
    it('returns the services in the design order, each once, each with a place to go', () => {
        const cards = buildIntegrationOverview(inputs());
        expect(cards.map((c) => c.id)).toEqual([
            'stripe', 'quickbooks', 'googleCalendar', 'email', 'sms', 'places', 'estated', 'video', 'ai',
        ]);
        expect(cards.map((c) => c.category)).toEqual([
            'payments', 'accounting', 'calendar', 'messaging', 'messaging', 'data', 'data', 'video', 'ai',
        ]);
        for (const c of cards) expect(c.detailPath, c.id).toMatch(/^\/[a-z]/);
        // the Stripe keys and the video backend are still panels on the Integrations page itself
        expect(card(cards, 'stripe').detailPath).toBe('/settings/integrations#stripe');
        expect(card(cards, 'video').detailPath).toBe('/settings/integrations#video');
    });
});

describe('self-hosted never returns provided', () => {
    it('whatever the operator environment holds', () => {
        const withEnv = buildIntegrationOverview(inputs({ profile: SELF, env: DEPLOYMENT_ENV }));
        const bare = buildIntegrationOverview(inputs({ profile: SELF }));
        for (const c of [...withEnv, ...bare]) expect(c.source, c.id).not.toBe('provided');
        // control: the same environment on a hosted deployment does provide services
        const hosted = buildIntegrationOverview(inputs({ env: DEPLOYMENT_ENV }));
        expect(hosted.filter((c) => c.source === 'provided').length).toBeGreaterThan(0);
    });

    it('treats the operator environment as the company\'s own keys', () => {
        const cards = buildIntegrationOverview(inputs({ profile: SELF, env: DEPLOYMENT_ENV }));
        expect(card(cards, 'email')).toMatchObject({ source: 'own', status: 'connected' });
        expect(card(cards, 'places')).toMatchObject({ source: 'own', status: 'connected' });
        expect(card(cards, 'estated')).toMatchObject({ source: 'own', status: 'connected' });
        // a stored AI key is the only thing that makes AI the company's own; the deployment's does not count
        expect(card(cards, 'ai')).toMatchObject({ status: 'not_connected' });
        expect(card(cards, 'ai').source).not.toBe('provided');
    });

    it('offers no switch to Built-in on any card', () => {
        for (const c of buildIntegrationOverview(inputs({ profile: SELF, env: DEPLOYMENT_ENV }))) {
            expect(c.canUseOwn, c.id).toBe(false);
        }
    });
});

describe('hosted deployment', () => {
    const cards = buildIntegrationOverview(inputs({ env: DEPLOYMENT_ENV }));

    it('provides the services the deployment supplies', () => {
        for (const id of ['email', 'ai', 'video', 'quickbooks', 'googleCalendar', 'places', 'estated']) {
            expect(card(cards, id).source, id).toBe('provided');
        }
    });

    it('can switch to Your own only for email, SMS and AI', () => {
        expect(cards.filter((c) => c.canUseOwn).map((c) => c.id)).toEqual(['email', 'sms', 'ai']);
    });

    it('holds back the built-in SMS number: unavailable, with the reason, but Your own can be used', () => {
        expect(card(cards, 'sms')).toMatchObject({
            source: 'unavailable',
            status: 'not_connected',
            canUseOwn: true,
            reasonKey: 'integrations_source_reason_provider_confirmation_pending',
        });
    });

    it('reads Stripe as the company\'s own account, never the deployment\'s', () => {
        expect(card(cards, 'stripe').source).toBe('own');
        const withDeploymentKey = buildIntegrationOverview(inputs({ env: { ...DEPLOYMENT_ENV, STRIPE_SECRET_KEY: 'sk_dep' } }));
        expect(card(withDeploymentKey, 'stripe')).toMatchObject({ source: 'own', status: 'not_connected' });
    });

    it('a company that chose its own email with incomplete keys is not shown as connected on the deployment\'s sender', () => {
        const own = buildIntegrationOverview(inputs({
            env: DEPLOYMENT_ENV,
            company: { sources: { email: 'own' }, ownSecrets: { RESEND_API_KEY: 're_own' } },
        }));
        // sender address is missing, so own is incomplete
        expect(card(own, 'email')).toMatchObject({ source: 'unavailable', status: 'attention', reasonKey: 'integrations_source_reason_own_credentials_incomplete' });
        // control: complete own keys are connected and Your own
        const complete = buildIntegrationOverview(inputs({
            env: DEPLOYMENT_ENV,
            company: { sources: { email: 'own' }, senderEmail: 'me@mine.test', ownSecrets: { RESEND_API_KEY: 're_own' } },
        }));
        expect(card(complete, 'email')).toMatchObject({ source: 'own', status: 'connected', reasonKey: null });
    });

    it('the company\'s stored Places key is Your own only when the deployment has none', () => {
        const env = { ...DEPLOYMENT_ENV, GOOGLE_PLACES_API_KEY: undefined };
        const stored = buildIntegrationOverview(inputs({ env, company: { ownSecrets: { GOOGLE_PLACES_API_KEY: 'mine' } } }));
        expect(card(stored, 'places')).toMatchObject({ source: 'own', status: 'connected' });
        const none = buildIntegrationOverview(inputs({ env }));
        expect(card(none, 'places')).toMatchObject({ source: 'unavailable', status: 'not_connected' });
    });
});

describe('statuses come from data', () => {
    it('no key stored and none in the deployment reads Not connected, not Connected', () => {
        const cards = buildIntegrationOverview(inputs({ profile: SELF }));
        // video on a self-hosted install defaults to R2 and always works: the one honest exception
        for (const c of cards.filter((x) => x.id !== 'video')) expect(c.status, c.id).not.toBe('connected');
        expect(card(cards, 'video').status).toBe('connected');
    });

    it('a hosted deployment missing a credential it should supply needs attention', () => {
        const cards = buildIntegrationOverview(inputs({ env: { ...DEPLOYMENT_ENV, RESEND_API_KEY: undefined } }));
        expect(card(cards, 'email')).toMatchObject({ source: 'unavailable', status: 'attention' });
    });

    it('Stripe: all three keys connect, some need attention, none is not connected', () => {
        const all = { STRIPE_PUBLISHABLE_KEY: 'pk', STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh' };
        expect(card(buildIntegrationOverview(inputs({ company: { ownSecrets: all } })), 'stripe').status).toBe('connected');
        expect(card(buildIntegrationOverview(inputs({ company: { ownSecrets: { STRIPE_SECRET_KEY: 'sk' } } })), 'stripe').status).toBe('attention');
        expect(card(buildIntegrationOverview(inputs()), 'stripe').status).toBe('not_connected');
    });

    it('QuickBooks needs a real connection, not only an app', () => {
        const base = { profile: HOSTED, env: DEPLOYMENT_ENV };
        expect(card(buildIntegrationOverview(inputs(base)), 'quickbooks')).toMatchObject({ source: 'provided', status: 'not_connected' });
        expect(card(buildIntegrationOverview(inputs({ ...base, quickbooksConnected: true })), 'quickbooks'))
            .toMatchObject({ source: 'provided', status: 'connected' });
        // control: a connection cannot make a missing app look connected
        expect(card(buildIntegrationOverview(inputs({ profile: SELF, quickbooksConnected: true })), 'quickbooks').status).not.toBe('connected');
    });

    it('Google Calendar needs the sign-in as well as the client', () => {
        const base = { env: DEPLOYMENT_ENV };
        expect(card(buildIntegrationOverview(inputs(base)), 'googleCalendar').status).toBe('not_connected');
        expect(card(buildIntegrationOverview(inputs({ ...base, calendarConnected: true })), 'googleCalendar').status).toBe('connected');
    });
});

describe('what a card carries', () => {
    it('never carries a key or a token', () => {
        const secrets = { RESEND_API_KEY: 'SECRET_RESEND_VALUE', STRIPE_SECRET_KEY: 'SECRET_STRIPE_VALUE', GEMINI_API_KEY: 'SECRET_AI_VALUE' };
        const out = JSON.stringify(buildIntegrationOverview(inputs({
            env: DEPLOYMENT_ENV, company: { senderEmail: 'a@b.test', ownSecrets: secrets },
        })));
        for (const v of [...Object.values(secrets), ...Object.values(DEPLOYMENT_ENV)]) expect(out).not.toContain(v);
    });
});
