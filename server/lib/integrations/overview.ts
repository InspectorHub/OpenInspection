/**
 * The Integrations overview: one card per outside service, saying whether it
 * works (status) and whose account it runs on (source). Two separate facts.
 *
 * Pure: everything is derived from values the caller already read, with no
 * network call, so the page can ask on every load. The services the source
 * resolver knows (email, SMS, AI, video, QuickBooks) take their source and
 * state from it. The rest (card payments, Google Calendar, address
 * suggestions, property facts) are read here from the same facts the resolver
 * uses: which keys the deployment holds and which the company stored.
 *
 * `env` must be the DEPLOYMENT's environment. A request-scoped env that already
 * had the company's keys merged into it overstates what the deployment supplies
 * (see `sources.ts`).
 *
 * No secret value ever leaves this module. A card carries presence, never keys.
 */
import { SERVICE_SPECS } from './source-catalog';
import { sourceReasonMessageKey, type SourceReasonMessageKey } from './source-reasons';
import { integrationSources } from './source-overview';
import type { DeploymentProfile } from '../deployment-profile';
import type {
    CompanyIntegrationConfig,
    IntegrationEnv,
    IntegrationService,
    IntegrationSource,
} from './sources';

export type IntegrationCategory = 'payments' | 'accounting' | 'calendar' | 'messaging' | 'data' | 'video' | 'ai';
export type IntegrationStatus = 'connected' | 'attention' | 'not_connected';

export interface IntegrationCard {
    id: string;
    category: IntegrationCategory;
    /** Is it working. Never says whose account. */
    status: IntegrationStatus;
    /** Whose account it runs on. `unavailable`: the wanted source cannot be used right now. */
    source: IntegrationSource;
    /** Runs on a number registered for the company (SMS), shown as Dedicated number. */
    dedicatedNumber: boolean;
    /** The company may switch between Built-in and Your own on this service. False when only Your own is on offer. */
    canUseOwn: boolean;
    /** The settings page that manages it. */
    detailPath: string;
    /** Message key explaining why the source is unavailable, or null. */
    reasonKey: SourceReasonMessageKey | null;
}

/** The deployment's environment slice the overview reads, beyond what the resolver reads. */
export interface OverviewEnv extends IntegrationEnv {
    STRIPE_SECRET_KEY?: string | undefined;
    GOOGLE_CLIENT_ID?: string | undefined;
    GOOGLE_CLIENT_SECRET?: string | undefined;
    GOOGLE_PLACES_API_KEY?: string | undefined;
    ESTATED_API_KEY?: string | undefined;
}

export interface OverviewInputs {
    profile: DeploymentProfile;
    company: CompanyIntegrationConfig;
    env: OverviewEnv;
    /** A QuickBooks sign-in exists for the company. */
    quickbooksConnected: boolean;
    /** The signed-in person has connected a Google calendar. */
    calendarConnected: boolean;
}

/**
 * Services where a company can already pick its own account over the built-in
 * one and have the choice honoured everywhere the service is used. The others
 * join this list as their source is wired.
 */
export const SWITCHABLE_SERVICES = ['email', 'sms', 'ai'] as const satisfies readonly IntegrationService[];
export type SwitchableService = (typeof SWITCHABLE_SERVICES)[number];

const STRIPE_KEYS = ['STRIPE_PUBLISHABLE_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const;

const present = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';

function fromResolver(
    id: string,
    category: IntegrationCategory,
    detailPath: string,
    service: IntegrationService,
    inputs: OverviewInputs,
    rows: ReturnType<typeof integrationSources>,
    connection?: boolean,
): IntegrationCard {
    const row = rows.find((r) => r.service === service);
    if (!row) throw new Error(`no source row for ${service}`);
    let status: IntegrationStatus = row.state;
    // Having the app is not being signed in to it: those services also need a connection.
    if (connection !== undefined && row.current !== 'unavailable') status = connection ? 'connected' : 'not_connected';
    const choice = SERVICE_SPECS[service].offersProvided(inputs.profile) && row.available.includes('provided') && row.available.includes('own');
    return {
        id,
        category,
        status,
        source: row.current,
        dedicatedNumber: row.reason === 'dedicated_number' || row.reason === 'dedicated_not_ready',
        canUseOwn: choice && (SWITCHABLE_SERVICES as readonly IntegrationService[]).includes(service),
        detailPath,
        reasonKey: sourceReasonMessageKey({ service, source: row.current, reason: row.reason }),
    };
}

/** A key the company can supply itself, with the deployment's as the built-in. */
function keyCard(
    id: string,
    category: IntegrationCategory,
    detailPath: string,
    key: 'GOOGLE_PLACES_API_KEY' | 'ESTATED_API_KEY',
    { profile, company, env }: OverviewInputs,
): IntegrationCard {
    const stored = present(company.ownSecrets?.[key]);
    const deployment = present(env[key]);
    let source: IntegrationSource;
    if (profile.envCredentialsAreCompanyOwn) {
        // The operator's environment is the company's own key.
        source = stored || deployment ? 'own' : 'unavailable';
    } else if (deployment) {
        source = 'provided';
    } else {
        source = stored ? 'own' : 'unavailable';
    }
    return {
        id, category, detailPath, source, dedicatedNumber: false,
        status: source === 'unavailable' ? 'not_connected' : 'connected',
        canUseOwn: false,
        reasonKey: null,
    };
}

function stripeCard({ profile, company, env }: OverviewInputs): IntegrationCard {
    // Card payments always go to the company's own Stripe account. On a hosted
    // deployment a key in the deployment's environment is never read for it.
    const have = STRIPE_KEYS.filter((k) => present(company.ownSecrets?.[k])
        || (profile.envCredentialsAreCompanyOwn && k === 'STRIPE_SECRET_KEY' && present(env.STRIPE_SECRET_KEY)));
    const status: IntegrationStatus = have.length === STRIPE_KEYS.length ? 'connected' : have.length > 0 ? 'attention' : 'not_connected';
    return {
        id: 'stripe', category: 'payments', status, source: 'own', dedicatedNumber: false, canUseOwn: false,
        detailPath: '/settings/integrations#stripe', reasonKey: null,
    };
}

function calendarCard({ profile, company, env, calendarConnected }: OverviewInputs): IntegrationCard {
    const deployment = present(env.GOOGLE_CLIENT_ID) && present(env.GOOGLE_CLIENT_SECRET);
    const stored = present(company.ownSecrets?.GOOGLE_CLIENT_ID) && present(company.ownSecrets?.GOOGLE_CLIENT_SECRET);
    let source: IntegrationSource;
    if (profile.envCredentialsAreCompanyOwn) source = deployment || stored ? 'own' : 'unavailable';
    else source = deployment ? 'provided' : stored ? 'own' : 'unavailable';
    return {
        id: 'googleCalendar', category: 'calendar', source, dedicatedNumber: false, canUseOwn: false,
        // The client is only half of it: each person signs in with their own Google account.
        status: source !== 'unavailable' && calendarConnected ? 'connected' : 'not_connected',
        detailPath: '/settings/schedule', reasonKey: null,
    };
}

/** All cards, in the order the page groups them. */
export function buildIntegrationOverview(inputs: OverviewInputs): IntegrationCard[] {
    const rows = integrationSources(inputs.profile, inputs.company, inputs.env);
    const resolved = (
        id: string, category: IntegrationCategory, detailPath: string, service: IntegrationService, connection?: boolean,
    ) => fromResolver(id, category, detailPath, service, inputs, rows, connection);
    return [
        stripeCard(inputs),
        resolved('quickbooks', 'accounting', '/settings/integrations/qbo', 'quickbooks', inputs.quickbooksConnected),
        calendarCard(inputs),
        resolved('email', 'messaging', '/settings/integrations/email', 'email'),
        resolved('sms', 'messaging', '/settings/integrations/sms', 'sms'),
        keyCard('places', 'data', '/settings/advanced', 'GOOGLE_PLACES_API_KEY', inputs),
        keyCard('estated', 'data', '/settings/advanced', 'ESTATED_API_KEY', inputs),
        resolved('video', 'video', '/settings/integrations#video', 'video'),
        resolved('ai', 'ai', '/settings/advanced', 'ai'),
    ];
}
