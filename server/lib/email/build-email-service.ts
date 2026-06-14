import { EmailService } from '../../services/email.service';
import { BrandingService } from '../../services/branding.service';
import { EmailTemplateService } from '../../services/email-template.service';
import { EmailTemplateRenderer } from '../email-templates/renderer';
import { loadTenantSecrets } from '../secrets-cache';
import { maybeMetering } from '../../services/metering.service';
import { currentPeriodKey } from '../usage/period';
import type { EmailIdentityConfig } from './sender-identity';
import type { TemplateOverride } from '../email-templates/types';

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
 * logo is dropped (the layout falls back to the siteName text header).
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
    emailBrand?: { siteName: string | null; logoUrl: string | null; primaryColor: string | null } | undefined;
    dbSecrets: { resendApiKey?: string; senderEmail?: string; geminiApiKey?: string };
    emailOverrides?: Map<string, TemplateOverride> | undefined;
}

/**
 * Single source of truth for own-vs-platform Resend resolution + branded
 * renderer construction. Pure/sync so `diMiddleware` (which pre-loads the
 * config in its async body) and `buildTenantEmailService` (non-request
 * contexts) both produce identical EmailService instances.
 */
export function assembleTenantEmailService(env: EmailServiceEnv, cfg: LoadedEmailConfig, meterTenantId?: string): EmailService {
    const { emailIdentity, emailBrand, dbSecrets, emailOverrides } = cfg;
    const ownReady =
        emailIdentity?.mode === 'own' &&
        !!dbSecrets.resendApiKey &&
        !!emailIdentity.senderEmail;
    const resendKey = ownReady
        ? dbSecrets.resendApiKey!
        : (env.RESEND_API_KEY || dbSecrets.resendApiKey || '');
    const fromAddress = ownReady
        ? emailIdentity!.senderEmail!
        : (env.SENDER_EMAIL || emailIdentity?.senderEmail || '');
    const appName = emailIdentity?.siteName || env.APP_NAME || 'OpenInspection';
    const platformColor = env.PRIMARY_COLOR || '#4f46e5';
    const renderer = new EmailTemplateRenderer({
        tenantBrand: {
            name: emailBrand?.siteName || emailIdentity?.senderDisplayName || appName,
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
    return new EmailService(resendKey, fromAddress, appName, emailIdentity, renderer, meter);
}

/**
 * A-16 — the tenant's Resend + Gemini keys come from the CANONICAL secrets
 * store (`tenant_configs.encrypted_secrets`, ENV-name keys — the column every
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
        ...(dec.RESEND_API_KEY ? { resendApiKey: dec.RESEND_API_KEY } : {}),
        ...(dec.GEMINI_API_KEY ? { geminiApiKey: dec.GEMINI_API_KEY } : {}),
    };
}

/**
 * Async: load a tenant's email config (identity, brand, secrets, overrides)
 * with all four reads in parallel. Shared by `diMiddleware` (per-request,
 * A-16) and `buildTenantEmailService` (non-request contexts, B-13).
 */
export async function loadTenantEmailConfig(env: EmailServiceEnv, tenantId: string): Promise<LoadedEmailConfig> {
    const branding = new BrandingService(env.DB, env.TENANT_CACHE);
    const [emailIdentity, emailBrand, dbSecrets, overrides] = await Promise.all([
        branding.getEmailIdentity(tenantId).catch(() => undefined),
        branding.getEmailBrand(tenantId).catch(() => undefined),
        loadEmailSecrets(env, tenantId).catch(() => ({} as LoadedEmailConfig['dbSecrets'])),
        new EmailTemplateService(env.DB).listForTenant(tenantId).catch(() => []),
    ]);
    const emailOverrides = overrides.length ? new Map(overrides.map(o => [o.trigger, o])) : undefined;
    return { emailIdentity, emailBrand, dbSecrets, emailOverrides };
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
