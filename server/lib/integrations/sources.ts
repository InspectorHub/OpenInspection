/**
 * Integration sources: for each outside service, whose credentials a company
 * runs on.
 *
 *   'provided'  the deployment supplies the service (shown to people as Built-in)
 *   'own'       the company's own account or keys (shown as Your own)
 *
 * This module is the ONE place that decision is made. The per-service
 * resolvers (AI, SMS, email, video, QuickBooks) keep their credential and
 * endpoint logic and ask this module only "which source is this company on".
 *
 * Hard rules, each pinned by a test with a positive control:
 *   - An explicit 'own' never falls back to the deployment's credentials. If
 *     the company's own credentials are incomplete the answer is 'unavailable'
 *     with its own reason, never a quiet switch to someone else's account.
 *   - An explicit 'provided' never reads the company's stored credentials.
 *   - A standalone deployment offers only 'own'. The operator's own environment
 *     counts as the company's own credentials there.
 *   - The retired SMS value `platform` is never a valid choice (see
 *     `stored-sources.ts`); a stored legacy `platform` mode only means "no
 *     explicit choice was made".
 *   - Hosted video has no 'own'. Hosted SMS has no 'provided' source at all: a
 *     company sends on its own account or on a number registered for it.
 *
 * Pure: no I/O, no clock. `env` must be the DEPLOYMENT's environment. A
 * request-scoped env that already had a company's secrets merged into it
 * (integration-secrets middleware) overstates what the deployment provides.
 */
import type { DeploymentProfile } from '../deployment-profile';
import { SERVICE_SPECS } from './source-catalog';
import type { EmailByoProvider } from '../email/resolve-provider';

export const INTEGRATION_SERVICES = ['email', 'sms', 'ai', 'video', 'quickbooks'] as const;
export type IntegrationService = (typeof INTEGRATION_SERVICES)[number];

export type IntegrationSourceChoice = 'provided' | 'own';
export type IntegrationSource = IntegrationSourceChoice | 'unavailable';

/** A company's stored explicit choices. Absent service = no explicit choice. */
export type StoredIntegrationSources = Partial<Record<IntegrationService, IntegrationSourceChoice>>;

export const SOURCE_REASONS = [
    'explicit_choice',
    'legacy_setting',
    'profile_default',
    'not_offered',
    'own_credentials_incomplete',
    'provided_not_configured',
    'provider_confirmation_pending',
    'dedicated_number',
    'dedicated_not_ready',
] as const;
export type SourceReason = (typeof SOURCE_REASONS)[number];

/** The company's side of the decision. Everything optional: an empty object is a new company. */
export interface CompanyIntegrationConfig {
    /** Explicit choices from `integration_config.integrationSources`. */
    sources?: StoredIntegrationSources | undefined;
    /** The pre-existing per-service columns. Read only to derive the default when no choice is stored. */
    legacy?: {
        emailMode?: 'platform' | 'own' | undefined;
        smsMode?: 'platform' | 'own' | 'managed_shared' | 'managed_dedicated' | undefined;
        videoMode?: 'r2' | 'stream' | undefined;
    } | undefined;
    emailByoProvider?: EmailByoProvider | null | undefined;
    smsByoProvider?: 'twilio' | 'telnyx' | null | undefined;
    senderEmail?: string | null | undefined;
    /** Self-host Stream customer subdomain stored for the company. */
    streamSubdomain?: string | null | undefined;
    /** The company's decrypted stored keys. Only presence is read. */
    ownSecrets?: Record<string, string | undefined> | undefined;
    /** SMS: the number registered for the company is approved and has its Messaging Service, so it can send. */
    dedicatedNumberReady?: boolean | undefined;
}

/** The deployment's own environment slice. Presence is all that is read. */
export interface IntegrationEnv {
    RESEND_API_KEY?: string | undefined;
    SENDER_EMAIL?: string | undefined;
    TWILIO_ACCOUNT_SID?: string | undefined;
    TWILIO_AUTH_TOKEN?: string | undefined;
    TWILIO_FROM_NUMBER?: string | undefined;
    TWILIO_API_KEY_SID?: string | undefined;
    TWILIO_API_KEY_SECRET?: string | undefined;
    AI_MANAGED_API_KEY?: string | undefined;
    AI_VERTEX_SERVICE_ACCOUNT?: string | undefined;
    QBO_CLIENT_ID?: string | undefined;
    QBO_CLIENT_SECRET?: string | undefined;
    /** The Stream binding; only its presence is read. */
    STREAM?: unknown;
}

export interface IntegrationSourceResolution {
    service: IntegrationService;
    source: IntegrationSource;
    reason: SourceReason;
    /** Whether the credentials of the resolved (or, if unavailable, wanted) source are complete. */
    credentialsPresent: boolean;
    /** 'explicit' when a stored choice decided it; 'default' when the default for this company did. */
    choice: 'explicit' | 'default';
}

/** The sources a company could pick on this deployment, in display order. */
export function offeredSources(
    service: IntegrationService,
    profile: DeploymentProfile,
    env: IntegrationEnv,
): IntegrationSourceChoice[] {
    const spec = SERVICE_SPECS[service];
    const offered: IntegrationSourceChoice[] = [];
    if (spec.offersProvided(profile) && !spec.providedHeldBack?.(env)) offered.push('provided');
    if (spec.offersOwn(profile)) offered.push('own');
    return offered;
}

export function resolveIntegrationSource(
    service: IntegrationService,
    profile: DeploymentProfile,
    company: CompanyIntegrationConfig,
    env: IntegrationEnv,
): IntegrationSourceResolution {
    const spec = SERVICE_SPECS[service];
    const stored = company.sources?.[service];
    const choice = stored ? 'explicit' : 'default';

    let wanted: IntegrationSourceChoice;
    let reason: SourceReason;
    if (stored) {
        wanted = stored;
        reason = 'explicit_choice';
    } else if (!spec.offersProvided(profile)) {
        wanted = 'own';
        reason = 'profile_default';
    } else {
        const legacy = spec.legacy(company, env);
        wanted = legacy.choice;
        reason = legacy.signal ? 'legacy_setting' : 'profile_default';
    }
    const fail = (why: SourceReason, credentialsPresent = false): IntegrationSourceResolution =>
        ({ service, source: 'unavailable', reason: why, credentialsPresent, choice });

    // A company on a number registered for it (hosted only) sends on that number,
    // which is its own sender. It is neither Built-in nor an account it typed in,
    // so it is read from the registration, not from the keys.
    if (service === 'sms' && spec.offersProvided(profile) && company.legacy?.smsMode === 'managed_dedicated') {
        return company.dedicatedNumberReady
            ? { service, source: 'own', reason: 'dedicated_number', credentialsPresent: true, choice: 'default' }
            : { ...fail('dedicated_not_ready'), choice: 'default' };
    }

    if (wanted === 'provided') {
        // Held back is a different answer from "not offered": the code path
        // exists, the providers have not confirmed it yet.
        if (spec.offersProvided(profile) && spec.providedHeldBack?.(env)) return fail('provider_confirmation_pending');
        if (!spec.offersProvided(profile)) return fail('not_offered');
        return spec.provided(env)
            ? { service, source: 'provided', reason, credentialsPresent: true, choice }
            : fail('provided_not_configured');
    }

    if (!spec.offersOwn(profile)) return fail('not_offered');
    // Self-hosted: the operator's own environment is the company's own
    // credentials. Hosted: only what the company stored.
    const present = spec.offersProvided(profile) ? spec.own(company).state === 'complete' : spec.standaloneOwn(company, env);
    return present
        ? { service, source: 'own', reason, credentialsPresent: true, choice }
        : fail('own_credentials_incomplete');
}
