/**
 * Per-service facts the unified resolver needs: what each deployment profile
 * offers, which credentials make a source complete, and what an existing
 * company that never made a choice is on today.
 *
 * Every `legacy` rule restates, as a source, what the existing code already does
 * with no stored choice, so deploying the resolver changes no company's source.
 * Offers are read from existing profile capabilities; none is added.
 */
import type { DeploymentProfile } from '../deployment-profile';
import type {
    CompanyIntegrationConfig,
    IntegrationEnv,
    IntegrationService,
    IntegrationSourceChoice,
} from './sources';

type OwnState = 'complete' | 'partial' | 'none';

export interface ServiceSpec {
    offersProvided(profile: DeploymentProfile): boolean;
    offersOwn(profile: DeploymentProfile): boolean;
    /** The deployment supplies a usable credential for this service. */
    provided(env: IntegrationEnv): boolean;
    /** Set when the provided source exists in code but must not be offered yet. */
    providedHeldBack?(env: IntegrationEnv): boolean;
    /** Completeness of the company's OWN stored credentials (never the env). */
    own(company: CompanyIntegrationConfig): { state: OwnState };
    /** Self-hosted completeness: the operator's env and the company's keys together. */
    standaloneOwn(company: CompanyIntegrationConfig, env: IntegrationEnv): boolean;
    /** Source of a company with no stored choice on a deployment that offers 'provided'. `signal`: a stored setting decided it. */
    legacy(company: CompanyIntegrationConfig, env: IntegrationEnv): { choice: IntegrationSourceChoice; signal: boolean };
}

const has = (v: unknown): boolean => typeof v === 'string' ? v.trim() !== '' : v !== undefined && v !== null;
const secret = (c: CompanyIntegrationConfig, k: string): boolean => has(c.ownSecrets?.[k]);

function stateOf(required: boolean[], anyPresent: boolean): { state: OwnState } {
    if (required.every(Boolean)) return { state: 'complete' };
    return { state: anyPresent ? 'partial' : 'none' };
}

function emailOwnKeys(c: CompanyIntegrationConfig): string[] {
    switch (c.emailByoProvider) {
        case 'sendgrid': return ['SENDGRID_API_KEY'];
        case 'postmark': return ['POSTMARK_SERVER_TOKEN'];
        case 'mailgun': return ['MAILGUN_API_KEY', 'MAILGUN_DOMAIN'];
        default: return ['RESEND_API_KEY'];
    }
}

function smsOwnKeys(c: CompanyIntegrationConfig): string[] {
    return c.smsByoProvider === 'telnyx'
        ? ['TELNYX_API_KEY', 'TELNYX_FROM_NUMBER']
        : ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'];
}

export const SERVICE_SPECS: Record<IntegrationService, ServiceSpec> = {
    email: {
        offersProvided: (p) => p.providesEmailSource,
        offersOwn: () => true,
        provided: (env) => has(env.RESEND_API_KEY) && has(env.SENDER_EMAIL),
        own: (c) => {
            const keys = emailOwnKeys(c);
            return stateOf([has(c.senderEmail), ...keys.map((k) => secret(c, k))], keys.some((k) => secret(c, k)));
        },
        standaloneOwn: (c, env) => {
            if (SERVICE_SPECS.email.own(c).state === 'complete') return true;
            return (has(env.RESEND_API_KEY) || secret(c, 'RESEND_API_KEY')) && (has(env.SENDER_EMAIL) || has(c.senderEmail));
        },
        legacy: (c) => ({ choice: c.legacy?.emailMode === 'own' ? 'own' : 'provided', signal: c.legacy?.emailMode !== undefined }),
    },
    sms: {
        offersProvided: (p) => p.hasManagedCompliance,
        offersOwn: () => true,
        // A shared number is not yet confirmed acceptable by the SMS providers.
        providedHeldBack: (env) => !['true', '1'].includes(env.SMS_MANAGED_SHARED_ENABLED ?? ''),
        provided: (env) => has(env.TWILIO_ACCOUNT_SID) && has(env.TWILIO_API_KEY_SID)
            && has(env.TWILIO_API_KEY_SECRET) && has(env.TWILIO_SHARED_MESSAGING_SERVICE_SID),
        own: (c) => {
            const keys = smsOwnKeys(c);
            return stateOf(keys.map((k) => secret(c, k)), keys.some((k) => secret(c, k)));
        },
        standaloneOwn: (c, env) => {
            if (SERVICE_SPECS.sms.own(c).state === 'complete') return true;
            return c.smsByoProvider !== 'telnyx'
                && has(env.TWILIO_ACCOUNT_SID) && has(env.TWILIO_AUTH_TOKEN) && has(env.TWILIO_FROM_NUMBER);
        },
        legacy: (c) => ({ choice: c.legacy?.smsMode === 'own' ? 'own' : 'provided', signal: c.legacy?.smsMode !== undefined }),
    },
    ai: {
        offersProvided: (p) => p.hasManagedAi,
        offersOwn: () => true,
        provided: (env) => has(env.AI_MANAGED_API_KEY) || has(env.AI_VERTEX_SERVICE_ACCOUNT),
        own: (c) => stateOf([secret(c, 'GEMINI_API_KEY')], secret(c, 'GEMINI_API_KEY')),
        standaloneOwn: (c) => secret(c, 'GEMINI_API_KEY'),
        legacy: (c) => secret(c, 'GEMINI_API_KEY') ? { choice: 'own', signal: true } : { choice: 'provided', signal: false },
    },
    video: {
        offersProvided: (p) => p.videoBackendManaged,
        // Hosted video runs on the deployment's own bindings; a company's own
        // Stream account would need a backend that does not exist.
        offersOwn: (p) => !p.videoBackendManaged,
        provided: () => true,
        own: () => ({ state: 'complete' }),
        standaloneOwn: (c, env) => c.legacy?.videoMode !== 'stream' || (env.STREAM !== undefined && env.STREAM !== null && has(c.streamSubdomain)),
        legacy: () => ({ choice: 'provided', signal: false }),
    },
    quickbooks: {
        offersProvided: (p) => p.qboAppManaged,
        offersOwn: () => true,
        provided: (env) => has(env.QBO_CLIENT_ID) && has(env.QBO_CLIENT_SECRET),
        own: (c) => stateOf([secret(c, 'QBO_CLIENT_ID'), secret(c, 'QBO_CLIENT_SECRET')], secret(c, 'QBO_CLIENT_ID') || secret(c, 'QBO_CLIENT_SECRET')),
        standaloneOwn: (c, env) => (has(env.QBO_CLIENT_ID) || secret(c, 'QBO_CLIENT_ID'))
            && (has(env.QBO_CLIENT_SECRET) || secret(c, 'QBO_CLIENT_SECRET')),
        // The merge rule today: the deployment's app wins, the company's fills
        // in only where the deployment has none.
        legacy: (c, env) => has(env.QBO_CLIENT_ID) && has(env.QBO_CLIENT_SECRET)
            ? { choice: 'provided', signal: true }
            : { choice: SERVICE_SPECS.quickbooks.own(c).state === 'complete' ? 'own' : 'provided', signal: true },
    },
};
