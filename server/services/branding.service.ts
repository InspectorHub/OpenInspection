import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { agreements, tenantConfigs } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { policyChargesFees } from '../lib/billing/cancellation-policy';
import type { EmailIdentityConfig } from '../lib/email/sender-identity';
import { r2Keys } from '../lib/r2-keys';
import { resolveTenantLegalUrls, type LegalMode } from '../lib/legal-links';
import { resolveLocale } from '../lib/locale';
import { resolveDisplayPrefs, type DateFormat, type TimeFormat } from '../lib/session/display-prefs';

export interface IntegrationConfig {
    appBaseUrl?: string;
    turnstileSiteKey?: string;
    googleClientId?: string;
    /** SaaS: platform Worker OAuth app (default) vs tenant BYO Google OAuth app. */
    googleOAuthMode?: 'platform' | 'own';
    /** Cloudflare Stream customer subdomain for the self-host Stream video backend. */
    streamCustomerSubdomain?: string;
}

// C-15 (2026-06-06): the legacy `SecretsConfig` shape (camelCase keys in the
// retired `tenant_configs.secrets` column) is GONE. Tenant secrets live solely
// in `secrets_enc` (ENV-name keys; server/api/secrets.ts +
// lib/secrets-cache.ts + lib/middleware/integration-secrets.ts).

/**
 * Service to handle tenant-specific branding and configuration.
 * Also manages integration config (plaintext) and secrets (AES-GCM encrypted).
 */
export class BrandingService {
    constructor(private db: D1Database, private kv?: KVNamespace, private r2?: R2Bucket) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    /**
     * Fetches the current branding configuration for a tenant.
     */
    async getBranding(tenantId: string, defaults: { companyName: string; primaryColor: string; supportEmail: string }) {
        const db = this.getDrizzle();
        const config = await db.select().from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();

        return config ?? {
            companyName: defaults.companyName,
            primaryColor: defaults.primaryColor,
            logoUrl: null,
            supportEmail: defaults.supportEmail,
            billingUrl: '',
            defaultTimezone: 'UTC',
            defaultLocale: 'en-US',
            currency: 'USD',
            // #270 — the bottom of the resolution chain; these reproduce
            // today's rendering exactly for a tenant with no config row.
            dateFormat: 'us',
            timeFormat: '12h'
        };
    }

    /**
     * Phase 1 (B-4/A-7) — load just the email-identity columns for a tenant.
     * Returns platform defaults when no config row exists.
     */
    async getEmailIdentity(tenantId: string): Promise<EmailIdentityConfig> {
        const db = this.getDrizzle();
        const row = await db
            .select({
                emailMode: tenantConfigs.emailMode,
                senderEmail: tenantConfigs.senderEmail,
                replyTo: tenantConfigs.replyTo,
                senderDisplayName: tenantConfigs.senderDisplayName,
                pointOfContact: tenantConfigs.pointOfContact,
                companyName: tenantConfigs.companyName,
            })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        return {
            mode: row?.emailMode ?? 'platform',
            senderEmail: row?.senderEmail ?? null,
            replyTo: row?.replyTo ?? null,
            senderDisplayName: row?.senderDisplayName ?? null,
            pointOfContact: row?.pointOfContact ?? 'company',
            companyName: row?.companyName ?? null,
        };
    }

    /**
     * A-10 — the canonical tenant brand projection every tenant-facing surface
     * (profile / booking / report / invoice / email) paints with.
     * Returns nulls when no config row exists; callers apply platform fallbacks.
     * Pass `slug` + `baseUrl` to include effective Privacy / Terms URLs.
     */
    async getBrand(
        tenantId: string,
        opts?: { slug?: string | null; baseUrl?: string | null },
    ): Promise<{
        companyName: string | null;
        logoUrl: string | null;
        primaryColor: string | null;
        defaultTimezone: string;
        defaultLocale: string;
        dateFormat: DateFormat;
        timeFormat: TimeFormat;
        supportEmail: string | null;
        companyPhone: string | null;
        privacyUrl: string | null;
        termsUrl: string | null;
    }> {
        const db = this.getDrizzle();
        const row = await db
            .select({
                companyName: tenantConfigs.companyName,
                logoUrl: tenantConfigs.logoUrl,
                primaryColor: tenantConfigs.primaryColor,
                defaultTimezone: tenantConfigs.defaultTimezone,
                defaultLocale: tenantConfigs.defaultLocale,
                dateFormat: tenantConfigs.dateFormat,
                timeFormat: tenantConfigs.timeFormat,
                supportEmail: tenantConfigs.supportEmail,
                companyPhone: tenantConfigs.companyPhone,
                legalMode: tenantConfigs.legalMode,
                customPrivacyUrl: tenantConfigs.customPrivacyUrl,
                customTermsUrl: tenantConfigs.customTermsUrl,
            })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();

        let privacyUrl: string | null = null;
        let termsUrl: string | null = null;
        const slug = opts?.slug?.trim();
        const baseUrl = opts?.baseUrl?.trim();
        if (slug && baseUrl) {
            const links = resolveTenantLegalUrls(slug, baseUrl, {
                legalMode: (row?.legalMode as LegalMode | undefined) ?? 'hosted',
                customPrivacyUrl: row?.customPrivacyUrl ?? null,
                customTermsUrl: row?.customTermsUrl ?? null,
            });
            privacyUrl = links.privacyUrl;
            termsUrl = links.termsUrl;
        }

        return {
            companyName: row?.companyName ?? null,
            logoUrl: row?.logoUrl ?? null,
            primaryColor: row?.primaryColor ?? null,
            // Public surfaces (portal/report) anchor displayed dates to the tenant
            // timezone; NOT NULL DEFAULT 'UTC' so a config-less tenant is 'UTC'.
            defaultTimezone: row?.defaultTimezone ?? 'UTC',
            // #270 — public surfaces render inspection dates in the tenant's
            // language and shape; there is no viewer to override either.
            defaultLocale: resolveLocale(row?.defaultLocale),
            ...resolveDisplayPrefs(null, row),
            // IA-36 ⑨ — recovery channel for a reader whose link no longer works.
            supportEmail: row?.supportEmail ?? null,
            companyPhone: row?.companyPhone ?? null,
            privacyUrl,
            termsUrl,
        };
    }

    /**
     * Email-template Phase 2 — the brand the email layout paints with.
     * Same projection as getBrand (kept as the email-path entry point).
     */
    async getEmailBrand(tenantId: string): Promise<{ companyName: string | null; logoUrl: string | null; primaryColor: string | null }> {
        return this.getBrand(tenantId);
    }

    // ─── Cancellation clause attestation ─────────────────────────────────────

    /**
     * Record — or withdraw — the tenant's confirmation that their OWN agreement
     * contains a cancellation clause covering the fees they are configuring.
     *
     * We cannot parse free-form agreement HTML for a notice window, so this is
     * the honest maximum: the tenant says so, and we record WHAT they said it
     * about. Passing the template id stamps the attestation at that template's
     * current version; passing null withdraws it.
     */
    async attestCancellationClause(tenantId: string, agreementId: string | null): Promise<void> {
        if (agreementId === null) {
            await this.writeConfig(tenantId, {
                cancellationClauseAgreementId: null,
                cancellationClauseVersion: null,
                cancellationClauseAttestedAt: null,
            });
            return;
        }
        const db = this.getDrizzle();
        const agreement = await db.select({ id: agreements.id, version: agreements.version })
            .from(agreements)
            .where(and(eq(agreements.id, agreementId), eq(agreements.tenantId, tenantId)))
            .get();
        if (!agreement) throw Errors.NotFound('Agreement template not found');
        await this.writeConfig(tenantId, {
            cancellationClauseAgreementId: agreement.id,
            cancellationClauseVersion: agreement.version,
            cancellationClauseAttestedAt: new Date(),
        });
    }

    /**
     * The attestation on file, or null when there is none — or when the
     * agreement it was made against has since been edited or deleted.
     *
     * Invalidation is this equality check and nothing else. The alternative,
     * clearing the attestation from the agreement-edit path, needs every future
     * writer of `agreements` to remember; this one cannot be forgotten because
     * it is evaluated at the moment the answer is used.
     */
    async getCancellationAttestation(
        tenantId: string,
    ): Promise<{ agreementId: string; version: number; attestedAt: Date } | null> {
        const db = this.getDrizzle();
        const row = await db.select({
            agreementId: tenantConfigs.cancellationClauseAgreementId,
            version: tenantConfigs.cancellationClauseVersion,
            attestedAt: tenantConfigs.cancellationClauseAttestedAt,
        })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        if (!row?.agreementId || row.version == null || !row.attestedAt) return null;

        const current = await db.select({ version: agreements.version })
            .from(agreements)
            .where(and(eq(agreements.id, row.agreementId), eq(agreements.tenantId, tenantId)))
            .get();
        // Gone, or edited since: the words that were attested to are no longer
        // the words the client agreed to.
        if (!current || current.version !== row.version) return null;

        return { agreementId: row.agreementId, version: row.version, attestedAt: row.attestedAt };
    }

    /**
     * Updates the branding configuration for a tenant.
     *
     * ⚠️ This is the gate for `cancellation_policy`. The refusal cannot be a Zod
     * rule — it compares the submitted policy against DB state — so it lives
     * here, in the writer, and a second writer of that column would bypass it
     * without failing anything. See the column comment in the tenant schema.
     */
    async updateBranding(tenantId: string, data: Partial<typeof tenantConfigs.$inferInsert>) {
        if (data.cancellationPolicy !== undefined && policyChargesFees(data.cancellationPolicy)) {
            if (!(await this.getCancellationAttestation(tenantId))) {
                throw Errors.UnprocessableEntity(
                    'Confirm that your agreement contains a cancellation clause before enabling cancellation fees. '
                    + 'The agreement is what the client agreed to; this policy only enforces it.',
                );
            }
        }
        return this.writeConfig(tenantId, data);
    }

    /** Upsert of the tenant config row. NOT a gate — see `updateBranding`. */
    private async writeConfig(tenantId: string, data: Partial<typeof tenantConfigs.$inferInsert>) {
        const db = this.getDrizzle();
        const existing = await db.select().from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();

        const updateData = { ...data, tenantId, updatedAt: new Date() };

        if (existing) {
            await db.update(tenantConfigs).set(updateData).where(eq(tenantConfigs.tenantId, tenantId));
        } else {
            await db.insert(tenantConfigs).values(updateData as typeof tenantConfigs.$inferInsert);
        }

        if (this.kv) {
            await this.kv.delete(`branding:${tenantId}`);
        }

        return updateData;
    }

    /**
     * Uploads a logo to R2 and updates the tenant configuration.
     */
    async uploadLogo(tenantId: string, file: File) {
        if (!this.r2) throw Errors.BadRequest('Logo upload not available');

        const extension = file.type.split('/')[1] === 'svg+xml' ? 'svg' : file.type.split('/')[1];
        const key = r2Keys.brandingLogo(tenantId, crypto.randomUUID(), extension);

        await this.r2.put(key, await file.arrayBuffer(), {
            httpMetadata: { contentType: file.type },
        });

        // A-10 — point at the public brand-asset serve route (the previous
        // `/api/inspections/photo/${key}` path never had a handler). The R2
        // key contains '/', so it travels as a query param (Hono mounted
        // routers don't match multi-segment path params).
        const logoUrl = `/api/public/brand-asset?key=${encodeURIComponent(key)}`;
        await this.updateBranding(tenantId, { logoUrl });

        return logoUrl;
    }

    // ─── Integration Config (plaintext non-sensitive) ────────────────────────

    /** Returns stored integration config (appBaseUrl, turnstileSiteKey, googleClientId). */
    async getIntegrationConfig(tenantId: string): Promise<IntegrationConfig> {
        const db = this.getDrizzle();
        const row = await db
            .select({ integrationConfig: tenantConfigs.integrationConfig })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();

        if (!row?.integrationConfig) return {};
        try {
            return JSON.parse(row.integrationConfig) as IntegrationConfig;
        } catch {
            return {};
        }
    }

    /** Merges and saves integration config. */
    async updateIntegrationConfig(tenantId: string, data: Partial<IntegrationConfig>): Promise<void> {
        const existing = await this.getIntegrationConfig(tenantId);
        const merged = { ...existing, ...data };
        // Remove empty values
        const cleaned = Object.fromEntries(Object.entries(merged).filter(([, v]) => v != null && v !== ''));
        await this.updateBranding(tenantId, { integrationConfig: JSON.stringify(cleaned) });
    }

    // C-15 (2026-06-06): getDecryptedSecrets / getMaskedSecrets / updateSecrets
    // were RETIRED with the legacy `tenant_configs.secrets` dual store (the
    // A-16 wrong-store bug came from exactly this duality). Reads + writes go
    // through the canonical `secrets_enc` column only.
}
