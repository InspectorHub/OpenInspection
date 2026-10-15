/**
 * Which account an outgoing email is sent from, decided by the unified source
 * resolver and handed back to `assembleTenantEmailService` as one of three
 * paths. The credential and sender logic stays in the assembler; this only
 * answers "whose".
 *
 *   own        the company's own provider, key and sender
 *   platform   the deployment's sender (and, for a company with no explicit
 *              choice, the long-standing fallback to a key the company stored)
 *   blocked    nothing is sent: the company chose its own account and it is not
 *              usable, so the deployment's account must not pay for the mail
 *
 * Without a stored choice the pre-existing rules apply unchanged, with one
 * correction: on a deployment that supplies a shared sender, a company set to
 * its own account with incomplete keys used to fall back to the deployment's
 * key and sender. That is now `blocked`.
 */
import { getDeploymentProfile } from '../deployment-profile';
import type { LoadedEmailConfig, EmailServiceEnv } from '../email/build-email-service';
import { offeredSources, resolveIntegrationSource, type CompanyIntegrationConfig } from './sources';

export type EmailSendPath =
    | { kind: 'own' }
    | { kind: 'platform'; companyKeyAllowed: boolean }
    | { kind: 'blocked'; reason: string };

function companyOf(cfg: LoadedEmailConfig): CompanyIntegrationConfig {
    const s = cfg.dbSecrets;
    return {
        sources: cfg.integrationSources,
        legacy: { emailMode: cfg.emailIdentity?.mode },
        emailByoProvider: cfg.emailByoProvider,
        senderEmail: cfg.emailIdentity?.senderEmail,
        ownSecrets: {
            RESEND_API_KEY: s.resendApiKey,
            SENDGRID_API_KEY: s.sendgridApiKey,
            POSTMARK_SERVER_TOKEN: s.postmarkToken,
            MAILGUN_API_KEY: s.mailgunApiKey,
            MAILGUN_DOMAIN: s.mailgunDomain,
        },
    };
}

export function selectEmailPath(args: { env: EmailServiceEnv; cfg: LoadedEmailConfig; legacyOwnReady: boolean }): EmailSendPath {
    const { env, cfg, legacyOwnReady } = args;
    const profile = getDeploymentProfile(env);
    const res = resolveIntegrationSource('email', profile, companyOf(cfg), env);

    if (res.choice === 'explicit') {
        if (res.source === 'own') return { kind: 'own' };
        // Whether the deployment's key is configured is not judged here: a
        // request-scoped env may already carry the company's key merged in, and
        // the key picker below discards that. An unusable key sends nothing.
        if (res.source === 'provided' || res.reason === 'provided_not_configured') return { kind: 'platform', companyKeyAllowed: false };
        return { kind: 'blocked', reason: res.reason };
    }

    if (legacyOwnReady) return { kind: 'own' };
    const suppliesSharedSender = offeredSources('email', profile, env).includes('provided');
    if (suppliesSharedSender && res.reason === 'own_credentials_incomplete') return { kind: 'blocked', reason: res.reason };
    return { kind: 'platform', companyKeyAllowed: true };
}

/** The Resend key a platform or blocked path sends with. Empty means "do not send". */
export function platformResendKey(
    path: EmailSendPath,
    env: { RESEND_API_KEY?: string | undefined },
    companyKey: string | undefined,
): string {
    // Only a platform path sends with the deployment's key; an own path uses the
    // company's, and a blocked one sends nothing.
    if (path.kind !== 'platform') return '';
    if (path.companyKeyAllowed) return env.RESEND_API_KEY || companyKey || '';
    // The company's key may have been merged into a request-scoped env; it is
    // still the company's, so it is not the deployment's to send with.
    return env.RESEND_API_KEY && env.RESEND_API_KEY !== companyKey ? env.RESEND_API_KEY : '';
}
