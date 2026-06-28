import { EmailService } from '../../services/email.service';
import { BrandingService } from '../../services/branding.service';
import { EmailTemplateService } from '../../services/email-template.service';
import { EmailTemplateRenderer } from '../email-templates/renderer';
import { loadTenantSecrets } from '../secrets-cache';
import { maybeMetering } from '../../services/metering.service';
import { currentPeriodKey } from '../usage/period';
import type { EmailIdentityConfig } from './sender-identity';
import type { TemplateOverride } from '../email-templates/types';
import { resolveEmailProvider, coerceEmailByoProvider, type EmailByoProvider } from './resolve-provider';
import { buildEmailSuppression } from './suppression';
import { logger } from '../logger';
import { ResendProvider } from './providers/resend';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantConfigs } from '../db/schema';

/**
 * The env bindings an EmailService needs. Both the Hono request env (`c.env`)
 * and the Cloudflare Workflow env structurally satisfy this.
 */
export interface EmailServiceEnv {
    DB: D1Database;
    APP_MODE?: string;
    TENANT_CACHE: KVNamespace;
    JWT_SECRET: string;
    JWT_SECRET_PREVIOUS?: string;
    RESEND_API_KEY?: string;
    SENDER_EMAIL?: string;
    APP_NAME?: string;
    PRIMARY_COLOR?: string;
    APP_BASE_URL?: string;
}

/**
 * A-10 — email clients can't resolve app-relative URLs, so the stored logo
 * path (`/api/public/brand-asset?key=...`) must be absolutized against
 * APP_BASE_URL before it goes into an email body. Without a base URL the
 * logo is dropped (the layout falls back to the companyName text header).
 */
function absoluteLogoUrl(logoUrl: string | null | undefined, baseUrl: string | undefined): string | null {
    if (!logoUrl) return null;
    if (/^https?:\/\//i.test(logoUrl)) return logoUrl;
    if (!baseUrl) return null;
    return `${baseUrl.replace(/\/$/, '')}${logoUrl.startsWith('/') ? '' : '/'}${logoUrl}`;
}

/** Tenant email config the assembler needs — loaded by `di` (pre-fetched) or by `buildTenantEmailService`. */
export interface LoadedEmailConfig {
    emailIdentity?: EmailIdentityConfig | undefined;
    emailBrand?: { companyName: string | null; logoUrl: string | null; primaryColor: string | null } | undefined;
    dbSecrets: {
        resendApiKey?: string;
        senderEmail?: string;
        geminiApiKey?: string;
        /** SendGrid BYO: SENDGRID_API_KEY from tenant secrets_enc. */
        sendgridApiKey?: string;
        /** Postmark BYO: POSTMARK_SERVER_TOKEN from tenant secrets_enc (stored in apiKey field of PostmarkProvider). */
        postmarkToken?: string;
        /** Mailgun BYO: MAILGUN_API_KEY from tenant secrets_enc. */
        mailgunApiKey?: string;
        /** Mailgun BYO: MAILGUN_DOMAIN from tenant secrets_enc. */
        mailgunDomain?: string;
    };
    emailOverrides?: Map<string, TemplateOverride> | undefined;
    /** Which email provider the tenant has selected for own-mode sends (see #195). Default 'resend'. */
    emailByoProvider?: EmailByoProvider | undefined;
}

/**
 * Single source of truth for own-vs-platform Resend resolution + branded
 * renderer construction. Pure/sync so `diMiddleware` (which pre-loads the
 * config in its async body) and `buildTenantEmailService` (non-request
 * contexts) both produce identical EmailService instances.
 */
export function assembleTenantEmailService(env: EmailServiceEnv, cfg: LoadedEmailConfig, meterTenantId?: string): EmailService {
    const { emailIdentity, emailBrand, dbSecrets, emailOverrides, emailByoProvider } = cfg;

    // Determine whether the selected BYO provider's creds are present.
    const byoProvider = emailByoProvider ?? 'resend';
    const selectedProviderCredsPresent = (() => {
        switch (byoProvider) {
            case 'sendgrid': return !!dbSecrets.sendgridApiKey;
            case 'postmark': return !!dbSecrets.postmarkToken;
            case 'mailgun':  return !!dbSecrets.mailgunApiKey && !!dbSecrets.mailgunDomain;
            default:         return !!dbSecrets.resendApiKey; // 'resend'
        }
    })();

    const ownReady =
        emailIdentity?.mode === 'own' &&
        !!emailIdentity.senderEmail &&
        selectedProviderCredsPresent;

    let provider;
    let apiKeySentinel: string;
    let fromAddress: string;

    if (ownReady) {
        // Own path: use the tenant's chosen provider + their creds.
        switch (byoProvider) {
            case 'sendgrid':
                provider = resolveEmailProvider('sendgrid', { apiKey: dbSecrets.sendgridApiKey! });
                apiKeySentinel = dbSecrets.sendgridApiKey!;
                break;
            case 'postmark':
                provider = resolveEmailProvider('postmark', { apiKey: dbSecrets.postmarkToken! });
                apiKeySentinel = dbSecrets.postmarkToken!;
                break;
            case 'mailgun':
                provider = resolveEmailProvider('mailgun', { apiKey: dbSecrets.mailgunApiKey!, domain: dbSecrets.mailgunDomain! });
                apiKeySentinel = dbSecrets.mailgunApiKey!;
                break;
            default:
                // 'resend' own path
                provider = resolveEmailProvider('resend', { apiKey: dbSecrets.resendApiKey! });
                apiKeySentinel = dbSecrets.resendApiKey!;
                break;
        }
        fromAddress = emailIdentity!.senderEmail!;
    } else {
        // A tenant who selected own-mode with a non-Resend provider but whose
        // credentials are missing/incomplete silently falls back to the platform
        // Resend path below (different From domain/deliverability). Surface it so
        // operators can spot a half-finished provider switch in logs; the
        // Settings validate-on-save flow already flags this at config time.
        if (emailIdentity?.mode === 'own' && byoProvider !== 'resend' && !selectedProviderCredsPresent) {
            logger.warn('[email] own-mode provider creds missing — falling back to platform Resend', { provider: byoProvider });
        }
        // Platform/default path — byte-for-byte identical to previous behavior.
        const platformResendKey = env.RESEND_API_KEY || dbSecrets.resendApiKey || '';
        provider = new ResendProvider({ apiKey: platformResendKey });
        apiKeySentinel = platformResendKey;
        fromAddress = env.SENDER_EMAIL || emailIdentity?.senderEmail || '';
    }

    const appName = emailIdentity?.companyName || env.APP_NAME || 'OpenInspection';
    const platformColor = env.PRIMARY_COLOR || '#4f46e5';
    const renderer = new EmailTemplateRenderer({
        tenantBrand: {
            name: emailBrand?.companyName || emailIdentity?.senderDisplayName || appName,
            logoUrl: absoluteLogoUrl(emailBrand?.logoUrl, env.APP_BASE_URL),
            primaryColor: emailBrand?.primaryColor || platformColor,
        },
        platformBrand: {
            name: env.APP_NAME || 'OpenInspection',
            logoUrl: null,
            primaryColor: platformColor,
        },
        ...(emailOverrides ? { overrides: emailOverrides } : {}),
    });
    const metering = maybeMetering(env);
    const meter = metering && meterTenantId
        ? { record: () => metering.record(meterTenantId, 'email', currentPeriodKey(new Date())) }
        : undefined;
    // WH-3 — wire the send-path suppression gate under the same guard as `meter`:
    // only when we have a tenant id to scope the lookup (env.DB is always present
    // on EmailServiceEnv). Standalone/platform-default sends (no meterTenantId) get
    // no gate, behavior unchanged.
    const suppression = meterTenantId
        ? buildEmailSuppression(env.DB, meterTenantId)
        : undefined;
    return new EmailService(apiKeySentinel, fromAddress, appName, emailIdentity, renderer, meter, provider, suppression);
}

/**
 * A-16 — the tenant's Resend + Gemini keys come from the CANONICAL secrets
 * store (`tenant_configs.secrets_enc`, ENV-name keys — the column every
 * Settings page writes via PUT/POST /api/admin/secrets). The legacy camelCase
 * `secrets` column this used to read has no remaining UI write path, so keys
 * saved in Settings never reached email/AI construction. Blob is KV-cached
 * ciphertext (see lib/secrets-cache.ts).
 */
async function loadEmailSecrets(env: EmailServiceEnv, tenantId: string): Promise<LoadedEmailConfig['dbSecrets']> {
    const dec = (await loadTenantSecrets(
        env.DB, env.TENANT_CACHE, tenantId, env.JWT_SECRET, env.JWT_SECRET_PREVIOUS,
    ).catch(() => null)) ?? {};
    return {
        ...(dec.RESEND_API_KEY       ? { resendApiKey:   dec.RESEND_API_KEY }       : {}),
        ...(dec.GEMINI_API_KEY       ? { geminiApiKey:   dec.GEMINI_API_KEY }       : {}),
        ...(dec.SENDGRID_API_KEY     ? { sendgridApiKey: dec.SENDGRID_API_KEY }     : {}),
        ...(dec.POSTMARK_SERVER_TOKEN ? { postmarkToken:  dec.POSTMARK_SERVER_TOKEN } : {}),
        ...(dec.MAILGUN_API_KEY      ? { mailgunApiKey:  dec.MAILGUN_API_KEY }      : {}),
        ...(dec.MAILGUN_DOMAIN       ? { mailgunDomain:  dec.MAILGUN_DOMAIN }       : {}),
    };
}

/**
 * Async: load a tenant's email config (identity, brand, secrets, overrides,
 * and BYO provider selection) with all reads in parallel.
 * Shared by `diMiddleware` (per-request, A-16) and `buildTenantEmailService`
 * (non-request contexts, B-13).
 */
export async function loadTenantEmailConfig(env: EmailServiceEnv, tenantId: string): Promise<LoadedEmailConfig> {
    const branding = new BrandingService(env.DB, env.TENANT_CACHE);
    const byoProviderReadPromise = (async () => {
        try {
            return await drizzle(env.DB)
                .select({ emailByoProvider: tenantConfigs.emailByoProvider })
                .from(tenantConfigs)
                .where(eq(tenantConfigs.tenantId, tenantId))
                .get();
        } catch {
            return null;
        }
    })();

    const [emailIdentity, emailBrand, dbSecrets, overrides, byoProviderRow] = await Promise.all([
        branding.getEmailIdentity(tenantId).catch(() => undefined),
        branding.getEmailBrand(tenantId).catch(() => undefined),
        loadEmailSecrets(env, tenantId).catch(() => ({} as LoadedEmailConfig['dbSecrets'])),
        new EmailTemplateService(env.DB).listForTenant(tenantId).catch(() => []),
        byoProviderReadPromise,
    ]);
    const emailOverrides = overrides.length ? new Map(overrides.map(o => [o.trigger, o])) : undefined;
    // emailByoProvider defaults to 'resend' when the row is absent (new tenant,
    // no config row yet) or carries an unrecognized value — drizzle's `{ enum }`
    // is the only write path, but it is not DB-enforced, so guard the read.
    const emailByoProvider: EmailByoProvider = coerceEmailByoProvider(byoProviderRow?.emailByoProvider);
    return { emailIdentity, emailBrand, dbSecrets, emailOverrides, emailByoProvider };
}

/**
 * Async: load a tenant's email config then assemble the EmailService. For
 * NON-request contexts where `diMiddleware` never ran — Cloudflare Workflows,
 * scheduled handlers — so those sends still honor the tenant's sender
 * identity + branded templates (B-13). Pass `undefined` tenantId for platform
 * defaults (no overrides).
 */
export async function buildTenantEmailService(env: EmailServiceEnv, tenantId: string | undefined): Promise<EmailService> {
    if (!tenantId) {
        return assembleTenantEmailService(env, { dbSecrets: {} });
    }
    return assembleTenantEmailService(env, await loadTenantEmailConfig(env, tenantId), tenantId);
}
